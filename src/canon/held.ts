import { heldInPool, type MeasureDeps } from "../plan/measure.js";
import { getleadsParamsFromFilters } from "../recipes/infer.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import type { GetleadsFilters } from "../clients/getleads.js";

/**
 * How much of a getleads pool the client already holds (D52): a page of
 * the pool is matched against what the client sent in the recycle window
 * and its live campaigns, and the share is scaled to the count Grok gives.
 * The answer is a count and the method; the rule is stated; Grok applies it.
 */
export interface HeldRead {
  source: "getleads";
  filters_used: Record<string, unknown>;
  tam: number;
  held: number;
  net_new: number;
  method: string;
  sampled: number;
  matched: number;
  note: string;
  rule: string;
}

export const HELD_RULE = `net_new is the count minus what the client already holds. Under ${MIN_NET_NEW}, the TAM for this campaign is exhausted.`;

export async function heldRead(
  d: MeasureDeps,
  input: { client_tag: string; smartlead_client_id: number; campaign_ids: readonly number[]; filters: Record<string, unknown>; tam: number; days?: number },
): Promise<HeldRead | { error: string }> {
  const params = getleadsParamsFromFilters(input.filters);
  if (!params) return { error: "held needs getleads filters: job_titles, or job_function plus seniority; company_size as band labels when given." };
  if (!Number.isFinite(input.tam) || input.tam < 0) return { error: "tam must be the count from count(source=\"getleads\", ...)." };
  const { max_per_company: _cap, ...filters } = params as GetleadsFilters & { max_per_company?: number };
  const r = await heldInPool(d, { runId: "canon", clientTag: input.client_tag }, { clientId: input.smartlead_client_id, campaignIds: input.campaign_ids, days: input.days ?? 90, excludeLive: true, tam: Math.floor(input.tam), filters: filters as GetleadsFilters });
  return {
    source: "getleads",
    filters_used: filters,
    tam: Math.floor(input.tam),
    held: r.count,
    net_new: Math.max(0, Math.floor(input.tam) - r.count),
    method: String(r.method),
    sampled: r.sampled,
    matched: r.matched,
    note: r.note,
    rule: HELD_RULE,
  };
}
