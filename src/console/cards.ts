import { usd } from "../spend/prices.js";

/**
 * Block Kit builders. Every card with buttons references a topup.cards row by
 * card_id so a tap can be validated and resolved exactly once. Cards carry
 * counts, ids, dollars and statuses — never a lead row, except up to ten
 * sample rows on a segment proposal (brief section 8).
 */

export type Block = Record<string, unknown>;

export interface CardChoice {
  choice: string;
  label: string;
  style?: "primary" | "danger";
}

export function section(text: string): Block {
  return { type: "section", text: { type: "mrkdwn", text } };
}

export function context(text: string): Block {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

export function fields(pairs: Array<[string, string]>): Block {
  return {
    type: "section",
    fields: pairs.map(([k, v]) => ({ type: "mrkdwn", text: `*${k}*\n${v}` })),
  };
}

export function actions(cardId: string, choices: CardChoice[]): Block {
  return {
    type: "actions",
    block_id: `card:${cardId}`,
    elements: choices.map((c) => ({
      type: "button",
      action_id: `choice:${c.choice}`,
      text: { type: "plain_text", text: c.label },
      value: JSON.stringify({ card_id: cardId, choice: c.choice }),
      ...(c.style ? { style: c.style } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------

export interface SpendCard {
  cardId: string;
  runId: string;
  clientTag: string;
  step: string;
  vendor: string;
  action: string;
  rows: number;
  worstCaseCents: number;
  projectedUseful: number | null;
  spentTodayCents: number;
  dailyCapCents: number;
  /** Per-campaign counts. Never lead rows. */
  report?: string;
}

/** Rail 2: anything over the auto cap asks first, with the worst case in dollars. */
export function spendApprovalCard(c: SpendCard): Block[] {
  return [
    section(`:moneybag: *Spend ask — ${c.clientTag}* · run \`${c.runId.slice(0, 8)}\``),
    fields([
      ["Step", c.step],
      ["Vendor", `${c.vendor} · ${c.action}`],
      ["Rows", String(c.rows)],
      ["Worst case", `*${usd(c.worstCaseCents)}*`],
      ["Projected useful output", c.projectedUseful == null ? "unknown" : String(c.projectedUseful)],
      ["Today so far", `${usd(c.spentTodayCents)} of ${usd(c.dailyCapCents)} daily cap`],
    ]),
    ...(c.report ? [section(c.report.slice(0, 2500))] : []),
    context("Worst case is computed from the service's price table and batch size, not a vendor cost field. Silence parks the run after 24h."),
    actions(c.cardId, [
      { choice: "approve_spend", label: `Approve ${usd(c.worstCaseCents)}`, style: "primary" },
      { choice: "decline_spend", label: "Decline", style: "danger" },
    ]),
  ];
}

export interface StallCard {
  cardId: string;
  runId: string;
  clientTag: string;
  vendorRunId: string;
  percent: number;
  verified: number;
  total: number;
  resumesUsed: number;
  splitRows: number;
  splitWorstCaseCents: number;
  autoCapCents: number;
}

/** Verifier stall after the free resume did not move it. A split can bill, so it is an ask. */
export function stallCard(c: StallCard): Block[] {
  const splitIsSpend = c.splitWorstCaseCents > c.autoCapCents;
  return [
    section(`:hourglass_flowing_sand: *Verification stalled — ${c.clientTag}* · run \`${c.runId.slice(0, 8)}\``),
    fields([
      ["Verifier run", `\`${c.vendorRunId}\``],
      ["Progress", `${c.percent}% · ${c.verified} of ${c.total} verified`],
      ["Free resumes used", String(c.resumesUsed)],
      ["Split remainder", `${c.splitRows} rows in two halves · worst case *${usd(c.splitWorstCaseCents)}*`],
    ]),
    context(
      splitIsSpend
        ? `Split resubmits rows a vendor may bill again, so it counts as new spend and needs Josh.`
        : `Split worst case is under the auto cap; Cayden may tap it.`,
    ),
    actions(c.cardId, [
      { choice: "resume", label: "Resume (free)" },
      { choice: "split", label: `Split (${usd(c.splitWorstCaseCents)})`, style: "primary" },
      { choice: "abort", label: "Abort", style: "danger" },
    ]),
  ];
}

export interface QaHoldCard {
  cardId: string;
  runId: string;
  clientTag: string;
  ruleId: string;
  reason: string;
  count: number;
  /** Up to ten sample values for the held field — company names or titles, never emails. */
  samples: string[];
  rerouteTo: string | null;
}

export function qaHoldCard(c: QaHoldCard): Block[] {
  const samples = c.samples.slice(0, 10).map((s) => `• ${s}`).join("\n");
  const choices: CardChoice[] = [
    { choice: "accept", label: `Accept ${c.count}`, style: "primary" },
    { choice: "purge", label: `Purge ${c.count}`, style: "danger" },
  ];
  if (c.rerouteTo) choices.push({ choice: "reroute", label: `Reroute to ${c.rerouteTo}` });
  return [
    section(`:mag: *QA hold — ${c.clientTag}* · rule \`${c.ruleId}\` · ${c.count} leads`),
    section(c.reason),
    ...(samples ? [section(`Samples (${Math.min(10, c.samples.length)} of ${c.count}):\n${samples}`)] : []),
    actions(c.cardId, choices),
  ];
}

/** Step 8 thread summary: one line per rule with up to ten sample values (company names or titles, never emails). No buttons. */
export function qaSummaryBlocks(input: { clientTag: string; runId: string; rows: Array<{ ruleId: string; action: string; count: number; samples: string[] }>; passed: number }): Block[] {
  const lines = input.rows.map((r) => {
    const s = r.samples.slice(0, 10).map((x) => `\`${x}\``).join(", ");
    return `• *${r.ruleId}* (${r.action}) ${r.count}${s ? ` — ${s}` : ""}`;
  });
  return [
    section(`:mag: *Step 8 QA — ${input.clientTag}* · run \`${input.runId.slice(0, 8)}\` · ${input.passed} passed`),
    ...(lines.length ? [section(lines.join("\n"))] : [context("No rule matched.")]),
  ];
}

export interface PendingCampaignCard {
  cardId: string;
  runId: string;
  clientTag: string;
  lane: string;
  pending: number;
  /** Cell → count, e.g. "band=201_500 · mail_class=SEG" → 40. Never rows. */
  cells: Array<{ cell: string; count: number }>;
}

/** Step 9: leads with no campaign in the settings's routing. New campaigns are Josh's; the service never clones or creates one. */
export function pendingCampaignCard(c: PendingCampaignCard): Block[] {
  const cells = c.cells.slice(0, 10).map((x) => `• \`${x.cell}\` ${x.count}`).join("\n");
  return [
    section(`:signpost: *No campaign for ${c.pending} leads — ${c.clientTag} / ${c.lane}* · run \`${c.runId.slice(0, 8)}\``),
    section(`These cells match no routing rule in the settings:\n${cells}\nThey wait as \`pending_campaign\` in the lane. A new campaign or a routing rule is a settings change (Josh).`),
    context("Continue without: the routed leads go on to staging and these wait for a later run. Abort: nothing is staged."),
    actions(c.cardId, [
      { choice: "continue_without", label: `Continue without ${c.pending}`, style: "primary" },
      { choice: "abort", label: "Abort", style: "danger" },
    ]),
  ];
}

export interface PreLaunchInput {
  clientTag: string;
  runId: string;
  campaigns: Array<{
    campaignId: number;
    name: string | null;
    imported: number;
    runwayBefore: number | null;
    runwayAfter: number | null;
    mergeTags: string;
    settings: Array<{ check: string; verdict: "pass" | "fail" | "unknown"; detail: string }>;
    ready: boolean;
  }>;
}

/** Step 12 findings per campaign. The merge tag check is the gate; the settings are findings. */
export function preLaunchBlocks(p: PreLaunchInput): Block[] {
  const out: Block[] = [section(`:rocket: *Step 12 pre launch — ${p.clientTag}* · run \`${p.runId.slice(0, 8)}\``)];
  for (const c of p.campaigns) {
    const settings = c.settings.map((s) => `${s.verdict === "pass" ? ":white_check_mark:" : s.verdict === "fail" ? ":x:" : ":grey_question:"} ${s.check}: ${s.detail}`).join("\n");
    out.push(
      section(
        `*${c.name ?? "campaign"}* (#${c.campaignId}) · imported ${c.imported} · runway ${fmtDays(c.runwayBefore)} → ${fmtDays(c.runwayAfter)}\n` +
          `Merge tags: ${c.mergeTags}\n${settings}\n` +
          (c.ready ? "*Ready for ACTIVE* — Josh flips it; the service never does." : "*Not ready* — see above."),
      ),
    );
  }
  return out;
}

function fmtDays(d: number | null): string {
  return d === null ? "n/a" : `${d.toFixed(1)}d`;
}

export interface ParkedCard {
  cardId: string;
  runId: string;
  clientTag: string;
  step: string;
  attempts: number;
  error: string;
  report?: string;
}

export function parkedCard(c: ParkedCard): Block[] {
  return [
    section(`:octagonal_sign: *Run parked — ${c.clientTag}* · run \`${c.runId.slice(0, 8)}\` · step *${c.step}* failed ${c.attempts} times`),
    section(`\`\`\`${c.error.slice(0, 900)}\`\`\``),
    ...(c.report ? [section(c.report.slice(0, 2500))] : []),
    context("A parked run never retries on its own. Resume re-runs the step once; Abort closes the run."),
    actions(c.cardId, [
      { choice: "resume_run", label: "Resume", style: "primary" },
      { choice: "abort", label: "Abort", style: "danger" },
    ]),
  ];
}

export interface TopupQuoteCard {
  cardId: string;
  runId: string;
  clientTag: string;
  campaignId: number;
  quote: { net_new: number; with_email: number; domains: number; worst_case_cents: number; icp_cents: number; verify_cents: number; to_find?: number; find_cents?: number };
}

/** The one card a top-up asks: how many new leads, and the most it can cost (D99). Counts only. */
export function topupQuoteCard(c: TopupQuoteCard): Block[] {
  return [
    section(`:inbox_tray: *Top-up #${c.campaignId} — ${c.clientTag}* · job \`${c.runId.slice(0, 8)}\``),
    fields([
      ["New leads (after everything the client holds and unsubscribes)", String(c.quote.net_new)],
      ["With an email address", String(c.quote.with_email)],
      ["No email yet; the email finder looks them up (D103)", String(c.quote.to_find ?? 0)],
      ["Companies for the website check", String(c.quote.domains)],
      ["Worst case", `*${usd(c.quote.worst_case_cents)}* (ICP check ${usd(c.quote.icp_cents)} + email finder ${usd(c.quote.find_cents ?? 0)} + verification ${usd(c.quote.verify_cents)})`],
    ]),
    context("Nothing paid has run. Yes means: ICP website check, find emails for the people without one, verify, normalize, stage, load into the campaign. Josh flips ACTIVE by hand."),
    actions(c.cardId, [
      { choice: "approve_spend", label: `Yes, ${usd(c.quote.worst_case_cents)}`, style: "primary" },
      { choice: "decline_spend", label: "No", style: "danger" },
    ]),
  ];
}
