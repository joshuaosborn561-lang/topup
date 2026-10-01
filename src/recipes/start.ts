/**
 * Resolve start_topup the way the operator skill calls it: client + campaign
 * id (and an optional lead count), or client + lane. Lane may come from a
 * pull receipt. Do not invent a recipe (D45).
 */

export type StartTarget =
  | { ok: true; clientTag: string; lane?: string; campaignIds?: number[]; requestedCount?: number }
  | { ok: false; message: string };

export function resolveStartTarget(input: {
  clientTag: string;
  lane?: string | null;
  campaignId?: number | null;
  count?: number | null;
}): StartTarget {
  const count = input.count != null && Number.isFinite(input.count) && input.count > 0 ? Math.floor(input.count) : undefined;
  const requested = count !== undefined ? { requestedCount: count } : {};
  if (!input.lane && !input.campaignId) {
    return {
      ok: false,
      message: `Need lane or campaign_id for ${input.clientTag}. start_topup(client_tag, campaign_id, count) or start_topup(client_tag, lane).`,
    };
  }
  return {
    ok: true,
    clientTag: input.clientTag,
    ...(input.lane ? { lane: input.lane } : {}),
    ...(input.campaignId ? { campaignIds: [input.campaignId] } : {}),
    ...requested,
  };
}
