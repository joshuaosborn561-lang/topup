import { isStoppedStatus } from "../policy/rules.js";
import { BUILT_IN_DIMENSIONS, dimensionSegments, parseDimensions, type Dimension } from "./dimensions.js";
import type { RegistryCampaign } from "./registry.js";

/**
 * Lane-level split (D105). A top-up sizes the lane, then after a named
 * yes the new leads go to that lane's refillable campaigns the way the
 * campaign's chats split them. Nothing stored decides that split (D108):
 * Grokbot reads the lane's build transcript and the process chats, works
 * out how the leads were split, and passes it with the pool as general
 * data (a plain-English rule, the routing, the dimensions it reads, and
 * where it read them). This file checks that against the lane and never
 * guesses, never stores a rule, never invents a client, a recipe or a
 * segment name. STOPPED is never a target. What the chats do not say is
 * a plain question to Josh.
 */

export type RoutingRule = { when: Record<string, string>; campaign_id: number };

/** What the service needs to know about a list_build_records row: which lane and campaigns it is about. Nothing on it decides a split. */
export interface LaneRecord {
  campaign_ids: number[];
  lanes: string[] | null;
}

/** The split Grokbot passes with the pool (D108), as it arrives: checked here, never trusted blindly. */
export interface GrokSplit {
  rule: string;
  routing: RoutingRule[];
  dimensions?: unknown;
  from?: string[];
}

export type LaneSplitOk = {
  ok: true;
  lane: string;
  campaign_ids: number[];
  stopped_ids: number[];
  routing: RoutingRule[];
  segments: Record<string, string[]>;
  /** D106: derived dimensions the split names; the route step computes them per row. */
  dimensions: Dimension[];
  /** The plain-English rule as Grokbot read it from the chats, for the quote. */
  split_rule: string | null;
  /** Where Grokbot read it (transcript steps, chat names). */
  split_from: string[];
  source: "grok_split" | "single_campaign";
};

export type LaneSplitFail = {
  ok: false;
  lane: string;
  reason: string;
  campaign_ids: number[];
  stopped_ids: number[];
};

export type LaneSplit = LaneSplitOk | LaneSplitFail;

export const NO_SPLIT_PASSED =
  "this lane has more than one refillable campaign and no split was passed. Nothing stored decides a split (D108): read the lane's build transcript and the process chats, work out how the leads were split across these campaigns, and pass it on topup as split (rule, routing, dimensions, from). If the chats do not say, ask Josh one plain question. The service never guesses.";

function fail(lane: string, reason: string, campaign_ids: number[], stopped_ids: number[]): LaneSplitFail {
  return { ok: false, lane, reason, campaign_ids, stopped_ids };
}

/** A well-formed routing array; anything else is "not a split", never a guess. */
export function parseRouting(value: unknown): RoutingRule[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: RoutingRule[] = [];
  for (const item of value) {
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

/**
 * How this lane splits: the campaigns the registry and the build records
 * name, STOPPED dropped, and the split Grokbot read from the chats checked
 * against them. If nothing was passed and more than one campaign could
 * take leads, the answer is a reason, not a guess.
 */
export function resolveLaneSegmentation(input: {
  lane: string;
  members: readonly RegistryCampaign[];
  statuses: ReadonlyMap<number, string | null>;
  records: readonly LaneRecord[];
  /** The split Grokbot passed with the pool, if any (D108). */
  split?: GrokSplit | null;
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
    return fail(lane, `no list_build_records name this lane or its campaigns. There is no recorded build to read; wait for Josh (D99, D105).`, refillableIds, stopped);
  }
  if (namedRefillable.length === 0) {
    return fail(lane, `list_build_records name this lane but every named campaign is STOPPED. STOPPED is never refilled (D105).`, [], stopped);
  }

  const split = input.split ?? null;
  if (split) {
    const routing = parseRouting(split.routing);
    if (!routing) {
      return fail(lane, `the split passed has no readable routing: each rule is {when: {dimension: value}, campaign_id}. Nothing is guessed; pass it again as read from the chats.`, refillableIds, stopped);
    }
    const foreign = routing.map((r) => r.campaign_id).filter((id) => !memberIds.has(id));
    if (foreign.length) {
      return fail(lane, `the split names campaign(s) ${[...new Set(foreign)].map((id) => `#${id}`).join(", ")} that are not on lane ${lane} in campaign_registry. A lane only refills its own campaigns; if the registry is wrong, that is a row for Josh to fix.`, refillableIds, stopped);
    }
    const usable = routing.filter((r) => !stoppedSet.has(r.campaign_id));
    if (usable.length === 0) {
      return fail(lane, `the split only names STOPPED campaigns. STOPPED is never refilled (D105).`, [], stopped);
    }
    const dims = parseDimensions(split.dimensions);
    if (dims !== null && dims.length === 0) {
      return fail(lane, `the split names dimensions the service cannot read (a column outside the lane, a bad pattern, or a reserved name). Nothing is guessed; the four kinds are match, set, present and hash_parity over lane columns (D106).`, refillableIds, stopped);
    }
    const dimensions = dims ?? [];
    const known = new Set([...BUILT_IN_DIMENSIONS, ...dimensions.map((d) => d.name)]);
    const unknownDim = usable.flatMap((r) => Object.keys(r.when)).find((k) => !known.has(k));
    if (unknownDim) {
      return fail(lane, `the split routes on a dimension "${unknownDim}" it does not define and the service does not compute (built in: ${BUILT_IN_DIMENSIONS.join(", ")}). Nothing is guessed; define it in dimensions.`, refillableIds, stopped);
    }
    const rule = typeof split.rule === "string" && split.rule.trim() ? split.rule.trim().slice(0, 2000) : null;
    if (!rule) {
      return fail(lane, `the split has no plain-English rule. Say in one short paragraph how the chats split this lane, so the quote can repeat it.`, refillableIds, stopped);
    }
    const from = Array.isArray(split.from) ? split.from.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 200)).slice(0, 40) : [];
    return {
      ok: true,
      lane,
      campaign_ids: [...new Set(usable.map((r) => r.campaign_id))].sort((a, b) => a - b),
      stopped_ids: stopped,
      routing: usable,
      segments: dimensionSegments(dimensions),
      dimensions,
      split_rule: rule,
      split_from: from,
      source: "grok_split",
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
      split_from: [],
      source: "single_campaign",
    };
  }

  return fail(lane, `${NO_SPLIT_PASSED} Refillable campaigns on this lane: ${namedRefillable.map((id) => `#${id}`).join(", ")}; STOPPED excluded: ${stopped.length}.`, namedRefillable, stopped);
}
