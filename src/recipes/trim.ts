import type { Repo } from "../db/repo.js";
import type { Recipe, RoutingRule } from "./schema.js";

/**
 * Saved ICPs sometimes list another client's campaigns (the mirror says so).
 * Drop those. A campaign the mirror has with a blank (null) client id is
 * foreign too: only a matching client id keeps it. Keep a campaign the mirror
 * does not know yet. Never wipe a recipe down to zero routing rules: that is a
 * mirror miss, not a trim.
 */
export function trimForeignCampaigns<T extends Pick<Recipe, "smartlead_client_id" | "routing" | "segments">>(
  recipe: T,
  owners: ReadonlyMap<number, number | null>,
): { recipe: T; dropped: number[] } {
  const dropped: number[] = [];
  const routing = recipe.routing.filter((rule) => {
    if (!owners.has(rule.campaign_id)) return true;
    if (owners.get(rule.campaign_id) === recipe.smartlead_client_id) return true;
    dropped.push(rule.campaign_id);
    return false;
  });
  if (dropped.length === 0 || routing.length === 0) return { recipe, dropped: [] };
  const segments = { ...recipe.segments };
  if (Array.isArray(segments.slot)) {
    const keep = new Set(routing.map((rule) => rule.when.slot).filter((slot): slot is string => typeof slot === "string"));
    segments.slot = segments.slot.filter((slot) => keep.has(slot));
  }
  return { recipe: { ...recipe, routing: routing as RoutingRule[], segments }, dropped };
}

/** Drop routing rules that public.campaigns assigns to a different Smartlead client. */
export async function trimToOwningClient(repo: Repo, recipe: Recipe): Promise<{ recipe: Recipe; dropped: number[] }> {
  const ids = [...new Set(recipe.routing.map((rule) => rule.campaign_id))];
  if (ids.length === 0) return { recipe, dropped: [] };
  let rows: Array<{ id: string; client: string | null }> = [];
  try {
    const res = await repo.raw().query<{ id: string; client: string | null }>(
      `select smartlead_campaign_id::text as id, smartlead_client_id::text as client
         from public.campaigns
        where smartlead_campaign_id = any($1::bigint[])`,
      [ids],
    );
    rows = res.rows;
  } catch {
    return { recipe, dropped: [] };
  }
  const owners = new Map<number, number | null>();
  for (const row of rows) {
    const id = Number(row.id);
    if (!Number.isInteger(id)) continue;
    owners.set(id, row.client == null ? null : Number(row.client));
  }
  return trimForeignCampaigns(recipe, owners);
}
