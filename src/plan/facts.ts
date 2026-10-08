import type { Queryable } from "../db/pool.js";
import type { CampaignPerformance } from "../builds/choose.js";
import type { CampaignSnapshot } from "../ledger/health.js";
import { evaluateCampaign, type CampaignFacts, type CampaignVerdict } from "../policy/index.js";
import type { Recipe } from "../recipes/schema.js";

/**
 * The facts the policy layer judges a campaign on, before any vendor call
 * (D46). Name, status and client from the mirror; lifetime sends and
 * positives; Josh's override. Counts and ids only.
 */
export interface EligibilityInput {
  recipe: Recipe;
  campaignIds: readonly number[];
  snapshots: readonly CampaignSnapshot[];
  performance: ReadonlyMap<number, CampaignPerformance>;
  owners: ReadonlyMap<number, number | null>;
  overrides: ReadonlyMap<number, boolean | null>;
  /** false for a campaign whose route has no company filter. */
  companyFilter: (campaignId: number) => boolean;
}

export interface Eligibility {
  facts: CampaignFacts;
  verdict: CampaignVerdict;
}

export function eligibilityFor(input: EligibilityInput): Map<number, Eligibility> {
  const out = new Map<number, Eligibility>();
  for (const id of input.campaignIds) {
    const snap = input.snapshots.find((s) => s.smartlead_campaign_id === id);
    const perf = input.performance.get(id);
    const facts: CampaignFacts = {
      campaign_id: id,
      campaign_name: snap?.name ?? null,
      client_tag: input.recipe.client_tag,
      lane: input.recipe.lane,
      smartlead_client_id: input.recipe.smartlead_client_id,
      campaign_client_id: input.owners.has(id) ? (input.owners.get(id) ?? null) : null,
      status: snap ? snap.status : null,
      sends: perf?.sends ?? 0,
      positives: perf?.positives ?? 0,
      working_override: input.overrides.get(id) ?? null,
      has_company_filter: input.companyFilter(id),
    };
    out.set(id, { facts, verdict: evaluateCampaign(facts) });
  }
  return out;
}

/** Smartlead client id per campaign from the mirror. A campaign the mirror does not know is absent. */
export async function campaignOwners(db: Queryable, campaignIds: readonly number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (campaignIds.length === 0) return out;
  try {
    const { rows } = await db.query<{ id: string; client: string | null }>(
      `select smartlead_campaign_id::text as id, smartlead_client_id::text as client
         from public.campaigns where smartlead_campaign_id = any($1::bigint[])`,
      [campaignIds],
    );
    for (const row of rows) out.set(Number(row.id), row.client == null ? null : Number(row.client));
  } catch {
    /* no mirror here: the policy cannot test the client, and says nothing about it */
  }
  return out;
}
