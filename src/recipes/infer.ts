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
  receipt_id?: string | null;
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
  const bands = validBands(filters.company_size);
  if (titles.length === 0 || bands.length === 0) return null;
  const industries = asStringArray(filters.industries ?? filters.companyIndustry).filter((s) => !s.includes(","));
  const exportCaps = filters.export_caps && typeof filters.export_caps === "object" ? (filters.export_caps as Record<string, unknown>) : {};
  const maxPer = Number(filters.max_per_company ?? exportCaps.max_per_company);
  return {
    job_titles: titles,
    company_size: bands,
    ...(asStringArray(filters.countries).length ? { countries: asStringArray(filters.countries) } : {}),
    ...(asStringArray(filters.states).length ? { states: asStringArray(filters.states) } : {}),
    ...(asStringArray(filters.cities).length ? { cities: asStringArray(filters.cities) } : {}),
    ...(industries.length ? { industries } : {}),
    ...(Number.isFinite(maxPer) && maxPer >= 1 ? { max_per_company: Math.floor(maxPer) } : {}),
  };
}

/** Where the fix lives. The park card points here so nobody goes looking for a recipe file. */
export const RECEIPT_BACKFILL_DOC = "skills/first-pull-receipt/BACKFILL.md";

/** Slack section text tops out at 3000 chars; the note travels inside one. */
const NOTE_MAX = 1200;
const HOW_MAX = 400;

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function show(v: unknown): string {
  if (v === undefined || v === null) return "absent";
  return clip(JSON.stringify(v), 80);
}

/** Which getleads fields the receipt is missing, in the words the backfill prompt uses. */
export function missingGetleadsFields(filters: Record<string, unknown>): string[] {
  const out: string[] = [];
  const titles = asStringArray(filters.job_titles ?? filters.titles);
  if (titles.length === 0) {
    const hint = filters.persona_terms !== undefined ? " (persona_terms is not a title list)" : "";
    out.push(`job_titles: ${show(filters.job_titles ?? filters.titles)}${hint}`);
  }
  if (validBands(filters.company_size).length === 0) {
    out.push(`company_size: ${show(filters.company_size)} — need exact band labels from ${GETLEADS_BANDS.map((b) => `"${b}"`).join(", ")}`);
  }
  return out;
}

function receiptRef(stamp: ReceiptStamp): string {
  const id = stamp.receipt_id ? `receipt ${stamp.receipt_id.slice(0, 8)}` : "latest receipt";
  const label = stamp.build_label ? ` (${stamp.build_label})` : "";
  const by = stamp.written_by ? `, written_by ${stamp.written_by}` : "";
  return `${id}${label} on ${stamp.client_tag}/${stamp.lane}${by}`;
}

function mixedNote(stamp: ReceiptStamp, why: string): string {
  const notes = stamp.notes?.trim();
  const fix = `Fix: one new insert into topup.pull_receipts for this lane with the fields filled (latest row wins) — ${RECEIPT_BACKFILL_DOC}. Not a recipe file.`;
  return clip(
    [
      `${receiptRef(stamp)}: ${why}`,
      fix,
      `how_i_did_it: ${clip(stamp.how_i_did_it, HOW_MAX)}`,
      notes ? `notes: ${clip(notes, 200)}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    NOTE_MAX,
  );
}

export function sourceFromStamp(stamp: ReceiptStamp): Source {
  if (stamp.company_source === "getleads") {
    const params = getleadsParamsFromFilters(stamp.company_filters ?? {});
    if (params) return { kind: "getleads", params, widening_candidates: [] };
    const missing = missingGetleadsFields(stamp.company_filters ?? {});
    return {
      kind: "mixed",
      note: mixedNote(
        stamp,
        `company_source is getleads but company_filters cannot be re-run. Missing — ${missing.join("; ")}. The service does not invent them (D45).`,
      ),
    };
  }
  if (stamp.company_source === "maps") {
    const categories = asStringArray(
      (stamp.company_filters.maps as { categories?: unknown } | undefined)?.categories ?? stamp.company_filters.categories,
    );
    if (categories.length) {
      return {
        kind: "maps",
        params: {
          categories,
          ...(asStringArray(stamp.company_filters.states).length ? { states: asStringArray(stamp.company_filters.states) } : {}),
          ...(asStringArray(stamp.company_filters.cities).length ? { cities: asStringArray(stamp.company_filters.cities) } : {}),
        },
      };
    }
  }
  if (stamp.company_source === "permits") {
    const permitTypes = asStringArray(
      (stamp.company_filters.permits as { permit_types?: unknown } | undefined)?.permit_types ?? stamp.company_filters.permit_types,
    );
    if (permitTypes.length) {
      return {
        kind: "permits",
        params: { permit_types: permitTypes },
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
      `company_source ${stamp.company_source} with these company_filters is not a complete pull adapter input. Size/pull parks. Do not invent a filter.`,
    ),
  };
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
    receipt_id: r.receipt_id ?? null,
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

/**
 * D46 — which campaign ids an inferred recipe may route into.
 * - An id named by another lane's *lane row* belongs to that lane.
 * - An id the Smartlead mirror says is another client's never enters.
 * - Build rows do not claim campaigns; they only carry ids when the lane
 *   has no lane row at all.
 * Returns the cleaned stamps plus what was dropped (ids only) so the
 * caller can log it and refuse a lane that owns nothing.
 */
export function scopeCampaignIds(input: {
  stamps: ReceiptStamp[];
  lane: string;
  smartleadClientId: number;
  laneRowClaims: Map<number, string>;
  owners: Map<number, number | null>;
}): {
  stamps: ReceiptStamp[];
  dropped: { claimed_by_other_lane: Array<{ id: number; lane: string }>; other_client: Array<{ id: number; client: number }> };
  own: number[];
  hasLaneRow: boolean;
} {
  const claimed = new Map<number, string>();
  const foreign = new Map<number, number>();
  const keep = (id: number): boolean => {
    const owner = input.owners.get(id);
    if (owner != null && owner !== input.smartleadClientId) {
      foreign.set(id, owner);
      return false;
    }
    const byLane = input.laneRowClaims.get(id);
    if (byLane && byLane !== input.lane) {
      claimed.set(id, byLane);
      return false;
    }
    return true;
  };
  const stamps = input.stamps.map((s) => ({ ...s, campaign_ids: s.campaign_ids.filter(keep) }));
  const own = [...new Set(stamps.flatMap((s) => s.campaign_ids))];
  return {
    stamps,
    own,
    hasLaneRow: stamps.some((s) => s.granularity === "lane"),
    dropped: {
      claimed_by_other_lane: [...claimed.entries()].map(([id, lane]) => ({ id, lane })),
      other_client: [...foreign.entries()].map(([id, client]) => ({ id, client })),
    },
  };
}

export function recipeFromReceipts(input: {
  receipts: ReceiptStamp[];
  smartleadClientId: number;
  extraCampaignIds?: number[];
}): Recipe {
  const picked = pickStamps(input.receipts);
  if (!picked) throw new Error("no pull receipt to infer from");
  const { book, method } = picked;
  // D46: the lane row is the filter book and names the lane's campaigns.
  // Build rows carry ids only when the lane has no lane row.
  const fromReceipts = book.granularity === "lane" ? book.campaign_ids : [...book.campaign_ids, ...method.campaign_ids];
  const ids = [...new Set([...fromReceipts, ...(input.extraCampaignIds ?? [])])].filter((n) => Number.isInteger(n) && n > 0);
  const slots = ids.map(String);
  const icp = { kind: icpKind(method), persona: persona(method) };
  const raw: unknown = {
    recipe_id: inferredRecipeId(book.client_tag, book.lane),
    client_tag: book.client_tag,
    lane: book.lane,
    smartlead_client_id: input.smartleadClientId,
    supabase_project: "azpapwtnrbzywlnxxecz",
    owner_approved_at: null,
    source: sourceFromStamp(method),
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
