import { logger } from "../lib/log.js";
import type { SlackConsole } from "../slack/console.js";
import type { LaneLedger } from "./lane.js";
import { buildDigest } from "./render.js";

const log = logger("digest");

/**
 * The daily digest (addendum section 2): one post in the ops channel that
 * only names lanes whose state changed or whose campaign health crossed a
 * line since the last digest. Silent when nothing moved. Registered queue
 * counts are refreshed first so the numbers are today's.
 */
export async function runDigest(d: { ledger: LaneLedger; console: Pick<SlackConsole, "postOps"> }): Promise<{ lanes: number; posted: boolean }> {
  const lanes = await d.ledger.lanes();
  const states = [];
  const previous: Record<string, string | null> = {};
  for (const l of lanes) {
    const row = await d.ledger.stateRow(l.client_tag, l.lane);
    previous[`${l.client_tag}/${l.lane}`] = row?.digest_fingerprint ?? null;
    states.push(await d.ledger.state(l.client_tag, l.lane, { recount: true }));
  }
  const digest = buildDigest(states, previous);
  if (digest.text) await d.console.postOps(digest.text);
  for (const [key, fp] of Object.entries(digest.fingerprints)) {
    const [client_tag, lane] = key.split("/");
    await d.ledger.markDigest(client_tag, lane, fp);
  }
  log.info("digest", { lanes: lanes.length, posted: Boolean(digest.text) });
  return { lanes: lanes.length, posted: Boolean(digest.text) };
}
