import type { PullReceipt } from "../recipes/receipt.js";
import type { ReasonerFn } from "./call.js";
import { askReasoner } from "./call.js";
import type { Exclusion } from "./exclusions.js";
import { inventoryCovers, type InventoryRow } from "./inventory.js";
import type { LanePicture, ReceiptOutcome } from "./picture.js";
import { type Proposal } from "./proposal.js";
import type { ReasonTools } from "./tools.js";
import { type CountCall, validateProposal, type Validation } from "./validate.js";

export type ProposeResult =
  | { kind: "proposal"; proposal: Proposal; validation: Extract<Validation, { ok: true }>; skipped_llm: boolean; prompt_hash: string | null }
  | { kind: "hold"; message: string; proposal: Proposal | null; prompt_hash: string | null };

function inventoryProposal(picture: LanePicture, hit: { n: number; source_table: string; note: string }): Proposal {
  const lane = latestLane(picture);
  const basis = picture.receipts.filter((r) => r.granularity === "lane").map((r) => r.receipt_id);
  const verdicts = Object.fromEntries(picture.outcomes.map((o) => [o.receipt_id, o.verdict]));
  return {
    lane: `${picture.client_tag}/${picture.lane}`,
    basis_receipt_ids: basis,
    basis_verdicts: verdicts,
    action: "repeat",
    segment: {
      icp_kind: lane?.icp_kind ?? "physical",
      company_source: lane?.company_source ?? "table",
      company_filters: { ...(lane?.company_filters ?? {}), inventory: hit.source_table },
      domain_source: lane?.domain_source ?? "already",
      person_source: lane?.person_source ?? "already",
      email_source: lane?.email_source ?? "already",
      email_max_tier: lane?.email_max_tier ?? null,
      band: [],
      mail_class: [],
      gift: null,
      offer_key: [],
    },
    diff_from_basis: [],
    counts: {
      pool: hit.n,
      already_in_client: 0,
      suppressed: 0,
      projected_net_new: hit.n,
      projected_verified: hit.n,
      expected_interested_per_2000: expectedRate(picture.outcomes),
    },
    cost: { worst_case_usd: 0, by_step: {} },
    widening_options: [],
    pilot_required: (lane?.icp_kind ?? "physical") === "physical",
    confidence: "high",
    reasons: [`Unloaded inventory ${hit.source_table}: ${hit.n} (${hit.note}). No new pull.`],
    flags: ["basis=inventory"],
    count_call_id: "inventory",
  };
}

function latestLane(picture: LanePicture): PullReceipt | undefined {
  return picture.receipts.find((r) => r.granularity === "lane") ?? picture.receipts[0];
}

function expectedRate(outcomes: ReceiptOutcome[]): number | null {
  const usable = outcomes.filter((o) => o.sends >= 200);
  if (!usable.length) return null;
  return usable.reduce((s, o) => s + o.interested_per_2000, 0) / usable.length;
}

function holdProposal(picture: LanePicture, message: string, flags: string[]): Proposal {
  const lane = latestLane(picture);
  return {
    lane: `${picture.client_tag}/${picture.lane}`,
    basis_receipt_ids: picture.receipts.map((r) => r.receipt_id),
    basis_verdicts: Object.fromEntries(picture.outcomes.map((o) => [o.receipt_id, o.verdict])),
    action: "hold",
    segment: {
      icp_kind: lane?.icp_kind ?? "linkedin_native",
      company_source: lane?.company_source ?? "getleads",
      company_filters: lane?.company_filters ?? {},
      domain_source: lane?.domain_source ?? "already",
      person_source: lane?.person_source ?? "already",
      email_source: lane?.email_source ?? "already",
      email_max_tier: lane?.email_max_tier ?? null,
      band: [],
      mail_class: [],
      gift: null,
      offer_key: [],
    },
    diff_from_basis: [],
    counts: { pool: 0, already_in_client: 0, suppressed: 0, projected_net_new: 0, projected_verified: 0, expected_interested_per_2000: null },
    cost: { worst_case_usd: 0, by_step: {} },
    widening_options: [],
    pilot_required: false,
    confidence: "low",
    reasons: [message],
    flags,
    count_call_id: null,
  };
}

function validateAgainst(picture: LanePicture, raw: unknown, calls: CountCall[]): Validation {
  return validateProposal(raw, {
    clientTag: picture.client_tag,
    lane: picture.lane,
    exclusions: picture.exclusions,
    countCalls: calls,
    persona: latestLane(picture)?.persona,
  });
}

/**
 * Inventory first (no LLM). Else the reasoner. Validation retries once.
 * Tests inject ReasonerFn; production injects anthropicReasoner.
 */
export async function proposeLane(
  picture: LanePicture,
  opts: {
    target: number;
    tools: ReasonTools;
    calls: CountCall[];
    reasoner?: ReasonerFn;
    inventory?: InventoryRow[];
  },
): Promise<ProposeResult> {
  const inventory = opts.inventory ?? picture.inventory;
  const cover = inventoryCovers(inventory, opts.target);
  if (cover.enough) {
    const proposal = inventoryProposal(picture, cover);
    opts.calls.push({ id: "inventory", kind: "inventory", filters: { source_table: cover.source_table }, total: cover.n });
    const validation = validateAgainst(picture, proposal, opts.calls);
    if (validation.ok) return { kind: "proposal", proposal: validation.proposal, validation, skipped_llm: true, prompt_hash: null };
    return { kind: "hold", message: validation.message, proposal, prompt_hash: null };
  }

  if (!opts.reasoner) {
    const proposal = holdProposal(picture, "No reasoner wired and inventory does not cover the target.", ["no_reasoner"]);
    return { kind: "hold", message: proposal.reasons[0]!, proposal, prompt_hash: null };
  }

  let asked: { raw: unknown; prompt_hash: string };
  try {
    asked = await askReasoner(picture, opts.tools, opts.reasoner);
  } catch (err) {
    const proposal = holdProposal(picture, `Reasoner failed: ${(err as Error).message}`, ["reasoner_error"]);
    return { kind: "hold", message: proposal.reasons[0]!, proposal, prompt_hash: null };
  }

  let validation = validateAgainst(picture, asked.raw, opts.calls);
  if (!validation.ok) {
    const first = validation.message;
    try {
      const retry = await opts.reasoner({
        system: "Return only a corrected JSON proposal. The previous one failed validation.",
        user: JSON.stringify({ failure: first, previous: asked.raw }),
        tools: opts.tools,
      });
      validation = validateAgainst(picture, retry, opts.calls);
    } catch (err) {
      const proposal = holdProposal(picture, `Validation failed twice: ${first}; retry error ${(err as Error).message}`, ["validation_failed"]);
      return { kind: "hold", message: proposal.reasons[0]!, proposal, prompt_hash: asked.prompt_hash };
    }
  }
  if (!validation.ok) {
    const proposal = holdProposal(picture, `Validation failed twice: ${validation.message}`, ["validation_failed"]);
    return { kind: "hold", message: proposal.reasons[0]!, proposal, prompt_hash: asked.prompt_hash };
  }
  return { kind: "proposal", proposal: validation.proposal, validation, skipped_llm: false, prompt_hash: asked.prompt_hash };
}

export function backfillFlags(picture: LanePicture, basisIds: string[]): string[] {
  const flags: string[] = [];
  for (const id of basisIds) {
    const r = picture.receipts.find((x) => x.receipt_id === id);
    if (!r) continue;
    if (r.written_by === "claude_backfill") flags.push("backfill only basis");
    if (r.written_by === "claude_backfill_build") flags.push("build row is reconstruction");
    if (r.notes?.includes("Josh to confirm")) flags.push("Josh to confirm");
    if (r.notes) flags.push(`notes: ${r.notes.slice(0, 180)}`);
  }
  if (picture.client_tag === "goliath" && latestLane(picture)?.person_source === "getleads") {
    flags.push("getleads person_source on Goliath: retiree replies; no cheap currency check yet");
  }
  return [...new Set(flags)];
}

export type { Exclusion };
