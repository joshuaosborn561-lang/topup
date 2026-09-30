import type { Queryable } from "../db/pool.js";

/**
 * D40 — live pull recipe on this service. One SQL call each. jsonb verbatim.
 * Counts and method text, never lead rows. Ask Josh.
 */

export const RECIPE_CLIENT_TAGS = [
  "peterson",
  "peterson_earthworks",
  "bcp",
  "culture_fits",
  "parlay",
  "goliath",
  "techevo",
  "insight",
  "powergryd",
  "emcor",
  "vasco",
  "salesglider",
] as const;

export type RecipeClientTag = (typeof RECIPE_CLIENT_TAGS)[number];

export const CAMPAIGN_NOT_FOUND = "campaign not found in public.campaigns";

export const TOPUP_RECIPE_SQL = "select topup.recipe($1, $2)";
export const TOPUP_CAMPAIGN_BUILDS_SQL =
  "select * from topup.campaign_builds where client_tag = $1 and smartlead_campaign_id = $2 order by leads desc";
export const TOPUP_PROVENANCE_GAPS_SQL = "select * from topup.provenance_gaps where client_tag = $1";

export const TOPUP_RECIPE_DESCRIPTION =
  "Read before any top up. Returns how a campaign's leads were pulled last time: every build that fed it with its written method paragraph, source tags, filters, counts, interested replies, 90 day contact count and the house rules. Counts only, never lead rows.";

export interface TopupRecipe {
  campaign: unknown;
  leads?: unknown;
  interested?: unknown;
  leads_without_method?: unknown;
  any_reconstructed?: unknown;
  builds?: unknown;
  client_contacts_last_90d?: unknown;
  rules?: unknown;
  vocab?: unknown;
  [key: string]: unknown;
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function label(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "unlabeled";
}

/** One SQL call. pg returns jsonb as a parsed object. */
export async function readTopupRecipe(
  db: Queryable,
  clientTag: string,
  campaignId: number,
): Promise<TopupRecipe | typeof CAMPAIGN_NOT_FOUND> {
  const { rows } = await db.query<{ recipe: unknown }>(TOPUP_RECIPE_SQL, [clientTag, campaignId]);
  const obj = asObject(rows[0]?.recipe ?? null);
  if (!obj || obj.campaign == null) return CAMPAIGN_NOT_FOUND;
  return obj as TopupRecipe;
}

export async function readCampaignBuilds(db: Queryable, clientTag: string, campaignId: number): Promise<unknown[]> {
  const { rows } = await db.query(TOPUP_CAMPAIGN_BUILDS_SQL, [clientTag, campaignId]);
  return rows;
}

export async function readProvenanceGaps(db: Queryable, clientTag: string): Promise<unknown[]> {
  const { rows } = await db.query(TOPUP_PROVENANCE_GAPS_SQL, [clientTag]);
  return rows;
}

/**
 * Slack/watch summary: builds, interested per build, any_reconstructed,
 * leads_without_method. Never the method paragraph. Never a lead row.
 */
export function summarizeRecipeForSlack(recipe: TopupRecipe | typeof CAMPAIGN_NOT_FOUND, campaignId: number): string {
  if (recipe === CAMPAIGN_NOT_FOUND) {
    return `*Last pull recipe* (#${campaignId}): ${CAMPAIGN_NOT_FOUND}`;
  }
  const builds = Array.isArray(recipe.builds) ? recipe.builds : [];
  const buildLines = builds.map((b) => {
    const o = asObject(b);
    const interested = num(o?.interested);
    return `• \`${label(o?.build_label)}\` — ${interested ?? "?"} interested`;
  });
  const reconstructed = bool(recipe.any_reconstructed);
  const missing = num(recipe.leads_without_method);
  return [
    `*Last pull recipe* (#${campaignId})`,
    ...(buildLines.length ? buildLines : ["• no builds on record"]),
    `• any_reconstructed: ${reconstructed === null ? "?" : reconstructed ? "yes" : "no"}`,
    `• leads_without_method: ${missing ?? "?"}`,
  ].join("\n");
}

/** Watch: never throw. A missing recipe still lets the card post. */
export async function recipeSummariesForWatch(
  db: Queryable,
  clientTag: string,
  campaignIds: number[],
): Promise<string> {
  const parts: string[] = [];
  for (const id of campaignIds) {
    try {
      const recipe = await readTopupRecipe(db, clientTag, id);
      parts.push(summarizeRecipeForSlack(recipe, id));
    } catch (err) {
      parts.push(`*Last pull recipe* (#${id}): unavailable (${(err as Error).message.slice(0, 120)})`);
    }
  }
  return parts.join("\n");
}
