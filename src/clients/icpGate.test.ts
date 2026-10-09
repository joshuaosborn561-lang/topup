import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IcpGateClient, jevModel } from "./icpGate.js";

/** D58 — the three edge functions are called with their own key, by batch, and answer counts. No vendor is reached from a test. */
describe("D58 — ICP gate client", () => {
  it("calls each function with its key and the batch, and reads counts back", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      const body = url.includes("icp-site-fetch")
        ? { processed: 100, ok: 96, released: 0, remaining: 40 }
        : url.includes("mode=submit")
          ? { ok: true, task_id: "t1", domains: 7 }
          : url.includes("mode=collect")
            ? { status: "completed", tally: { yes: 3, no: 4 } }
            : { model: "jev:typesafe/jev-1.13|choice", processed: 300, errors: 1, last_error: "jev 429", remaining: 0 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const c = new IcpGateClient("https://example.test/functions/v1", { fetch: "kf", llm: "kl", disco: "kd" }, fetchImpl);
    const f = await c.fetchSites("job_abc", 100, 30);
    assert.deepEqual(f, { processed: 100, ok: 96, released: 0, remaining: 40 });
    const g = await c.grade("job_abc", jevModel("typesafe/jev-1.13", "choice"), 300, 20);
    assert.deepEqual(g, { processed: 300, errors: 1, last_error: "jev 429", remaining: 0 });
    const s = await c.discoSubmit("job_abc", "salesglider");
    assert.deepEqual(s, { task_id: "t1", domains: 7 });
    const col = await c.discoCollect("t1", "job_abc");
    assert.deepEqual(col, { status: "completed", tally: { yes: 3, no: 4 } });
    assert.match(seen[0]!, /icp-site-fetch\?k=kf&batch=job_abc&n=100&w=30/);
    assert.match(seen[1]!, /icp-llm\?k=kl&mode=run&batch=job_abc&model=jev%3Atypesafe%2Fjev-1\.13%7Cchoice&n=300&w=20/);
    assert.match(seen[2]!, /icp-disco-fallback\?k=kd&mode=submit&batch=job_abc&icp=salesglider/);
    assert.match(seen[3]!, /mode=collect&task=t1&batch=job_abc/);
  });

  it("refuses without a key and surfaces a function error", async () => {
    const c = new IcpGateClient("https://example.test/functions/v1", { fetch: "", llm: "kl", disco: "" });
    await assert.rejects(() => c.fetchSites("b", 1, 1), /missing credentials/);
    const bad = new IcpGateClient("https://example.test/functions/v1", { fetch: "kf", llm: "kl", disco: "kd" }, (async () => new Response(JSON.stringify({ ok: false, error: "unknown variant" }), { status: 400 })) as unknown as typeof fetch);
    await assert.rejects(() => bad.grade("b", "jev:x|nope", 1, 1), /unknown variant/);
  });
});
