import { ruleSource } from "./campaigns.js";
import { getleadsParamsFromFilters } from "./infer.js";
import { GETLEADS_BANDS, type Recipe, type RoutingRule, type Source } from "./schema.js";

/**
 * Per campaign, the ICP source is chosen in this order:
 * 1. The file recipe's cell for that campaign.
 * 2. The receipt (tags, notes, or a complete adapter the receipt named).
 * 3. The lane recipe's ICP.
 * 4. The campaign's best build (most interested replies, then the latest).
 * A Maps, SERP, LinkedIn-engagers, or permits build is a Josh lane.
 * A campaign with none of these stays unnamed and is skipped.
 */
export type IcpSourceUsed = "cell" | "receipt" | "lane" | "build";

export interface CampaignBuild {
  campaign_id: number;
  build_label?: string | null;
  interested?: number | null;
  company_source?: string | null;
  company_filters?: Record<string, unknown> | null;
  pulled_at?: string | null;
}

export function applyIcpSources(
  recipe: Recipe,
  fileRecipes: readonly Recipe[],
  builds: readonly CampaignBuild[] = [],
): { recipe: Recipe; used: Record<string, IcpSourceUsed>; missing: number[] } {
  const used: Record<string, IcpSourceUsed> = {};
  const missing: number[] = [];
  const routing = recipe.routing.map((rule) => {
    const cell = fileCellSource(recipe, fileRecipes, rule.campaign_id);
    if (cell) {
      used[String(rule.campaign_id)] = "cell";
      return { ...rule, source: cell };
    }
    const receipt = receiptSource(recipe, rule);
    if (receipt) {
      used[String(rule.campaign_id)] = "receipt";
      return { ...rule, source: receipt };
    }
    const lane = laneSource(recipe, fileRecipes, rule);
    if (lane) {
      used[String(rule.campaign_id)] = "lane";
      return { ...rule, source: lane };
    }
    const fromBuild = sourceFromBuild(pickBuild(builds, rule.campaign_id));
    if (fromBuild) {
      used[String(rule.campaign_id)] = "build";
      return { ...rule, source: fromBuild };
    }
    missing.push(rule.campaign_id);
    return rule;
  });
  return { recipe: { ...recipe, routing }, used, missing };
}

const BANDS = new Set<string>(GETLEADS_BANDS);

/** Rows from topup.campaign_builds or a pull receipt. */
export function buildsFromRows(rows: readonly Record<string, unknown>[]): CampaignBuild[] {
  const out: CampaignBuild[] = [];
  for (const row of rows) {
    const id = Number(row.smartlead_campaign_id ?? row.campaign_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const filters = row.company_filters;
    const interested = row.interested == null || row.interested === "" ? null : Number(row.interested);
    out.push({
      campaign_id: id,
      build_label: row.build_label == null ? null : String(row.build_label),
      interested: interested != null && Number.isFinite(interested) ? interested : null,
      company_source: row.company_source == null ? null : String(row.company_source),
      company_filters: filters && typeof filters === "object" && !Array.isArray(filters) ? (filters as Record<string, unknown>) : null,
      pulled_at: row.pulled_at == null ? (row.written_at == null ? null : String(row.written_at)) : String(row.pulled_at),
    });
  }
  return out;
}

/** Most interested replies, then the latest pull. */
export function pickBuild(builds: readonly CampaignBuild[], campaignId: number): CampaignBuild | null {
  const rows = builds.filter((build) => build.campaign_id === campaignId);
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const byInterest = (b.interested ?? -1) - (a.interested ?? -1);
    if (byInterest !== 0) return byInterest;
    return String(b.pulled_at ?? "").localeCompare(String(a.pulled_at ?? ""));
  })[0]!;
}

function sourceFromBuild(build: CampaignBuild | null): Source | null {
  if (!build) return null;
  const named = (build.company_source ?? "").toLowerCase();
  if (named === "getleads" || named === "") {
    const params = getleadsParamsFromFilters(buildFilters(build.company_filters ?? {}));
    if (params) return { kind: "getleads", params, widening_candidates: [] };
  }
  const josh = joshLane(build);
  if (josh) return { kind: "mixed", note: `Josh lane: ${josh}`, parts: [] };
  return null;
}

function buildFilters(filters: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...filters };
  if (!Array.isArray(out.job_titles) && !Array.isArray(out.titles)) {
    const terms = out.persona_terms;
    if (Array.isArray(terms) && terms.some((term) => typeof term === "string" && term.trim())) out.job_titles = terms;
  }
  const size = out.company_size;
  const bands = Array.isArray(size) ? size.filter((band): band is string => typeof band === "string" && BANDS.has(band)) : [];
  if (bands.length) out.company_size = bands;
  else delete out.company_size;
  return out;
}

function joshLane(build: CampaignBuild): string | null {
  const source = (build.company_source ?? "").toLowerCase();
  const label = build.build_label ?? "";
  const blob = `${source} ${label}`.toLowerCase();
  if (source === "linkedin_engagers" || source === "linkedin_import" || /linkedin[_\s-]*engager/.test(blob)) return "linkedin_engagers";
  if (source === "serp" || source === "serp_tool_mention" || /\bserp\b/.test(blob)) return "serp";
  if (source === "maps_and_permits") return "maps_and_permits";
  if (source === "permits" || /\bpermits?\b/.test(blob)) return "permits";
  if (source === "maps" || /maps_site|\bmaps\b/.test(blob)) return "maps";
  return null;
}

function concreteSource(source: Source | undefined): Source | null {
  if (!source) return null;
  if (source.kind === "mixed") return source.parts.length > 0 ? source : null;
  return source;
}

function fileCellSource(recipe: Recipe, files: readonly Recipe[], campaignId: number): Source | null {
  const candidates = files.filter(
    (file) =>
      file.client_tag === recipe.client_tag &&
      !file.recipe_id.endsWith(".v0") &&
      file.routing.some((rule) => rule.campaign_id === campaignId),
  );
  candidates.sort((a, b) => Number(a.lane !== recipe.lane) - Number(b.lane !== recipe.lane));
  for (const file of candidates) {
    const rule = file.routing.find((item) => item.campaign_id === campaignId);
    if (!rule) continue;
    const source = concreteSource(ruleSource(file, rule));
    if (source) return source;
  }
  return null;
}

function receiptSource(recipe: Recipe, rule: RoutingRule): Source | null {
  const own = concreteSource(rule.source);
  if (own) return own;
  if (recipe.source.kind === "mixed" && recipe.source.parts.length > 0) return recipe.source;
  if (recipe.recipe_id.endsWith(".v0")) return concreteSource(ruleSource(recipe, rule));
  return null;
}

function laneSource(recipe: Recipe, files: readonly Recipe[], rule: RoutingRule): Source | null {
  const laneFile = files.find(
    (file) => file.client_tag === recipe.client_tag && file.lane === recipe.lane && !file.recipe_id.endsWith(".v0") && concreteSource(file.source),
  );
  if (laneFile) {
    const inherited = concreteSource(ruleSource(laneFile, { ...rule, source: undefined }));
    if (inherited) return inherited;
  }
  if (!recipe.recipe_id.endsWith(".v0")) return concreteSource(ruleSource(recipe, rule));
  return null;
}
