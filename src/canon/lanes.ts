/**
 * Registry lanes the service understands as system states, not top-up
 * lanes (D96). `unassigned` is a parking lot.
 */

export const UNASSIGNED_LANE = "unassigned";

export function isUnassignedLane(lane: string | null | undefined): boolean {
  return (lane ?? "").trim().toLowerCase() === UNASSIGNED_LANE;
}

export const UNASSIGNED_SKIP_NOTE =
  "Registry lane unassigned is a parking lot, not a top-up lane. Skip it. Do not retag stamps onto it or off it (D96).";
