import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backoffMs, HostCap, isRetryable, RpmLimiter, withBackoff } from "./backoff.js";

describe("D73 — backoff, rpm limiter, host cap", () => {
  it("retries 429 and 5xx with a growing wait, and does not retry a 400", async () => {
    const waits: number[] = [];
    let n = 0;
    const v = await withBackoff(
      async () => {
        n += 1;
        if (n < 3) throw new Error("site-people 429: RESOURCE_EXHAUSTED");
        return "ok";
      },
      { sleep: async (ms) => { waits.push(ms); } },
    );
    assert.equal(v, "ok");
    assert.equal(n, 3);
    assert.equal(waits.length, 2);
    assert.ok(waits[0]! >= 400 && waits[1]! > waits[0]!);
    await assert.rejects(withBackoff(async () => { throw new Error("site-people 400: bad model"); }, { attempts: 3, sleep: async () => undefined }), /400/);
    assert.equal(isRetryable("gemini 503 timeout"), true);
    assert.equal(isRetryable("ok"), false);
    assert.ok(backoffMs(0, 100, 1000) >= 100);
  });

  it("the rpm bucket hands out at most rpm tokens per minute", async () => {
    let t = 0;
    const lim = new RpmLimiter(2, () => t);
    await lim.take();
    await lim.take();
    let granted = false;
    const third = lim.take().then(() => {
      granted = true;
    });
    await Promise.resolve();
    assert.equal(granted, false);
    t += 60_000;
    await lim.take();
    await third;
    assert.equal(granted, true);
  });

  it("caps two in-flight tasks on one host and lets another host through", async () => {
    const cap = new HostCap(2);
    assert.equal(HostCap.hostOf("https://www.Acme.test/about"), "acme.test");
    let maxA = 0;
    let a = 0;
    let bStarted = false;
    const hold = (host: string, ms: number, track: boolean) =>
      cap.run(host, async () => {
        if (track) {
          a += 1;
          maxA = Math.max(maxA, a);
        } else bStarted = true;
        await new Promise((r) => setTimeout(r, ms));
        if (track) a -= 1;
      });
    const jobs = [hold("a.test", 30, true), hold("https://www.a.test/x", 30, true), hold("a.test", 5, true), hold("b.test", 5, false)];
    await Promise.all(jobs);
    assert.ok(maxA <= 2);
    assert.equal(bStarted, true);
  });
});
