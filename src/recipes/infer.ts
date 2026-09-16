import { persistRecipe } from "./load.js";
import { inferBands, type Band } from "./bands.js";
import { partitionBands } from "./backfillSize.js";
import { recipeCampaignIds } from "./campaigns.js";
import {
  bestYieldBuild,
  latestLaneReceipt,
  type CompanySource,
  type PullReceipt,
} from "./receipt.js";
import { parseRecipe, type Recipe } from "./schema.js";
import type { Repo } from "../db/repo.js";

/**
 * D38 — infer the ICP from leads already in the campaign, and the find
 * method from pull-receipt tags. No handwritten recipe required.
 */

export type CountRow = { value: string; n: number };

export type LeadIcpSnapshot = {
  total: number;
  titled: number;
  sized: number;
  titles: CountRow[];
  sizes: CountRow[];
};

export type InferredSource =
  | { kind: "getleads"; park: false }
  | { kind: "maps" | "permits" | "ai_ark" | "signal"; park: true; reason: string };

const TITLE_ACRONYMS = new Set(["it", "cio", "cto", "cfo", "ceo", "coo", "vp", "svp", "evp", "hr", "ai", "cio/cto"]);
const TITLE_SMALL = new Set(["of", "the", "and", "for", "to", "in"]);

export function displayTitle(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (TITLE_ACRONYMS.has(lower)) return word.toUpperCase();
      if (i > 0 && TITLE_SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Titles that cover most of the list. Counts only; never emails. */
export function inferTitles(titles: CountRow[], opts?: { cover?: number; max?: number; minN?: number }): string[] {
  const cover = opts?.cover ?? 0.8;
  const max = opts?.max ?? 20;
  const minN = opts?.minN ?? 5;
  const cleaned = titles
    .map((t) => ({ value: displayTitle(t.value), n: t.n }))
    .filter((t) => t.value.length >= 2 && t.n > 0);
  const byName = new Map<string, number>();
  for (const t of cleaned) byName.set(t.value, (byName.get(t.value) ?? 0) + t.n);
  const ranked = [...byName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = ranked.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return [];
  const out: string[] = [];
  let seen = 0;
  for (const [title, n] of ranked) {
    if (out.length >= max) break;
    if (out.length >= 8 && n < minN && seen / total >= cover) break;
    out.push(title);
    seen += n;
    if (seen / total >= cover && out.length >= 5) break;
  }
  return out;
}

export function inferSourceFromTags(receipt: Pick<PullReceipt, "company_source" | "icp_kind">): InferredSource {
  const src = receipt.company_source as CompanySource;
  if (src === "getleads") return { kind: "getleads", park: false };
  if (src === "ai_ark") return { kind: "ai_ark", park: true, reason: "AI Ark people discovery is inferred but not wired as a pull yet" };
  if (src === "maps" || src === "maps_and_permits") {
    return { kind: "maps", park: true, reason: "Maps (physical) is inferred; the Maps adapter is not wired yet" };
  }
  if (src === "permits" || src === "parcels" || src === "public_records") {
    return { kind: "permits", park: true, reason: "Permits / parcels are inferred; those adapters are not wired yet" };
  }
  return { kind: "signal", park: true, reason: `company_source ${src} is a named signal; rerun params exist on the receipt but that pull is not wired yet` };
}

export function emailFindingFromTags(receipt: Pick<PullReceipt, "email_source" | "email_max_tier">): Recipe["email_finding"] {
  const needsFind = receipt.email_source === "email_waterfall" || receipt.email_source === "discolike" || receipt.email_source === "name_to_email";
  const max = receipt.email_max_tier && receipt.email_max_tier !== "fullenrich" ? receipt.email_max_tier : "leadmagic";
  return {
    enabled: needsFind,
    max_tier: needsFind ? max : "aiark",
    fullenrich: false,
    batch_rows: 200,
    name_to_email: false,
  };
}

export type InferInput = {
  clientTag: string;
  lane: string;
  smartleadClientId: number;
  campaignIds: number[];
  snapshot: LeadIcpSnapshot;
  receipts: PullReceipt[];
  /** When leads and the receipt have no bands, getleads partition fills this. */
  bands?: Band[];
};

export type InferResult = { ok: true; recipe: Recipe; summary: string } | { ok: false; message: string };

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function maxPerCompany(filters: Record<string, unknown>): number | undefined {
  if (typeof filters.max_per_company === "number" && filters.max_per_company >= 1) return filters.max_per_company;
  const caps = filters.export_caps;
  if (caps && typeof caps === "object") {
    const n = (caps as { max_per_company?: unknown }).max_per_company;
    if (typeof n === "number" && n >= 1) return n;
  }
  return undefined;
}

/** Pick the lane filter book, then the best build, for tags + filters. */
export function pickReceipts(receipts: PullReceipt[]): { lane: PullReceipt | null; build: PullReceipt | null; tags: PullReceipt | null } {
  const lane = latestLaneReceipt(receipts);
  const build = bestYieldBuild(receipts)?.receipt ?? null;
  return { lane, build, tags: lane ?? build };
}

export { inferBands };

export function inferRecipe(input: InferInput): InferResult {
  const picked = pickReceipts(input.receipts);
  if (!picked.tags) {
    return { ok: false, message: `No pull receipt for ${input.clientTag}/${input.lane}. The tags (company / domain / person / email source) live on the receipt; without them the service cannot infer how the list was found.` };
  }
  const filters = (picked.lane?.company_filters ?? picked.tags.company_filters) as Record<string, unknown>;
  const receiptTitles = stringList(filters.job_titles);
  const leadTitles = input.snapshot.titled >= 30 ? inferTitles(input.snapshot.titles) : [];
  const titles = [...new Set([...leadTitles, ...receiptTitles])];
  if (titles.length === 0) {
    return { ok: false, message: `Cannot infer titles for ${input.clientTag}/${input.lane}: the list has ${input.snapshot.titled} titled leads and the receipt has no job_titles.` };
  }

  const bands = input.bands?.length ? input.bands : inferBands(input.snapshot.sizes, stringList(filters.company_size));
  if (bands.length === 0) {
    return {
      ok: false,
      message: `Cannot infer headcount bands for ${input.clientTag}/${input.lane}: public.leads.company_size is empty, the receipt has no company_size, and getleads has not named a band yet.`,
    };
  }

  const source = inferSourceFromTags(picked.tags);
  if (source.park) {
    return { ok: false, message: source.reason };
  }

  const countries = stringList(filters.countries);
  const industries = stringList(filters.industries).filter((s) => !s.includes(","));
  const perCompany = maxPerCompany(filters);
  const campaignIds = input.campaignIds.length
    ? input.campaignIds
    : [...new Set([...(picked.lane?.campaign_ids ?? []), ...(picked.build?.campaign_ids ?? [])])];
  if (campaignIds.length === 0) {
    return { ok: false, message: `Receipt for ${input.clientTag}/${input.lane} names no campaign ids.` };
  }

  const persona = picked.tags.persona;
  const recipe = parseRecipe({
    recipe_id: `${input.clientTag}.${input.lane}.v0`,
    client_tag: input.clientTag,
    lane: input.lane,
    smartlead_client_id: input.smartleadClientId,
    supabase_project: "azpapwtnrbzywlnxxecz",
    owner_approved_at: null,
    source: {
      kind: "getleads",
      params: {
        job_titles: titles,
        company_size: bands,
        countries: countries.length ? countries : ["United States"],
        ...(industries.length ? { industries } : {}),
        ...(perCompany ? { max_per_company: perCompany } : {}),
      },
      widening_candidates: [],
    },
    suppression: {
      response_based: true,
      client_prior_contacts: true,
      bounced_any_client: true,
      public_suppression: true,
      client_domain_blocklist: true,
      same_offer_any_client: true,
      same_gift_any_client: false,
    },
    email_finding: emailFindingFromTags(picked.tags),
    verify: { seg_split: true, reject_rate_norm: null },
    normalize: { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } },
    qa: ["junk_titles", "retail_school_purge", "regulated_gift_hold", "nonprofit_to_eos", "company_name_acronym_hold"],
    segments: {},
    routing: campaignIds.map((campaign_id) => ({
      when: {},
      campaign_id,
      icp: { kind: picked.tags!.icp_kind, persona },
    })),
    required_fields: ["first_name_n", "company_n", "location", "local_sports_team", "job_title", "company_size", "vertical"],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
    spend: { auto_cap_usd: 5 },
    owner_approvals: ["inferred_from_list"],
  });

  const summary =
    `inferred from ${input.snapshot.titled} titled / ${input.snapshot.total} leads · ` +
    `tags ${picked.tags.company_source}/${picked.tags.person_source}/${picked.tags.email_source} · ` +
    `${titles.length} titles · bands ${bands.join(", ")} · ${campaignIds.length} campaign(s)`;
  return { ok: true, recipe, summary };
}

export function isInferredRecipe(recipe: Pick<Recipe, "recipe_id" | "owner_approvals">): boolean {
  return recipe.recipe_id.endsWith(".v0") || recipe.owner_approvals.includes("inferred_from_list");
}

export type ResolveResult =
  | { ok: true; recipe: Recipe; inferred: boolean; summary: string }
  | { ok: false; message: string };

export type RecipeResolveDeps = {
  findRecipe: (clientTag: string, lane: string) => Promise<{ recipe_id: string; body: unknown } | null>;
  listPullReceipts: (clientTag: string, lane: string) => Promise<PullReceipt[]>;
  leadIcpSnapshot: (campaignIds: number[]) => Promise<LeadIcpSnapshot>;
  smartleadClientIdFor: (campaignIds: number[]) => Promise<number | null>;
  upsertRecipe: (recipe: Recipe) => Promise<void>;
  listReceiptLanes?: () => Promise<Array<{ client_tag: string; lane: string; campaign_ids: number[] }>>;
  count?: (filters: Record<string, unknown>) => Promise<{ total_matching: number }>;
};

export function recipeResolveDeps(
  repo: Repo,
  count?: (filters: Record<string, unknown>) => Promise<{ total_matching: number }>,
): RecipeResolveDeps {
  return {
    findRecipe: (c, l) => repo.findRecipe(c, l),
    listPullReceipts: (c, l) => repo.listPullReceipts(c, l),
    leadIcpSnapshot: (ids) => repo.leadIcpSnapshot(ids),
    smartleadClientIdFor: (ids) => repo.smartleadClientIdFor(ids),
    upsertRecipe: (r) => persistRecipe(repo, r),
    listReceiptLanes: () => repo.listReceiptLanes(),
    count,
  };
}

/** File recipe wins. Else infer from the list + receipt tags and persist `*.v0`. */
export async function resolveOrInfer(
  deps: RecipeResolveDeps,
  input: { clientTag: string; lane: string; campaignIds?: number[] },
): Promise<ResolveResult> {
  const found = await deps.findRecipe(input.clientTag, input.lane);
  if (found) {
    try {
      const recipe = parseRecipe(found.body);
      if (!isInferredRecipe(recipe)) {
        return { ok: true, recipe, inferred: false, summary: `saved recipe ${recipe.recipe_id}` };
      }
    } catch (err) {
      if (found.recipe_id && !found.recipe_id.endsWith(".v0")) {
        return { ok: false, message: `Recipe ${found.recipe_id} does not validate: ${(err as Error).message}` };
      }
    }
  }

  const receipts = await deps.listPullReceipts(input.clientTag, input.lane);
  const picked = pickReceipts(receipts);
  const campaignIds = input.campaignIds?.length
    ? input.campaignIds
    : [...new Set([...(picked.lane?.campaign_ids ?? []), ...(picked.build?.campaign_ids ?? [])])];
  const snapshot = await deps.leadIcpSnapshot(campaignIds);
  const clientId =
    picked.tags?.smartlead_client_id ??
    receipts.find((r) => r.smartlead_client_id)?.smartlead_client_id ??
    (await deps.smartleadClientIdFor(campaignIds));
  if (!clientId) {
    return {
      ok: false,
      message: `Cannot infer ${input.clientTag}/${input.lane}: no smartlead_client_id on the receipt or in public.campaigns.`,
    };
  }

  const filters = (picked.lane?.company_filters ?? picked.tags?.company_filters ?? {}) as Record<string, unknown>;
  let bands = inferBands(snapshot.sizes, stringList(filters.company_size));
  if (bands.length === 0 && deps.count) {
    const titles = [...new Set([...(snapshot.titled >= 30 ? inferTitles(snapshot.titles) : []), ...stringList(filters.job_titles)])];
    bands = await partitionBands(deps.count, titles, stringList(filters.countries));
  }

  const result = inferRecipe({
    clientTag: input.clientTag,
    lane: input.lane,
    smartleadClientId: clientId,
    campaignIds,
    snapshot,
    receipts,
    bands,
  });
  if (!result.ok) {
    if (found) {
      try {
        const recipe = parseRecipe(found.body);
        return { ok: true, recipe, inferred: true, summary: `previously inferred ${recipe.recipe_id} (refresh failed: ${result.message})` };
      } catch {
        /* fall through */
      }
    }
    return result;
  }
  await deps.upsertRecipe(result.recipe);
  return { ...result, inferred: true };
}

/** Watch extras: inferred getleads lanes whose campaigns a file recipe does not already cover. */
export async function inferWatchRecipes(deps: RecipeResolveDeps, fileRecipes: Recipe[]): Promise<Recipe[]> {
  if (!deps.listReceiptLanes) return [];
  const fileLanes = new Set(fileRecipes.map((r) => `${r.client_tag}/${r.lane}`));
  const covered = new Set(fileRecipes.flatMap((r) => recipeCampaignIds(r)));
  const extra: Recipe[] = [];
  for (const lane of await deps.listReceiptLanes()) {
    if (fileLanes.has(`${lane.client_tag}/${lane.lane}`)) continue;
    if (lane.campaign_ids.some((id) => covered.has(id))) continue;
    const resolved = await resolveOrInfer(deps, {
      clientTag: lane.client_tag,
      lane: lane.lane,
      campaignIds: lane.campaign_ids,
    });
    if (resolved.ok && resolved.inferred && resolved.recipe.source.kind === "getleads") {
      extra.push(resolved.recipe);
      for (const id of recipeCampaignIds(resolved.recipe)) covered.add(id);
    }
  }
  return extra;
}
