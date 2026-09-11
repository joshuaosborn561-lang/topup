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

export function buttonValue(cardId: string, choice: string): string {
  return JSON.stringify({ card_id: cardId, choice });
}

export function parseButtonValue(value: string | undefined): { card_id: string; choice: string } | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as { card_id?: unknown; choice?: unknown };
    if (typeof v.card_id === "string" && typeof v.choice === "string") return { card_id: v.card_id, choice: v.choice };
  } catch {
    /* ignore */
  }
  return null;
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
      value: buttonValue(cardId, c.choice),
      ...(c.style ? { style: c.style } : {}),
    })),
  };
}

export function resolvedFooter(choice: string, by: string): Block {
  return context(`Resolved: *${choice}* by <@${by}> at ${new Date().toISOString()}`);
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
    context("Worst case is computed from the service's price table and batch size, not a vendor cost field. Silence parks the run after 24h."),
    actions(c.cardId, [
      { choice: "approve_spend", label: `Approve ${usd(c.worstCaseCents)}`, style: "primary" },
      { choice: "decline_spend", label: "Decline", style: "danger" },
    ]),
  ];
}

export interface NotWorkingCard {
  cardId: string;
  runId: string;
  clientTag: string;
  campaignId: number;
  campaignName: string;
  runwayDays: number;
  sends: number;
  interested: number;
  variants: Array<{ label: string; sends: number; interested: number }>;
}

export function notWorkingCard(c: NotWorkingCard): Block[] {
  const table = c.variants
    .map((v) => `\`${v.label.padEnd(12).slice(0, 12)}\` ${String(v.sends).padStart(6)} sends  ${String(v.interested).padStart(3)} interested`)
    .join("\n");
  return [
    section(
      `:warning: *${c.campaignName}* (#${c.campaignId}) is low (*${c.runwayDays.toFixed(1)}d* runway) and not working: ` +
        `${c.interested} interested in ${c.sends} sends (bar is 1 per 2,000).`,
    ),
    ...(table ? [section(`Variants:\n${table}`)] : []),
    actions(c.cardId, [
      { choice: "topup_anyway", label: "Top up anyway" },
      { choice: "leave_it", label: "Leave it", style: "primary" },
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

export interface ParkedCard {
  cardId: string;
  runId: string;
  clientTag: string;
  step: string;
  attempts: number;
  error: string;
}

export function parkedCard(c: ParkedCard): Block[] {
  return [
    section(`:octagonal_sign: *Run parked — ${c.clientTag}* · run \`${c.runId.slice(0, 8)}\` · step *${c.step}* failed ${c.attempts} times`),
    section(`\`\`\`${c.error.slice(0, 900)}\`\`\``),
    context("A parked run never retries on its own. Resume re-runs the step once; Abort closes the run."),
    actions(c.cardId, [
      { choice: "resume_run", label: "Resume", style: "primary" },
      { choice: "abort", label: "Abort", style: "danger" },
    ]),
  ];
}

export interface GateCard {
  cardId: string;
  runId: string;
  clientTag: string;
  lane: string;
  /** Spine step label, e.g. "Step 7". */
  stepLabel: string;
  gate: string;
  why: string;
  counts: Record<string, number>;
}

/** A spine gate failed (D24): the run halted at the step; here is why; Resume re-runs the step once, Abort closes the run. */
export function gateCard(c: GateCard): Block[] {
  const counts = Object.entries(c.counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  return [
    section(`:no_entry: *${c.stepLabel} gate unmet — ${c.clientTag} / ${c.lane}* · run \`${c.runId.slice(0, 8)}\``),
    section(`*Gate:* ${c.gate}\n*Why:* ${c.why.slice(0, 600)}${counts ? `\n*Counts:* ${counts}` : ""}`),
    context("The run halted at this step and will not move on its own. Resume re-runs the step and checks the gate again (fix the rows first); Abort closes the run. Silence never means yes."),
    actions(c.cardId, [
      { choice: "resume_run", label: "Resume", style: "primary" },
      { choice: "abort", label: "Abort", style: "danger" },
    ]),
  ];
}

export interface ReceiptInput {
  runId: string;
  clientTag: string;
  lane: string;
  status: string;
  counts: Record<string, number>;
  spendCentsByVendor: Record<string, number>;
  stallEvents: number;
  holdsOpen: number;
  note?: string;
}

/** Run receipt: counts by status, spend by vendor, holds waiting. Never rows. */
export function receiptBlocks(r: ReceiptInput): Block[] {
  const counts = Object.entries(r.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `\`${k}\` ${v}`)
    .join(" · ");
  const spend =
    Object.entries(r.spendCentsByVendor)
      .map(([v, c]) => `${v} ${usd(c)}`)
      .join(" · ") || "$0.00";
  return [
    section(`:receipt: *Receipt — ${r.clientTag} / ${r.lane}* · run \`${r.runId.slice(0, 8)}\` · *${r.status}*`),
    section(counts || "_no counts yet_"),
    fields([
      ["Spend by vendor", spend],
      ["Stall events", String(r.stallEvents)],
      ["Holds waiting", String(r.holdsOpen)],
    ]),
    ...(r.note ? [context(r.note)] : []),
  ];
}
