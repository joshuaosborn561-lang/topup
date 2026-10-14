import { isStoppedStatus } from "../policy/rules.js";
import { BUILT_IN_DIMENSIONS, dimensionSegments, parseDimensions, type Dimension } from "./dimensions.js";
import type { RegistryCampaign } from "./registry.js";

/**
 * Lane-level split (D105). A top-up sizes the lane, then after a named
 * yes the new leads go to that lane's refillable campaigns the way the
 * playbook / list_build_records already segmented them (D106). The split
 * is read from the lane's build transcript and is the truth the way the
 * build is; it quotes on its own, no confirmation step (D107). STOPPED is
 * never a target. Nothing here invents a client, a recipe or a segment
 * name; what the transcript does not say is a plain question to Josh.
 */

export type RoutingRule = { when: Record<string, string>; campaign_id: number };

export interface LaneRecord {
  campaign_ids: number[];
  lanes: string[] | null;
  yield_by_step?: unknown;
  source_refs?: unknown;
}

export type LaneSplitOk = {
  ok: true;
  lane: string;
  campaign_ids: number[];
  stopped_ids: number[];
  routing: RoutingRule[];
  segments: Record<string, string[]>;
  /** D106: derived dimensions the record names; the route step computes them per row. */
  dimensions: Dimension[];
  /** The plain-English rule as recorded, for the quote. */
  split_rule: string | null;
  confirmed_by: string | null;
  source: "record_routing" | "registry_cells" | "single_campaign";
};

export type LaneSplitFail = {
  ok: false;
  lane: string;
  reason: string;
  campaign_ids: number[];
  stopped_ids: number[];
};

export type LaneSplit = LaneSplitOk | LaneSplitFail;

export const NO_SEGMENTATION =
  "segmentation for this lane cannot be determined from list_build_records / the playbook. The service will not guess. Ask Josh to record how the lane splits (routing on the build record, or unique stored cells on the named campaigns).";

/** The name on the record if a person signed the split. Informational since D107: the split read from the transcript quotes on its own. */
export function confirmedBy(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>).confirmed_by;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function splitRuleText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>).split_rule;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : null;
}

function fail(lane: string, reason: string, campaign_ids: number[], stopped_ids: number[]): LaneSplitFail {
  return { ok: false, lane, reason, campaign_ids, stopped_ids };
}

/** A `routing` array stored on a build record (yield_by_step or source_refs). Missing or malformed is not a guess: it is "not there". */
export function routingFromRecord(value: unknown): RoutingRule[] | null {
  if (value == null) return null;
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const raw = obj && "routing" in obj ? obj.routing : Array.isArray(value) ? value : null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: RoutingRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const campaign_id = Number(row.campaign_id);
    if (!Number.isInteger(campaign_id) || campaign_id <= 0) return null;
    const when = row.when;
    if (when == null || typeof when !== "object" || Array.isArray(when)) return null;
    const w: Record<string, string> = {};
    for (const [k, v] of Object.entries(when as Record<string, unknown>)) {
      if (typeof v !== "string") return null;
      w[k] = v;
    }
    out.push({ when: w, campaign_id });
  }
  return out;
}

export function segmentsFromRecord(value: unknown): Record<string, string[]> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).segments;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
    out[k] = v.map(String);
  }
  return Object.keys(out).length ? out : null;
}

function namedOnRecords(records: readonly LaneRecord[], lane: string, members: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (const rec of records) {
    const onLane = (rec.lanes ?? []).map((l) => l.trim()).includes(lane);
    for (const id of rec.campaign_ids) {
      if (!members.has(id)) continue;
      if (onLane || members.has(id)) out.add(id);
    }
  }
  return out;
}

function cellOf(m: RegistryCampaign): Record<string, string> {
  const cell: Record<string, string> = {};
  if (m.band) cell.band = m.band;
  if (m.mail_class) cell.mail_class = m.mail_class;
  if (m.gift_key) cell.gift = m.gift_key;
  return cell;
}

function cellKey(cell: Record<string, string>): string {
  return Object.keys(cell)
    .sort()
    .map((k) => `${k}=${cell[k]}`)
    .join("|");
}

function segmentsFromCells(cells: Array<{ campaign_id: number; cell: Record<string, string> }>): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const { cell } of cells) {
    for (const [dim, value] of Object.entries(cell)) {
      const set = out[dim] ?? new Set<string>();
      set.add(value);
      out[dim] = set;
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/**
 * How this lane splits, from the recorded campaigns and any routing stored
 * on their list_build_records. STOPPED ids are dropped. If the records do
 * not determine a split, the answer is a reason, not a guess.
 */
export function resolveLaneSegmentation(input: {
  lane: string;
  members: readonly RegistryCampaign[];
  statuses: ReadonlyMap<number, string | null>;
  records: readonly LaneRecord[];
}): LaneSplit {
  const lane = input.lane.trim();
  const onLane = input.members.filter((m) => (m.lane ?? "").trim() === lane);
  const memberIds = new Set(onLane.map((m) => m.campaign_id));
  const stopped = onLane.filter((m) => isStoppedStatus(input.statuses.get(m.campaign_id) ?? m.status)).map((m) => m.campaign_id);
  const stoppedSet = new Set(stopped);
  const refillable = onLane.filter((m) => !stoppedSet.has(m.campaign_id));
  const refillableIds = refillable.map((m) => m.campaign_id).sort((a, b) => a - b);

  if (onLane.length === 0) {
    return fail(lane, `no campaigns in campaign_registry for this lane. Adding them is a row in that table. Ask Josh.`, [], []);
  }
  if (refillableIds.length === 0) {
    return fail(lane, `every campaign on this lane is STOPPED. STOPPED is never refilled (D105).`, [], stopped);
  }

  const named = namedOnRecords(input.records, lane, memberIds);
  const namedRefillable = refillableIds.filter((id) => named.has(id));
  if (named.size === 0) {
    return fail(lane, `no list_build_records name this lane or its campaigns. There is no recorded split; wait for Josh (D99, D105).`, refillableIds, stopped);
  }
  if (namedRefillable.length === 0) {
    return fail(lane, `list_build_records name this lane but every named campaign is STOPPED. STOPPED is never refilled (D105).`, [], stopped);
  }

  for (const rec of input.records) {
    const routing = routingFromRecord(rec.yield_by_step) ?? routingFromRecord(rec.source_refs);
    if (!routing) continue;
    const usable = routing.filter((r) => !stoppedSet.has(r.campaign_id) && (named.has(r.campaign_id) || memberIds.has(r.campaign_id)));
    if (usable.length === 0) {
      return fail(lane, `the recorded routing only names STOPPED campaigns. STOPPED is never refilled (D105).`, [], stopped);
    }
    const holder = routingFromRecord(rec.yield_by_step) ? rec.yield_by_step : rec.source_refs;
    const dims = parseDimensions((holder as Record<string, unknown> | null)?.dimensions);
    if (dims !== null && dims.length === 0) {
      return fail(lane, `the recorded split names dimensions the service cannot read (a column outside the lane, a bad pattern, or a reserved name). Nothing is guessed; fix the record. Ask Josh.`, refillableIds, stopped);
    }
    const dimensions = dims ?? [];
    const known = new Set([...BUILT_IN_DIMENSIONS, ...dimensions.map((d) => d.name)]);
    const unknownDim = usable.flatMap((r) => Object.keys(r.when)).find((k) => !known.has(k));
    if (unknownDim) {
      return fail(lane, `the recorded routing uses a dimension "${unknownDim}" the record does not define and the service does not compute. Nothing is guessed; fix the record. Ask Josh.`, refillableIds, stopped);
    }
    // D107: the split read from the recorded build is the truth, like the build itself. No confirmation step.
    const who = confirmedBy(holder);
    const segs = segmentsFromRecord(rec.yield_by_step) ?? segmentsFromRecord(rec.source_refs) ?? {};
    return {
      ok: true,
      lane,
      campaign_ids: [...new Set(usable.map((r) => r.campaign_id))].sort((a, b) => a - b),
      stopped_ids: stopped,
      routing: usable,
      segments: { ...dimensionSegments(dimensions), ...segs },
      dimensions,
      split_rule: splitRuleText(holder),
      confirmed_by: who,
      source: "record_routing",
    };
  }

  if (namedRefillable.length === 1) {
    const id = namedRefillable[0]!;
    return {
      ok: true,
      lane,
      campaign_ids: [id],
      stopped_ids: stopped,
      routing: [{ when: {}, campaign_id: id }],
      segments: {},
      dimensions: [],
      split_rule: null,
      confirmed_by: null,
      source: "single_campaign",
    };
  }

  const byId = new Map(onLane.map((m) => [m.campaign_id, m]));
  const cells = namedRefillable.map((id) => ({ campaign_id: id, cell: cellOf(byId.get(id)!) }));
  if (cells.some((c) => Object.keys(c.cell).length === 0)) {
    return fail(lane, `${NO_SEGMENTATION} Named refillable campaigns: ${namedRefillable.length}; STOPPED excluded: ${stopped.length}.`, namedRefillable, stopped);
  }
  const seen = new Map<string, number>();
  for (const c of cells) {
    const key = cellKey(c.cell);
    const prev = seen.get(key);
    if (prev != null) {
      return fail(lane, `${NO_SEGMENTATION} Two named campaigns share the same stored cell. Named refillable: ${namedRefillable.length}.`, namedRefillable, stopped);
    }
    seen.set(key, c.campaign_id);
  }
  return {
    ok: true,
    lane,
    campaign_ids: namedRefillable,
    stopped_ids: stopped,
    routing: cells.map((c) => ({ when: c.cell, campaign_id: c.campaign_id })),
    segments: segmentsFromCells(cells),
    dimensions: [],
    split_rule: null,
    confirmed_by: null,
    source: "registry_cells",
  };
}
