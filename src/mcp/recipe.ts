import { z } from "zod";
import type { Queryable } from "../db/pool.js";

/**
 * D40 — live pull recipe on this service. One SQL call each. jsonb verbatim.
 * Counts and method text, never lead rows. Ask Josh.
 * D42 — client_tag enum is topup.client_map at boot, not a hardcoded twelve.
 */

export const CLIENT_MAP_TAGS_SQL = "select client_tag from topup.client_map order by 1";
export const CLIENT_MAP_SQL = "select client_tag, smartlead_client_id from topup.client_map order by 1";

const SNAKE = /^[a-z][a-z0-9_]*$/;

export interface ClientMapRow {
  client_tag: string;
  smartlead_client_id: number;
}

/** Tags + Smartlead client ids. Tags only in tool enums; never client_name. */
export async function loadClientMap(db: Queryable): Promise<ClientMapRow[]> {
  const { rows } = await db.query<{ client_tag: string; smartlead_client_id: string | number }>(CLIENT_MAP_SQL);
  const out: ClientMapRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (typeof r.client_tag !== "string" || !SNAKE.test(r.client_tag) || seen.has(r.client_tag)) continue;
    const id = Number(r.smartlead_client_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    seen.add(r.client_tag);
    out.push({ client_tag: r.client_tag, smartlead_client_id: id });
  }
  return out;
}

/** Tags only. Never client_name. */
export async function loadClientTags(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ client_tag: string }>(CLIENT_MAP_TAGS_SQL);
  const seen = new Set<string>();
  for (const r of rows) {
    if (typeof r.client_tag === "string" && SNAKE.test(r.client_tag)) seen.add(r.client_tag);
  }
  return [...seen];
}

/** MCP input: live client_map tags, or snake_case if the table is empty so we never reject a new client. */
export function clientTagSchema(tags: readonly string[]): z.ZodType<string> {
  if (tags.length >= 1) return z.enum([tags[0]!, ...tags.slice(1)]);
  return z.string().regex(SNAKE, "snake_case");
}

export const CAMPAIGN_NOT_FOUND = "campaign not found in public.campaigns";

export const TOPUP_RECIPE_SQL = "select topup.recipe($1, $2)";
export const TOPUP_CAMPAIGN_BUILDS_SQL =
  "select * from topup.campaign_builds where client_tag = $1 and smartlead_campaign_id = $2 order by leads desc";
export const TOPUP_PROVENANCE_GAPS_SQL = "select * from topup.provenance_gaps where client_tag = $1";

export const TOPUP_RECIPE_DESCRIPTION =
  "Read before any top up. Returns how a campaign's leads were pulled last time: every build that fed it with its written method paragraph, source tags, filters, counts, interested replies, 90 day contact count. vocab and rules are omitted unless include_vocab=true. Counts only, never lead rows.";

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
export interface RecipeSummaryCounts {
  campaign_id: number;
  builds: Array<{ build_label: string; interested: number | null; bounces?: number | null }>;
  builds_total?: number;
  any_reconstructed: boolean | null;
  leads_without_method: number | null;
  campaign_not_found: boolean;
  unavailable?: string;
}

/** Queue: only builds with interested > 0, plus how many builds existed (D45). */
export function trimRecipeSummary(s: RecipeSummaryCounts): RecipeSummaryCounts {
  const kept = s.builds.filter((b) => (b.interested ?? 0) > 0);
  return { ...s, builds: kept, builds_total: s.builds.length };
}

function rewriteSpendCopy(rules: unknown): unknown {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return rules;
  const out: Record<string, unknown> = { ...(rules as Record<string, unknown>) };
  if (typeof out.spend === "string") out.spend = out.spend.replace(/above \$5/gi, "$5 or above");
  return out;
}

/** Strip vocab/rules unless asked. Rewrite spend copy to "$5 or above". Attach sends_last_14d when given. */
export function presentTopupRecipe(
  recipe: TopupRecipe,
  opts: { includeVocab?: boolean; sendsLast14d?: number | null } = {},
): TopupRecipe {
  const out: TopupRecipe = { ...recipe };
  if (!opts.includeVocab) {
    delete out.vocab;
    delete out.rules;
  } else if (out.rules) {
    out.rules = rewriteSpendCopy(out.rules);
  }
  if (opts.sendsLast14d != null) out.sends_last_14d = opts.sendsLast14d;
  if (typeof out.pulled_at === "string") {
    out.pulled_at_note =
      "pulled_at on backfill receipts is written_at of the claude_backfill row, not necessarily the day the list was loaded. Ask Josh for a real pull-date column.";
  }
  return out;
}

/** Counts only. Never the method paragraph. Never a lead row. */
export function recipeSummaryCounts(
  recipe: TopupRecipe | typeof CAMPAIGN_NOT_FOUND,
  campaignId: number,
): RecipeSummaryCounts {
  if (recipe === CAMPAIGN_NOT_FOUND) {
    return {
      campaign_id: campaignId,
      builds: [],
      any_reconstructed: null,
      leads_without_method: null,
      campaign_not_found: true,
    };
  }
  const builds = Array.isArray(recipe.builds) ? recipe.builds : [];
  return {
    campaign_id: campaignId,
    builds: builds.map((b) => {
      const o = asObject(b);
      const bounces = num(o?.bounces ?? o?.bounce_count ?? o?.bounced);
      return {
        build_label: label(o?.build_label),
        interested: num(o?.interested),
        ...(bounces != null ? { bounces } : {}),
      };
    }),
    builds_total: builds.length,
    any_reconstructed: bool(recipe.any_reconstructed),
    leads_without_method: num(recipe.leads_without_method),
    campaign_not_found: false,
  };
}

export function summarizeRecipeForSlack(recipe: TopupRecipe | typeof CAMPAIGN_NOT_FOUND, campaignId: number): string {
  const s = recipeSummaryCounts(recipe, campaignId);
  if (s.campaign_not_found) {
    return `*Last pull recipe* (#${campaignId}): ${CAMPAIGN_NOT_FOUND}`;
  }
  const buildLines = s.builds.map((b) => `• \`${b.build_label}\` — ${b.interested ?? "?"} interested`);
  return [
    `*Last pull recipe* (#${campaignId})`,
    ...(buildLines.length ? buildLines : ["• no builds on record"]),
    `• any_reconstructed: ${s.any_reconstructed === null ? "?" : s.any_reconstructed ? "yes" : "no"}`,
    `• leads_without_method: ${s.leads_without_method ?? "?"}`,
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
