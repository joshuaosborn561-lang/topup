import {
  ASK,
  countsAgree,
  isActiveStatus,
  isDroppedLabel,
  isIgnoredClient,
  isNeverTopUp,
  isPausedLabel,
  isRetiredCampaign,
  isSuspectFilter,
  MIN_NET_NEW,
  PILOT_GATE_PERCENT,
  ratePer2000,
  REPLY_BAR_PER_2000,
} from "./rules.js";

/**
 * One verdict per campaign (D46). The queue, the watch, the size step and
 * the start path all call `evaluateCampaign` with whatever facts they have.
 * The first failing rule names the gate; the reason is one line of counts.
 * A campaign that fails is skipped with its reason. The others continue.
 * Parking is per campaign, never per run.
 */
export type CampaignGate =
  | "ok"
  | "excluded"
  | "ignored_client"
  | "retired"
  | "dropped"
  | "paused"
  | "not_active"
  | "foreign_client"
  | "under_reply_bar"
  | "no_company_filter"
  | "not_sized"
  | "pilot_mismatch"
  | "suspect_filter"
  | "tam_source_missing"
  | "tam_mismatch"
  | "tam_filled";

export type TamCheck = "ok" | "tam_mismatch" | "single_source" | "tam_source_missing";

export interface PilotVerdict {
  gate: "ok" | "pilot_mismatch";
  failed: readonly string[];
  rows_scored: number;
}

/** What the caller knows. Missing sizing facts skip the sizing rules; they do not fail them. */
export interface CampaignFacts {
  campaign_id: number;
  campaign_name?: string | null;
  client_tag: string;
  lane?: string | null;
  /** The client's Smartlead id, and the one the mirror holds for this campaign. */
  smartlead_client_id?: number | null;
  campaign_client_id?: number | null;
  /** Smartlead status from the mirror. null or blank is treated as ACTIVE (the mirror did not classify it). */
  status?: string | null;
  /** Lifetime sends and interested replies for this campaign. */
  sends: number;
  positives: number;
  /** Josh's /working override. true passes the bar; false fails it. */
  working_override?: boolean | null;
  /** Sizing facts. Leave them out when the campaign has not been sized. */
  sized?: boolean;
  tam_total?: number | null;
  tam_left?: number | null;
  tam_check?: TamCheck | null;
  pilot?: PilotVerdict | null;
  /** false when the recipe has no company filter at all (titles alone never size a pool). */
  has_company_filter?: boolean;
  rows_found_last_build?: number | null;
  market_cap?: number | null;
}

export interface CampaignVerdict {
  campaign_id: number;
  gate: CampaignGate;
  /** One line: counts and names only. Never a lead row. */
  reason: string;
  /** True only when every rule the facts allow to be tested passed. */
  qualifies: boolean;
  /** Interested replies per 2,000 sends, from the facts. */
  reply_rate_per_2000: number;
  /** True when the sizing rules were not tested because the campaign has no sizing facts yet. */
  sizing_pending: boolean;
}

export function replyBarPasses(f: Pick<CampaignFacts, "sends" | "positives" | "working_override">): { ok: boolean; why: string } {
  const rate = ratePer2000(f.sends, f.positives);
  if (f.working_override === true) return { ok: true, why: `owner override on (${f.positives} interested in ${f.sends} sends)` };
  if (f.working_override === false) return { ok: false, why: `owner override off (${f.positives} interested in ${f.sends} sends)` };
  if (f.positives < 1) return { ok: false, why: `0 interested in ${f.sends} sends; a campaign with no positive reply does not qualify, however few sends it has` };
  if (rate < REPLY_BAR_PER_2000) {
    return { ok: false, why: `${f.positives} interested in ${f.sends} sends (${rate.toFixed(2)} per 2,000) is under ${REPLY_BAR_PER_2000} per 2,000` };
  }
  return { ok: true, why: `${f.positives} interested in ${f.sends} sends (${rate.toFixed(2)} per 2,000)` };
}

function verdict(f: CampaignFacts, gate: CampaignGate, reason: string, sizingPending: boolean): CampaignVerdict {
  return {
    campaign_id: f.campaign_id,
    gate,
    reason,
    qualifies: gate === "ok",
    reply_rate_per_2000: Math.round(ratePer2000(f.sends, f.positives) * 100) / 100,
    sizing_pending: sizingPending,
  };
}

/**
 * Eligibility first (facts the queue always has), then sizing (facts a size
 * step adds). The first failing rule wins. Every reason says what to do.
 */
export function evaluateCampaign(f: CampaignFacts): CampaignVerdict {
  const id = `#${f.campaign_id}`;
  if (isNeverTopUp(f.campaign_id, f.campaign_name)) {
    return verdict(f, "excluded", `${id} is on the never-top-up list (SG Gabe Calls, SG Cayden Calls, SG Nurture). ${ASK}`, false);
  }
  if (isIgnoredClient(f.client_tag)) {
    return verdict(f, "ignored_client", `${f.client_tag} is ignored until Josh says otherwise. ${ASK}`, false);
  }
  if (isRetiredCampaign(f.client_tag, f.campaign_id)) {
    return verdict(f, "retired", `${id} is retired. Parlay top ups use the Sept 29 refresh only. ${ASK}`, false);
  }
  if (isDroppedLabel(f.campaign_name) || isDroppedLabel(f.lane)) {
    return verdict(f, "dropped", `${id} is dropped (no positives); it never starts, not even from the watch. ${ASK}`, false);
  }
  if (isPausedLabel(f.campaign_name) || isPausedLabel(f.lane)) {
    return verdict(f, "paused", `${id} is paused; it never starts, not even from the watch. ${ASK}`, false);
  }
  if (!isActiveStatus(f.status)) {
    return verdict(f, "not_active", `${id} is ${String(f.status).trim().toUpperCase()} in Smartlead; only ACTIVE campaigns are targets`, false);
  }
  if (f.smartlead_client_id != null && f.campaign_client_id != null && f.smartlead_client_id !== f.campaign_client_id) {
    return verdict(
      f,
      "foreign_client",
      `${id} belongs to Smartlead client ${f.campaign_client_id}, not ${f.smartlead_client_id}; a lane only targets its own client's campaigns`,
      false,
    );
  }
  const bar = replyBarPasses(f);
  if (!bar.ok) return verdict(f, "under_reply_bar", `${id}: ${bar.why}`, false);
  if (f.has_company_filter === false) {
    return verdict(f, "no_company_filter", `${id}: the recipe has no usable company filter; a pool is never sized from titles alone. ${ASK}`, false);
  }

  const hasSizing = f.sized === true || f.tam_left != null || f.tam_check != null || f.pilot != null;
  if (f.sized === false) return verdict(f, "not_sized", `${id} has not been sized`, true);
  if (!hasSizing) return verdict(f, "ok", `${id}: ${bar.why}; sizing pending`, true);

  if (f.pilot && f.pilot.gate !== "ok") {
    const failed = f.pilot.failed.length ? f.pilot.failed.join(", ") : "a scored dimension";
    return verdict(f, "pilot_mismatch", `${id}: pilot ${failed} under ${PILOT_GATE_PERCENT}% on ${f.pilot.rows_scored} scored rows; the query does not match the recipe. ${ASK}`, false);
  }
  const tamTotal = f.tam_total ?? null;
  if (tamTotal != null && isSuspectFilter(tamTotal, f.rows_found_last_build ?? null, f.market_cap ?? null)) {
    return verdict(f, "suspect_filter", `${id}: TAM ${tamTotal} is more than 20× the build it repeats or outside the known market; suspect filter. ${ASK}`, false);
  }
  if (f.tam_check === "tam_source_missing") {
    return verdict(f, "tam_source_missing", `${id}: no stored pool for a non-LinkedIn ICP; not sized from a getleads count. ${ASK}`, false);
  }
  if (f.tam_check === "tam_mismatch") {
    return verdict(f, "tam_mismatch", `${id}: getleads and AI Ark are more than 10% apart; both counts are reported. ${ASK}`, false);
  }
  const left = f.tam_left ?? tamTotal ?? 0;
  if (left < MIN_NET_NEW) {
    return verdict(f, "tam_filled", `${id}: ${left} net new is under the ${MIN_NET_NEW} minimum; TAM filled, not topped up`, false);
  }
  return verdict(f, "ok", `${id}: ${bar.why}; ${left} net new`, false);
}

/** The same yardstick for two vendor counts, exported so the planner cannot drift. */
export function linkedinCountsAgree(getleads: number, aiArk: number): boolean {
  return countsAgree(getleads, aiArk);
}
