import type { Queryable } from "../db/pool.js";
import { campaignStatuses } from "../ledger/health.js";
import { isUnassignedLane } from "../canon/lanes.js";
import { resolveLaneSegmentation, type LaneRecord } from "../canon/laneSplit.js";
import { registryRows, type RegistryCampaign } from "../canon/registry.js";
import { isColdCall, isNeverTopUp } from "../policy/rules.js";
import type { LaneJobSplit } from "./settings.js";
import { plainError } from "./preflight.js";

/**
 * Load the lane's recorded split (D105). The playbook / list_build_records
 * name the campaigns; STOPPED is dropped; if the records do not determine
 * a split the answer is a reason, not a guess.
 */

export async function loadLaneRecords(db: Queryable, clientTag: string, lane: string, memberIds: readonly number[]): Promise<LaneRecord[]> {
  const { rows } = await db.query<{ campaign_ids: unknown; lanes: unknown; yield_by_step: unknown; source_refs: unknown }>(
    `select campaign_ids, lanes, yield_by_step, source_refs
       from topup.list_build_records
      where client_tag = $1
        and ($2 = any(lanes) or campaign_ids && $3::bigint[])
      order by session_date desc, id desc`,
    [clientTag, lane, memberIds],
  );
  return rows.map((r) => ({
    campaign_ids: Array.isArray(r.campaign_ids) ? r.campaign_ids.map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [],
    lanes: Array.isArray(r.lanes) ? r.lanes.map(String) : null,
    yield_by_step: r.yield_by_step,
    source_refs: r.source_refs,
  }));
}

export async function planLaneJob(
  db: Queryable,
  input: {
    client_tag: string;
    lane?: string | null;
    campaign_id?: number | null;
    registry: readonly Record<string, unknown>[];
    names?: ReadonlyMap<number, string | null>;
  },
): Promise<{ ok: true; split: LaneJobSplit; stopped_ids: number[] } | { ok: false; message: string; no_lane?: boolean }> {
  const rows = registryRows(input.registry);
  const fromCampaign = input.campaign_id != null ? rows.find((r) => r.campaign_id === input.campaign_id) : undefined;
  const lane = (input.lane ?? fromCampaign?.lane ?? "").trim();
  if (!lane) return { ok: false, message: "this campaign has no lane in campaign_registry; quoted as one campaign if it has a recorded build.", no_lane: true };
  if (isUnassignedLane(lane)) return { ok: false, message: `lane ${lane} is a parking lot, not a top-up lane (D96).` };

  const members: RegistryCampaign[] = rows.filter((r) => (r.lane ?? "").trim() === lane && r.client_tag === input.client_tag);
  const usableMembers = members.filter((m) => {
    const name = input.names?.get(m.campaign_id) ?? m.campaign_name ?? null;
    return !isColdCall(name) && !isNeverTopUp(m.campaign_id, name);
  });
  const ids = usableMembers.map((m) => m.campaign_id);
  if (ids.length === 0) return { ok: false, message: `lane ${lane} has no refillable campaigns in campaign_registry (cold-call and never-top-up already ignored).` };

  let statuses: Map<number, string | null>;
  let liveNames: Map<number, string | null> = new Map();
  try {
    const live = await campaignStatuses(db, ids);
    statuses = live.status;
    liveNames = live.names;
  } catch {
    statuses = new Map(usableMembers.map((m) => [m.campaign_id, m.status ?? null]));
  }
  const names = new Map<number, string | null>([...liveNames, ...(input.names ?? [])]);
  const namedMembers = usableMembers.filter((m) => {
    const name = names.get(m.campaign_id) ?? m.campaign_name ?? null;
    return !isColdCall(name) && !isNeverTopUp(m.campaign_id, name);
  });
  if (namedMembers.length === 0) return { ok: false, message: `lane ${lane} has no refillable campaigns after ignoring cold-call and never-top-up (D46, D54).` };

  let records: LaneRecord[];
  try {
    records = await loadLaneRecords(db, input.client_tag, lane, namedMembers.map((m) => m.campaign_id));
  } catch (err) {
    return { ok: false, message: `Could not read topup.list_build_records (${plainError(err)}). That is a database error, not a missing build: try again, and ask Josh if it keeps failing.` };
  }

  const split = resolveLaneSegmentation({ lane, members: namedMembers, statuses, records });
  if (!split.ok) return { ok: false, message: split.reason };
  return {
    ok: true,
    split: {
      lane: split.lane,
      campaign_ids: split.campaign_ids,
      routing: split.routing,
      segments: split.segments,
      pointed_from_campaign_id: input.campaign_id && split.campaign_ids.includes(input.campaign_id) ? input.campaign_id : input.campaign_id ?? null,
    },
    stopped_ids: split.stopped_ids,
  };
}
