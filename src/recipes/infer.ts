import { GETLEADS_BANDS } from "./schema.js";
import { parseRecipe, type Recipe, type Source } from "./schema.js";
import { latestLaneReceipt, bestYieldBuild } from "./receipt.js";

/**
 * D45 — a file recipe is the override. Everyone else repeats from
 * `topup.pull_receipts` (lane row = filter book, best build = method) plus
 * the receipt notes / how_i_did_it. Do not invent titles, bands, or a
 * source the receipt did not name.
 */

const BANDS = new Set<string>(GETLEADS_BANDS);

export interface ReceiptStamp {
  written_by: string;
  written_at?: string;
  client_tag: string;
  smartlead_client_id: number | null;
  lane: string;
  campaign_ids: number[];
  icp_kind: "linkedin_native" | "physical" | string;
  persona: string;
  company_source: string;
  company_filters: Record<string, unknown>;
  domain_source?: string;
  person_source?: string;
  email_source: string;
  email_max_tier: string | null;
  how_i_did_it: string;
  notes: string | null;
  segment: Record<string, unknown> | null;
  granularity: "build" | "lane" | string;
  rows_imported?: number | null;
  rows_found?: number | null;
  tam_count?: number | null;
  build_label?: string | null;
}

export function inferredRecipeId(clientTag: string, lane: string): string {
  return `${clientTag}.${lane}.v0`;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function validBands(v: unknown): Array<(typeof GETLEADS_BANDS)[number]> {
  return asStringArray(v).filter((b): b is (typeof GETLEADS_BANDS)[number] => BANDS.has(b));
}

/** Copy getleads filters from the receipt. Null when titles or bands are missing — do not invent them. */
export function getleadsParamsFromFilters(filters: Record<string, unknown>): {
  job_titles: string[];
  company_size: Array<(typeof GETLEADS_BANDS)[number]>;
  countries?: string[];
  states?: string[];
  cities?: string[];
  industries?: string[];
  max_per_company?: number;
} | null {
  const titles = asStringArray(filters.job_titles ?? filters.titles);
  if (titles.length === 0) return null;
  const namedBands = filters.company_size;
  const hasBandField = namedBands !== undefined && namedBands !== null && !(Array.isArray(namedBands) && namedBands.length === 0);
  const bands = validBands(namedBands);
  // A receipt that names a headcount and none of it is a real band is incomplete.
  // A receipt that names titles and no headcount is the full band range, not a guess.
  if (hasBandField && bands.length === 0) return null;
  const companySize = bands.length > 0 ? bands : [...GETLEADS_BANDS];
  const industries = asStringArray(filters.industries ?? filters.companyIndustry).filter((s) => !s.includes(","));
  const exportCaps = filters.export_caps && typeof filters.export_caps === "object" ? (filters.export_caps as Record<string, unknown>) : {};
  const maxPer = Number(filters.max_per_company ?? exportCaps.max_per_company);
  return {
    job_titles: titles,
    company_size: companySize,
    ...(asStringArray(filters.countries).length ? { countries: asStringArray(filters.countries) } : {}),
    ...(asStringArray(filters.states).length ? { states: asStringArray(filters.states) } : {}),
    ...(asStringArray(filters.cities).length ? { cities: asStringArray(filters.cities) } : {}),
    ...(industries.length ? { industries } : {}),
    ...(Number.isFinite(maxPer) && maxPer >= 1 ? { max_per_company: Math.floor(maxPer) } : {}),
  };
}

function mixedNote(stamp: ReceiptStamp, why: string): string {
  const notes = stamp.notes?.trim();
  return [why, `how_i_did_it: ${stamp.how_i_did_it}`, notes ? `notes: ${notes}` : null].filter(Boolean).join(" ");
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function permitTypeList(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return asStringArray(v);
}

const STATE_CODE = /^[A-Z]{2}$/;

function twoLetterStates(v: unknown): string[] {
  return asStringArray(v)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => STATE_CODE.test(s));
}

function explicitStateCodes(stamp: ReceiptStamp): string[] {
  const filters = stamp.company_filters ?? {};
  const maps = asObject(filters.maps);
  const permits = asObject(filters.permits);
  return [...new Set([...twoLetterStates(filters.states), ...twoLetterStates(maps?.states), ...twoLetterStates(permits?.states)])];
}

function geoBlob(stamp: ReceiptStamp): string {
  const filters = stamp.company_filters ?? {};
  const maps = asObject(filters.maps);
  const permits = asObject(filters.permits);
  return [
    typeof filters.geo === "string" ? filters.geo : "",
    typeof maps?.geo === "string" ? maps.geo : "",
    typeof permits?.geo === "string" ? permits.geo : "",
    stamp.how_i_did_it ?? "",
    stamp.notes ?? "",
  ].join("\n");
}

/**
 * State codes the receipt already named. When it names none and the geo
 * says DFW, Texas, or TX, the count uses TX: PermitStack requires a state
 * code. Other metros are not guessed.
 */
export function receiptStateCodes(primary: ReceiptStamp, also?: ReceiptStamp | null): { states: string[]; fromDfw: boolean } {
  const explicit = [...new Set([...explicitStateCodes(primary), ...(also ? explicitStateCodes(also) : [])])];
  if (explicit.length) return { states: explicit, fromDfw: false };
  const blob = `${geoBlob(primary)}\n${also ? geoBlob(also) : ""}`;
  if (/\b(TX|Texas|DFW)\b/i.test(blob)) return { states: ["TX"], fromDfw: true };
  return { states: [], fromDfw: false };
}

const DFW_STATE_NOTE = "Counts use TX because the receipt geo is DFW.";

export type SegmentPart = Extract<Source, { kind: "mixed" }>["parts"][number];

/**
 * Maps categories and permit types already written on a maps_and_permits
 * receipt. Missing lists stay missing. Nothing here is invented.
 */
export function stackParts(stamp: ReceiptStamp): SegmentPart[] {
  if (stamp.company_source !== "maps_and_permits") return [];
  const filters = stamp.company_filters ?? {};
  const maps = asObject(filters.maps);
  const categories = asStringArray(maps?.categories);
  const permits = asObject(filters.permits);
  const types = permitTypeList(permits?.permit_types ?? permits?.categories_used);
  const states = receiptStateCodes(stamp).states;
  const parts: SegmentPart[] = [];
  if (categories.length) {
    const cities = asStringArray(maps?.cities);
    parts.push({
      label: "maps",
      icp_kind: "physical",
      source: {
        kind: "maps",
        params: {
          categories,
          ...(states.length ? { states } : {}),
          ...(cities.length ? { cities } : {}),
        },
      },
    });
  }
  if (types.length) {
    const counties = asStringArray(permits?.counties);
    parts.push({
      label: "permits",
      icp_kind: "physical",
      source: {
        kind: "permits",
        params: {
          permit_types: types,
          ...(states.length ? { states } : {}),
          ...(counties.length ? { counties } : {}),
        },
      },
    });
  }
  return parts;
}

/** One concrete list per company_filters.segment, from the best imported build of that segment. */
export function segmentParts(stamps: ReceiptStamp[]): SegmentPart[] {
  const best = new Map<string, ReceiptStamp>();
  for (const stamp of stamps) {
    const raw = stamp.company_filters?.segment;
    const label = typeof raw === "string" ? raw.trim() : "";
    if (!label) continue;
    const prev = best.get(label);
    if (!prev || (stamp.rows_imported ?? 0) > (prev.rows_imported ?? 0)) best.set(label, stamp);
  }
  const parts: SegmentPart[] = [];
  for (const [label, stamp] of best) {
    const source = sourceFromStamp(stamp);
    if (source.kind === "mixed") continue;
    parts.push({
      label,
      icp_kind: stamp.icp_kind === "physical" ? "physical" : "linkedin_native",
      source,
    });
  }
  return parts;
}

export function sourceFromStamp(stamp: ReceiptStamp): Source {
  if (stamp.company_source === "getleads") {
    const params = getleadsParamsFromFilters(stamp.company_filters ?? {});
    if (params) return { kind: "getleads", params, widening_candidates: [] };
    return {
      kind: "mixed",
      note: mixedNote(
        stamp,
        "Receipt company_source is getleads but company_filters are not a complete getleads param set (need job_titles and exact band labels). Do not invent them.",
      ),
      parts: [],
    };
  }
  if (stamp.company_source === "maps") {
    const maps = asObject(stamp.company_filters.maps);
    const categories = asStringArray(maps?.categories ?? stamp.company_filters.categories);
    if (categories.length) {
      const geo = receiptStateCodes(stamp);
      const cities = asStringArray(maps?.cities ?? stamp.company_filters.cities);
      return {
        kind: "maps",
        params: {
          categories,
          ...(geo.states.length ? { states: geo.states } : {}),
          ...(cities.length ? { cities } : {}),
        },
      };
    }
  }
  if (stamp.company_source === "permits") {
    const permits = asObject(stamp.company_filters.permits);
    const permitTypes = permitTypeList(permits?.permit_types ?? stamp.company_filters.permit_types);
    if (permitTypes.length) {
      const geo = receiptStateCodes(stamp);
      const counties = asStringArray(permits?.counties ?? stamp.company_filters.counties);
      return {
        kind: "permits",
        params: {
          permit_types: permitTypes,
          ...(geo.states.length ? { states: geo.states } : {}),
          ...(counties.length ? { counties } : {}),
        },
      };
    }
  }
  if (stamp.company_source === "ai_ark") {
    const titles = asStringArray(stamp.company_filters.titles ?? stamp.company_filters.job_titles);
    if (titles.length) {
      return {
        kind: "ai_ark",
        params: {
          titles,
          ...(asStringArray(stamp.company_filters.locations).length ? { locations: asStringArray(stamp.company_filters.locations) } : {}),
        },
      };
    }
  }
  if (stamp.company_source === "maps_and_permits") {
    const geo = receiptStateCodes(stamp);
    return {
      kind: "mixed",
      note: mixedNote(
        stamp,
        "Receipt company_source maps_and_permits. Each named list is sized on its own and the counts are combined. Do not invent a filter." +
          (geo.fromDfw ? ` ${DFW_STATE_NOTE}` : ""),
      ),
      parts: stackParts(stamp),
    };
  }
  if (stamp.company_source === "table") {
    const table = typeof stamp.company_filters.table === "string" ? stamp.company_filters.table : null;
    const where = typeof stamp.company_filters.where === "string" ? stamp.company_filters.where : null;
    if (table && where && /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table)) {
      return { kind: "supabase_table", table, where };
    }
  }
  return {
    kind: "mixed",
    note: mixedNote(
      stamp,
      `Receipt company_source ${stamp.company_source} is not a complete pull adapter input. Size/pull parks. Do not invent a filter.`,
    ),
    parts: [],
  };
}

/** Best build wins when it names a complete source. Otherwise the lane filter book does. */
export function sourceForLane(book: ReceiptStamp, method: ReceiptStamp): Source {
  const fromMethod = sourceFromStamp(method);
  if (fromMethod.kind !== "mixed" || fromMethod.parts.length > 0) return withLaneStates(fromMethod, method, book);
  const fromBook = sourceFromStamp(book);
  if (fromBook.kind !== "mixed" || fromBook.parts.length > 0) return withLaneStates(fromBook, method, book);
  return withLaneStates(fromMethod, method, book);
}

/** Fill a missing state from the other receipt on the lane. Do not replace a code the receipt named. */
function withLaneStates(source: Source, method: ReceiptStamp, book: ReceiptStamp): Source {
  const geo = receiptStateCodes(method, book);
  if (!geo.states.length) return source;
  const fill = <T extends { states?: string[] }>(params: T): T => (params.states?.length ? params : { ...params, states: geo.states });
  if (source.kind === "maps") return { ...source, params: fill(source.params) };
  if (source.kind === "permits") return { ...source, params: fill(source.params) };
  if (source.kind !== "mixed") return source;
  const parts = source.parts.map((part) => {
    if (part.source.kind === "maps") return { ...part, source: { ...part.source, params: fill(part.source.params) } };
    if (part.source.kind === "permits") return { ...part, source: { ...part.source, params: fill(part.source.params) } };
    return part;
  });
  const note = geo.fromDfw && !source.note.includes(DFW_STATE_NOTE) ? `${source.note} ${DFW_STATE_NOTE}` : source.note;
  return { ...source, parts, note };
}

function emailFindingFromStamp(stamp: ReceiptStamp): Recipe["email_finding"] {
  const tier = stamp.email_max_tier;
  const max =
    tier === "getleads" ||
    tier === "smartlead" ||
    tier === "aiark" ||
    tier === "leadmagic" ||
    tier === "prospeo" ||
    tier === "fullenrich"
      ? tier
      : "aiark";
  return {
    enabled: stamp.email_source === "email_waterfall",
    max_tier: max === "fullenrich" ? "prospeo" : max,
    fullenrich: false,
    batch_rows: 200,
    steps: [],
    name_to_email: false,
  };
}

function icpKind(stamp: ReceiptStamp): "linkedin_native" | "physical" {
  return stamp.icp_kind === "physical" ? "physical" : "linkedin_native";
}

function persona(stamp: ReceiptStamp): string {
  return /^[a-z][a-z0-9_]*$/.test(stamp.persona) ? stamp.persona : "unspecified";
}

/** Pick the filter book (lane row) and the method (best imported build). */
export function pickStamps(receipts: ReceiptStamp[]): { book: ReceiptStamp; method: ReceiptStamp } | null {
  if (receipts.length === 0) return null;
  const asPull = receipts.map((r) => ({
    ...r,
    written_by: r.written_by || "claude",
    granularity: r.granularity === "lane" ? ("lane" as const) : ("build" as const),
    company_source: r.company_source as never,
    domain_source: (r.domain_source ?? "none") as never,
    person_source: (r.person_source ?? "none") as never,
    email_source: r.email_source as never,
    how_i_did_it: r.how_i_did_it || "receipt has no how_i_did_it text.",
    supabase_project: "azpapwtnrbzywlnxxecz" as const,
    rows_found: r.rows_found ?? null,
    rows_imported: r.rows_imported ?? null,
    tam_count: r.tam_count ?? null,
    email_max_tier: r.email_max_tier as never,
    notes: r.notes,
    segment: r.segment,
    yield_by_step: null,
    spend_cents: null,
    suppression_scope: "response_based_v1",
    build_label: r.build_label ?? null,
    owner_confirmed_at: null,
    smartlead_client_id: r.smartlead_client_id,
    campaign_ids: r.campaign_ids,
    icp_kind: icpKind(r),
    persona: persona(r),
    company_filters: r.company_filters ?? {},
    client_tag: r.client_tag,
    lane: r.lane,
  }));
  const lane = latestLaneReceipt(asPull);
  const build = bestYieldBuild(asPull);
  const book = (lane ?? build?.receipt ?? asPull[0]) as unknown as ReceiptStamp;
  const method = (build?.receipt ?? lane ?? asPull[0]) as unknown as ReceiptStamp;
  if (!book) return null;
  return { book, method };
}

export function recipeFromReceipts(input: {
  receipts: ReceiptStamp[];
  smartleadClientId: number;
  extraCampaignIds?: number[];
}): Recipe {
  const picked = pickStamps(input.receipts);
  if (!picked) throw new Error("no pull receipt to infer from");
  const { book, method } = picked;
  const ids = [...new Set([...book.campaign_ids, ...method.campaign_ids, ...(input.extraCampaignIds ?? [])])].filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  const slots = ids.map(String);
  const icp = { kind: icpKind(method), persona: persona(method) };
  let source = sourceForLane(book, method);
  if (source.kind === "mixed") {
    const existing = source.parts;
    const covered = new Set(existing.map((p) => p.source.kind));
    const more = segmentParts(input.receipts).filter((p) => !covered.has(p.source.kind) && !existing.some((x) => x.label === p.label));
    if (more.length) source = { ...source, parts: [...existing, ...more] };
  }
  const raw: unknown = {
    recipe_id: inferredRecipeId(book.client_tag, book.lane),
    client_tag: book.client_tag,
    lane: book.lane,
    smartlead_client_id: input.smartleadClientId,
    supabase_project: "azpapwtnrbzywlnxxecz",
    owner_approved_at: null,
    source,
    suppression: {
      response_based: true,
      client_prior_contacts: true,
      bounced_any_client: true,
      public_suppression: true,
      client_domain_blocklist: true,
      same_offer_any_client: true,
      same_gift_any_client: false,
    },
    email_finding: emailFindingFromStamp(method),
    verify: { seg_split: true, reject_rate_norm: null },
    normalize: {
      names_cities: true,
      company: true,
      location: true,
      sports_team: { league: "both", pro_only: false },
    },
    qa: [],
    segments: slots.length ? { slot: slots } : {},
    routing: ids.map((campaign_id) => ({
      when: { slot: String(campaign_id) },
      campaign_id,
      icp,
    })),
    required_fields: ["first_name_n", "company_n", "location", "local_sports_team", "job_title"],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
    spend: { auto_cap_usd: 5 },
    owner_approvals: ["icp_change", "new_campaign", "spend_over_cap", "copy"],
  };
  return parseRecipe(raw);
}

export function laneFromReceipts(receipts: ReceiptStamp[], campaignId?: number): string | null {
  const hits = campaignId ? receipts.filter((r) => r.campaign_ids.includes(campaignId)) : receipts;
  const laneRow = hits.find((r) => r.granularity === "lane");
  return laneRow?.lane ?? hits[0]?.lane ?? null;
}

/** File recipe wins on the same client+lane. */
export function mergeRecipes(files: readonly Recipe[], inferred: readonly Recipe[]): Recipe[] {
  const keys = new Set(files.map((r) => `${r.client_tag}/${r.lane}`));
  return [...files, ...inferred.filter((r) => !keys.has(`${r.client_tag}/${r.lane}`))];
}
