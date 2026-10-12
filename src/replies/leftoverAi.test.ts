import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { worstCaseCents } from "../spend/prices.js";
import type { SpendDecision, SpendRequest } from "../spend/rails.js";
import type { JevClassify } from "../clients/jevClassify.js";
import {
  LEFTOVER_AI_HARD_CAP_CENTS,
  classifyLeftover,
  leftoverWorstCaseCents,
  type LeftoverAiDeps,
  type LeftoverRow,
} from "./leftoverAi.js";
import type { NegativeClass } from "./classify.js";

/** D90 — leftover AI runner. Fake Jev. Ask Josh. */

function rails(kind: SpendDecision["kind"] = "proceed"): LeftoverAiDeps["rails"] & { gates: SpendRequest[]; records: number } {
  const out = { gates: [] as SpendRequest[], records: 0 };
  return Object.assign(out, {
    async gate(req: SpendRequest): Promise<SpendDecision> {
      out.gates.push(req);
      return { kind, worstCaseCents: req.worstCaseCents ?? leftoverWorstCaseCents(req.rows), reason: kind };
    },
    async record(): Promise<number> {
      out.records += 1;
      return 1;
    },
  });
}

function deps(opts: {
  rows: LeftoverRow[];
  jev?: JevClassify | null;
  kind?: SpendDecision["kind"];
  writes?: Array<[string, NegativeClass, string]>;
}): LeftoverAiDeps & { r: ReturnType<typeof rails>; writes: Array<[string, NegativeClass, string]> } {
  const r = rails(opts.kind);
  const writes: Array<[string, NegativeClass, string]> = opts.writes ?? [];
  const jev: JevClassify | null =
    opts.jev === undefined
      ? {
          async classify(body: string) {
            return { class: /stop|remove|unsub/i.test(body) ? "unsubscribe" : "not_interested" };
          },
        }
      : opts.jev;
  return {
    db: { query: async () => ({ rows: [], rowCount: 0 }) } as LeftoverAiDeps["db"],
    rails: r,
    jev,
    list: async () => opts.rows,
    write: async (_db, id, cls, source) => {
      writes.push([id, cls, source]);
      return 1;
    },
    r,
    writes,
  };
}

describe("D90 — leftover AI runner", () => {
  it("estimates first and does not call Jev without approved_by", async () => {
    let called = 0;
    const d = deps({
      rows: [{ id: "1", body: "please stop emailing" }, { id: "2", body: "not now" }, { id: "3", body: "   " }],
      jev: {
        async classify() {
          called += 1;
          return { class: "not_interested" };
        },
      },
    });
    const out = await classifyLeftover(d, {});
    assert.equal(out.status, "waiting_approval");
    assert.equal(out.queued, 2);
    assert.equal(out.no_body, 1);
    assert.equal(out.worst_case_cents, leftoverWorstCaseCents(2));
    assert.equal(out.hard_cap_cents, 5);
    assert.equal(out.cost_cents, 0);
    assert.equal(called, 0);
    assert.equal(d.r.gates.length, 0);
    assert.match(out.next, /approved_by/);
  });

  it("runs with approved_by, writes source=ai, and is idempotent on a second pass", async () => {
    const d = deps({
      rows: [{ id: "1", body: "remove me from this list" }, { id: "2", body: "we already have a vendor" }],
    });
    const first = await classifyLeftover(d, { approved_by: "Josh" });
    assert.equal(first.status, "done");
    assert.equal(first.wrote_unsubscribe, 1);
    assert.equal(first.wrote_not_interested, 1);
    assert.equal(first.cost_cents, leftoverWorstCaseCents(2));
    assert.deepEqual(d.writes, [
      ["1", "unsubscribe", "ai"],
      ["2", "not_interested", "ai"],
    ]);
    assert.equal(first.last_error, null);
    assert.equal(d.r.gates.length, 1);
    assert.equal(d.r.gates[0]!.approvedCents, LEFTOVER_AI_HARD_CAP_CENTS);
    assert.equal(d.r.records, 1);

    const again = deps({ rows: [] });
    const second = await classifyLeftover(again, { approved_by: "Josh" });
    assert.equal(second.status, "done");
    assert.equal(second.queued, 0);
    assert.equal(second.cost_cents, 0);
    assert.equal(again.r.gates.length, 0);
    assert.equal(again.writes.length, 0);
  });

  it("leaves no-body rows unclassified and does not pay for them", async () => {
    const d = deps({ rows: [{ id: "1", body: "" }, { id: "2", body: "\n" }] });
    const out = await classifyLeftover(d, { approved_by: "Josh" });
    assert.equal(out.status, "done");
    assert.equal(out.queued, 0);
    assert.equal(out.no_body, 2);
    assert.equal(out.still_unclassified, 2);
    assert.equal(out.cost_cents, 0);
    assert.equal(d.writes.length, 0);
  });

  it("refuses when the Jev worst case is over the $0.05 hard cap", async () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), body: `reply ${i} not a stop` }));
    assert.ok(leftoverWorstCaseCents(2000) > LEFTOVER_AI_HARD_CAP_CENTS);
    const d = deps({ rows: many });
    const out = await classifyLeftover(d, { approved_by: "Josh" });
    assert.equal(out.status, "refused");
    assert.equal(out.cost_cents, 0);
    assert.equal(d.writes.length, 0);
    assert.equal(d.r.gates.length, 0);
    assert.match(out.note, /hard cap/);
  });

  it("records last_error and does not write when Jev throws", async () => {
    const d = deps({
      rows: [{ id: "1", body: "please stop" }],
      jev: {
        async classify() {
          throw new Error("permission denied for function _crypto_aead_det_decrypt");
        },
      },
    });
    const out = await classifyLeftover(d, { approved_by: "Josh" });
    assert.equal(out.status, "done");
    assert.equal(out.errors, 1);
    assert.equal(out.wrote_unsubscribe, 0);
    assert.equal(out.last_error, "permission denied for function _crypto_aead_det_decrypt");
    assert.equal(d.writes.length, 0);
  });

  it("prices leftover Jev at the same grade unit as ICP", () => {
    assert.equal(leftoverWorstCaseCents(55), worstCaseCents("jev", "grade", 55));
    assert.equal(leftoverWorstCaseCents(55), 1);
    assert.ok(leftoverWorstCaseCents(55) <= LEFTOVER_AI_HARD_CAP_CENTS);
  });
});
