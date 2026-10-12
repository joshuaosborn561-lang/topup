import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JevClassifyClient, OPENROUTER_DECISIONS_URL, OPENROUTER_VAULT_SECRET } from "./jevClassify.js";

/** D90 — Jev leftover client uses the existing OpenRouter Decisions path. Ask Josh. */

describe("D90 — Jev leftover client", () => {
  it("posts to OpenRouter Decisions with the fixed leftover prompt and no new vendor", async () => {
    let url = "";
    let payload: { model?: string; questions?: { class?: { type?: string } } } = {};
    const client = new JevClassifyClient({
      model: "typesafe/jev-1.13",
      loadKey: async () => "test-key",
      fetchImpl: (async (href, init) => {
        url = String(href);
        payload = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ answers: { class: { choice: "unsubscribe" } } }), { status: 200 });
      }) as typeof fetch,
    });
    const hit = await client.classify("take me off your list");
    assert.equal(hit.class, "unsubscribe");
    assert.equal(url, OPENROUTER_DECISIONS_URL);
    assert.equal(payload.model, "typesafe/jev-1.13");
    assert.equal(payload.questions?.class?.type, "choice");
    assert.equal(OPENROUTER_VAULT_SECRET, "openrouter_api_key");
  });
});
