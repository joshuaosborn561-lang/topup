import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LedgerRow, Repo } from "../db/repo.js";
import { usd, worstCaseCents } from "./prices.js";
import { SpendRails, type SpendRequest } from "./rails.js";

/**
 * D9 — the five rails, tested on the pure decision and on the ledger a fake
 * repo receives. No vendor is called (D4).
 */

class FakeRepo {
  ledgerRows: LedgerRow[] = [];
  waiting: Array<{ runId: string; step: string; cents: number }> = [];
  spentToday = 0;
  async spentTodayCents() {
    return this.spentToday;
  }
  async ledger(row: LedgerRow) {
    this.ledgerRows.push(row);
  }
  async setStepWaiting(runId: string, step: string, cents: number) {
    this.waiting.push({ runId, step, cents });
  }
}

const cfg = { autoCapCents: 500, dailyCapCents: 2500, driftTolerance: 0.1 };

function rails(repo = new FakeRepo()) {
  return { repo, rails: new SpendRails(repo as unknown as Repo, cfg) };
}

const req = (p: Partial<SpendRequest> = {}): SpendRequest => ({
  runId: "r1",
  clientTag: "parlay",
  step: "verify",
  vendor: "millionverifier",
  action: "verify",
  rows: 1000,
  recipeAuthorised: true,
  ...p,
});

describe("spend rails (D9)", () => {
  it("rail 1 — a step the recipe does not authorise is refused before any math", () => {
    const d = rails().rails.decide(req({ recipeAuthorised: false }), 0);
    assert.equal(d.kind, "blocked");
    assert.match(d.reason, /does not have ideas/);
  });

  it("rail 3 — worst case comes from the price table times rows, rounded up, never from a vendor", () => {
    assert.equal(worstCaseCents("millionverifier", "verify", 1000), Math.ceil(1000 * 0.2));
    assert.equal(worstCaseCents("no2bounce", "verify", 1), 1);
    assert.equal(worstCaseCents("getleads", "pull", 10_000), 0, "included plan costs nothing per call");
    assert.throws(() => worstCaseCents("unknownvendor", "x", 10), /no price on file/);
  });

  it("rail 2 — under the $5 cap proceeds; over it asks with the worst case in dollars", () => {
    const { rails: r } = rails();
    const small = r.decide(req({ rows: 1000 }), 0);
    assert.equal(small.kind, "proceed");
    const big = r.decide(req({ rows: 10_000 }), 0);
    assert.equal(big.kind, "ask");
    assert.equal(big.worstCaseCents, 2000);
    assert.match(big.reason, /\$20\.00 is over the \$5\.00 auto cap/);
  });

  it("rail 2 — an owner approval covering the worst case lets it proceed", () => {
    const d = rails().rails.decide(req({ rows: 10_000, approvedCents: 2000 }), 0);
    assert.equal(d.kind, "proceed");
    assert.equal(rails().rails.decide(req({ rows: 10_000, approvedCents: 1999 }), 0).kind, "ask");
  });

  it("a caller-supplied multi-vendor worst case can only raise the number", () => {
    const d = rails().rails.decide(req({ rows: 1000, worstCaseCents: 600 }), 0);
    assert.equal(d.kind, "ask");
    assert.equal(d.worstCaseCents, 600);
    const lower = rails().rails.decide(req({ rows: 1000, worstCaseCents: 1 }), 0);
    assert.equal(lower.worstCaseCents, 200);
  });

  it("daily backstop — $25 across vendors parks everything, approval or not", () => {
    const d = rails().rails.decide(req({ rows: 1000, approvedCents: 99_999 }), 2400);
    assert.equal(d.kind, "blocked");
    assert.match(d.reason, /daily vendor cap/);
  });

  it("rail 5 — a resume is free and never gated; a split is priced like a submit", () => {
    const { rails: r } = rails();
    assert.equal(r.decide(req({ action: "resume", rows: 100_000 }), 2499).kind, "proceed");
    assert.equal(r.decide(req({ action: "verify_split", rows: 10_000 }), 0).kind, "ask");
  });

  it("D8 — banned vendors and actions are blocked with no number", () => {
    const { rails: r } = rails();
    for (const vendor of ["pdl", "PeopleDataLabs", "billionverifier", "clay", "hunter"]) assert.equal(r.decide(req({ vendor }), 0).kind, "blocked", vendor);
    assert.equal(r.decide(req({ vendor: "leadmagic", action: "detect_job_change" }), 0).kind, "blocked");
  });

  it("gate() records a waiting step when it asks, and never executes anything", async () => {
    const { repo, rails: r } = rails();
    const d = await r.gate(req({ rows: 10_000 }));
    assert.equal(d.kind, "ask");
    assert.deepEqual(repo.waiting, [{ runId: "r1", step: "verify", cents: 2000 }]);
    assert.equal(repo.ledgerRows.length, 0);
  });

  it("record() writes one ledger row per call, pricing credits by our table; free actions cost 0", async () => {
    const { repo, rails: r } = rails();
    const cents = await r.record({ runId: "r1", clientTag: "parlay", step: "verify", vendor: "millionverifier", action: "credits_used", rows: 1000, credits: 950, worstCaseCents: 200, balanceBefore: 10_000, balanceAfter: 9_050, vendorJobId: "v1", approvedBy: null });
    assert.equal(cents, Math.ceil(950 * 0.2));
    const free = await r.record({ runId: "r1", clientTag: "parlay", step: "verify", vendor: "millionverifier", action: "resume", rows: 1000, credits: 0, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: "v1", approvedBy: null });
    assert.equal(free, 0);
    assert.equal(repo.ledgerRows.length, 2);
    assert.equal(repo.ledgerRows[0].vendor_job_id, "v1");
  });

  it("rail 4 — drift past approval + 10% is detected from balance or from credits used", () => {
    const { rails: r } = rails();
    assert.equal(r.driftExceeded("millionverifier", 10_000, 9_000, 200), false, "1000 credits = 200c, within approval");
    assert.equal(r.driftExceeded("millionverifier", 10_000, 8_800, 200), true, "1200 credits = 240c > 220c");
    assert.equal(r.driftExceeded("millionverifier", null, 8_800, 200), false, "unreadable balance is reported, not guessed");
    assert.equal(r.creditsExceedApproval("millionverifier", 1100, 200), false);
    assert.equal(r.creditsExceedApproval("millionverifier", 1101, 200), true);
  });

  it("usd() formats cents", () => {
    assert.equal(usd(2000), "$20.00");
    assert.equal(usd(1), "$0.01");
  });
});
