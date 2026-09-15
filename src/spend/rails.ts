import type { Repo } from "../db/repo.js";
import type { Step } from "../domain/runs.js";
import { logger } from "../lib/log.js";
import { actualCents, isBannedAction, isBannedVendor, isFreeAction, usd, worstCaseCents } from "./prices.js";

const log = logger("spend");

/**
 * The five spend rails (design 3.5), as one gate every paid call must pass.
 *
 * 1. No ideas — a call must name the recipe step that authorises it.
 * 2. Auto cap — worst case over AUTO_SPEND_CAP_USD posts a card and waits.
 * 3. Worst case is computed here from the price table and batch size.
 * 4. Balance watch — vendor balance before/during; drift past approval + 10% kills.
 * 5. Re-bills are asks — anything that may bill again is new spend under rule 2.
 *    Resume is free and never gated.
 *
 * Plus the daily backstop: DAILY_VENDOR_CAP_USD across all vendors parks everything.
 */

export interface RailsConfig {
  autoCapCents: number;
  dailyCapCents: number;
  /** Fraction of approved spend the balance may drift past before the step is killed. */
  driftTolerance: number;
}

export interface SpendRequest {
  runId: string;
  clientTag: string;
  step: Step;
  vendor: string;
  action: string;
  rows: number;
  /** Proof the step is in the lane recipe. `false` is refused before any math. */
  recipeAuthorised: boolean;
  /** Cents already approved for this step by an owner tap (from run_steps.approved_cents). */
  approvedCents?: number;
  /**
   * Worst case for a step that spans more than one vendor (verify = MV + N2B),
   * computed by the caller from the same price table. Never a vendor's number.
   */
  worstCaseCents?: number;
}

export type SpendDecision =
  | { kind: "proceed"; worstCaseCents: number; reason: string }
  | { kind: "ask"; worstCaseCents: number; reason: string }
  | { kind: "blocked"; worstCaseCents: number; reason: string };

export interface BalanceReader {
  vendor: string;
  /** Vendor's own balance in credits, or null when it cannot be read. Never guessed. */
  read(): Promise<number | null>;
}

export class SpendRails {
  private readonly readers = new Map<string, BalanceReader>();

  constructor(
    private readonly repo: Repo,
    readonly cfg: RailsConfig,
  ) {}

  registerBalanceReader(reader: BalanceReader): void {
    this.readers.set(reader.vendor, reader);
  }

  hasBalanceReader(vendor: string): boolean {
    return this.readers.has(vendor);
  }

  /** Pure decision, given today's spend. Exposed for tests. */
  decide(req: SpendRequest, spentTodayCents: number): SpendDecision {
    if (isBannedVendor(req.vendor)) {
      return { kind: "blocked", worstCaseCents: 0, reason: `${req.vendor} is banned from this stack` };
    }
    if (isBannedAction(req.action)) {
      return { kind: "blocked", worstCaseCents: 0, reason: `${req.action} is banned (bills on every call)` };
    }
    if (!req.recipeAuthorised) {
      return {
        kind: "blocked",
        worstCaseCents: 0,
        reason: `step ${req.step} on ${req.vendor} is not in the lane recipe; the service does not have ideas`,
      };
    }
    const computed = worstCaseCents(req.vendor, req.action, req.rows);
    const worst = req.worstCaseCents === undefined ? computed : Math.max(computed, Math.ceil(req.worstCaseCents));
    if (worst === 0) {
      return { kind: "proceed", worstCaseCents: 0, reason: isFreeAction(req.action) ? "free action" : "included plan" };
    }
    if (spentTodayCents + worst > this.cfg.dailyCapCents) {
      return {
        kind: "blocked",
        worstCaseCents: worst,
        reason:
          `daily vendor cap: ${usd(spentTodayCents)} spent today + ${usd(worst)} worst case exceeds ` +
          `${usd(this.cfg.dailyCapCents)}; everything parks until tomorrow or Josh raises the cap`,
      };
    }
    const approved = req.approvedCents ?? 0;
    if (worst <= this.cfg.autoCapCents) {
      return { kind: "proceed", worstCaseCents: worst, reason: `worst case ${usd(worst)} under auto cap ${usd(this.cfg.autoCapCents)}` };
    }
    if (approved >= worst) {
      return { kind: "proceed", worstCaseCents: worst, reason: `worst case ${usd(worst)} within owner approval ${usd(approved)}` };
    }
    return {
      kind: "ask",
      worstCaseCents: worst,
      reason: `worst case ${usd(worst)} is over the ${usd(this.cfg.autoCapCents)} auto cap; needs an owner tap`,
    };
  }

  /** The gate. Reads today's spend and returns the decision; never executes anything. */
  async gate(req: SpendRequest): Promise<SpendDecision> {
    const spentToday = await this.repo.spentTodayCents();
    const decision = this.decide(req, spentToday);
    log.info("gate", {
      run_id: req.runId,
      step: req.step,
      vendor: req.vendor,
      action: req.action,
      row_count: req.rows,
      decision: decision.kind,
      worst_case_cents: decision.worstCaseCents,
      reason: decision.reason,
    });
    if (decision.kind === "ask") {
      await this.repo.setStepWaiting(req.runId, req.step, decision.worstCaseCents);
    }
    return decision;
  }

  async readBalance(vendor: string): Promise<number | null> {
    const r = this.readers.get(vendor);
    if (!r) return null;
    try {
      return await r.read();
    } catch (err) {
      log.warn("balance read failed", { vendor, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Rail 4. `approvedCents` is what the step was allowed to spend (the worst
   * case that passed the gate). A vendor balance that has dropped by more than
   * approval + tolerance means the step is spending outside its lane: kill it.
   */
  driftExceeded(vendor: string, balanceBefore: number | null, balanceNow: number | null, approvedCents: number): boolean {
    if (balanceBefore == null || balanceNow == null) return false;
    const usedCredits = balanceBefore - balanceNow;
    if (usedCredits <= 0) return false;
    const spent = actualCents(vendor, usedCredits);
    return spent > this.allowanceCents(approvedCents);
  }

  /** Same check from a vendor's own credits-used tally when no balance reader exists. */
  creditsExceedApproval(vendor: string, creditsUsed: number, approvedCents: number): boolean {
    return actualCents(vendor, creditsUsed) > this.allowanceCents(approvedCents);
  }

  /** Approved cents plus the drift tolerance, in whole cents (rounded to avoid 220.00000000000003). */
  allowanceCents(approvedCents: number): number {
    return Math.ceil(Math.round(approvedCents * (1 + this.cfg.driftTolerance) * 100) / 100);
  }

  /** Every vendor call writes a ledger row, free or paid. */
  async record(input: {
    runId: string | null;
    clientTag: string | null;
    step: Step | string;
    vendor: string;
    action: string;
    rows: number;
    credits: number | null;
    worstCaseCents: number | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
    vendorJobId: string | null;
    approvedBy: string | null;
  }): Promise<number> {
    const cents = input.credits == null || isFreeAction(input.action) ? 0 : actualCents(input.vendor, input.credits);
    await this.repo.ledger({
      run_id: input.runId,
      client_tag: input.clientTag,
      step: input.step,
      vendor: input.vendor,
      action: input.action,
      rows_submitted: input.rows,
      credits: input.credits,
      cents,
      worst_case_cents: input.worstCaseCents,
      balance_before: input.balanceBefore,
      balance_after: input.balanceAfter,
      vendor_job_id: input.vendorJobId,
      approved_by: input.approvedBy,
    });
    return cents;
  }
}

export function railsConfigFrom(env: { AUTO_SPEND_CAP_USD: number; DAILY_VENDOR_CAP_USD: number }): RailsConfig {
  return {
    autoCapCents: Math.round(env.AUTO_SPEND_CAP_USD * 100),
    dailyCapCents: Math.round(env.DAILY_VENDOR_CAP_USD * 100),
    driftTolerance: 0.1,
  };
}
