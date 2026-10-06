import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Overlap } from "./concurrency.js";

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("overlap within a client and across clients", () => {
  it("caps one client and still runs a second client beside it", async () => {
    const gate = new Overlap(1, 2);
    let all = 0;
    let maxA = 0;
    let maxB = 0;
    let maxAll = 0;
    const run = (client: string, slot: { n: number }) =>
      gate.run(client, async () => {
        slot.n += 1;
        all += 1;
        if (client === "peterson") maxA = Math.max(maxA, slot.n);
        else maxB = Math.max(maxB, slot.n);
        maxAll = Math.max(maxAll, all);
        await pause();
        slot.n -= 1;
        all -= 1;
      });
    const a = { n: 0 };
    const b = { n: 0 };
    await Promise.all([run("peterson", a), run("peterson", a), run("goliath", b), run("goliath", b)]);
    assert.equal(maxA, 1);
    assert.equal(maxB, 1);
    assert.equal(maxAll, 2);
  });

  it("the across cap is shared, so one client cannot use every slot", async () => {
    const gate = new Overlap(4, 1);
    let all = 0;
    let maxAll = 0;
    await Promise.all(
      ["peterson", "goliath", "techevo"].map((client) =>
        gate.run(client, async () => {
          all += 1;
          maxAll = Math.max(maxAll, all);
          await pause();
          all -= 1;
        }),
      ),
    );
    assert.equal(maxAll, 1);
  });

  it("a full client does not block a client that still fits", async () => {
    const gate = new Overlap(1, 2);
    let startedB = false;
    const hold = gate.run("peterson", () => new Promise((resolve) => setTimeout(resolve, 40)));
    const secondA = gate.run("peterson", async () => {
      assert.equal(startedB, true);
    });
    const b = gate.run("goliath", async () => {
      startedB = true;
    });
    await Promise.all([hold, secondA, b]);
  });
});
