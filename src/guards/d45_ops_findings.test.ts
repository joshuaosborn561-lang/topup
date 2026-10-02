import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { assessClientRunway } from "../ledger/client_runway.js";
import { HIDDEN_FROM_OPERATOR, MCP_TOOL_ROLE } from "../mcp/server.js";
import { presentTopupRecipe, trimRecipeSummary } from "../mcp/recipe.js";
import { resolveStartTarget } from "../recipes/start.js";
import { SERVICE_VERSION } from "../version.js";

/** D45 — 2026-10-01 ops findings. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D45 — queue runway, inferred recipes, Cayden can operate", () => {
  it("CANON and the ledger name D45 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version: string };
    assert.match(canon, /Canon as of \*\*D\d+\*\*/);
    assert.match(canon, /\$5 or above/);
    assert.match(canon, /send rate/);
    assert.match(canon, /pull_receipts/);
    assert.match(canon, /under 1 interested per 2,000/);
    assert.match(canon, /A receipt is enough/);
    assert.match(ledger, /## D45 — /);
    assert.match(ledger, /n\/a does not pass/);
    assert.match(ledger, /any client/);
    assert.match(ledger, /infer from/);
    assert.equal(pkg.version, SERVICE_VERSION);
    assert.equal(SERVICE_VERSION, "0.5.0");
  });

  it("client days from send rate; n/a fails — Ask Josh", () => {
    const r = assessClientRunway({
      clientTag: "peterson_earthworks",
      campaigns: [{ status: "ACTIVE", untouched: 252, sends_window: 588 }],
    });
    assert.equal(r.email_days_from, "send_rate");
    assert.equal(r.email_days, 3);
    assert.equal(r.under_floor, true);
    const na = assessClientRunway({
      clientTag: "powergryd",
      campaigns: [{ status: "ACTIVE", untouched: 10 }],
    });
    assert.equal(na.email_days, null);
    assert.equal(na.under_floor, true, "D45: n/a is not a pass. Ask Josh.");
  });

  it("start_topup takes campaign_id; sample_rows is hidden from Cayden; spend copy is $5 or above — Ask Josh", () => {
    const t = resolveStartTarget({ clientTag: "powergryd", campaignId: 4005226, count: 400 });
    assert.equal(t.ok, true);
    if (t.ok) {
      assert.deepEqual(t.campaignIds, [4005226]);
      assert.equal(t.requestedCount, 400);
    }
    assert.equal(MCP_TOOL_ROLE.sample_rows, "owner");
    assert.ok(HIDDEN_FROM_OPERATOR.includes("sample_rows"));
    assert.equal(MCP_TOOL_ROLE.start_topup, "operator");
    assert.equal(MCP_TOOL_ROLE.campaign_registry, "operator");
    assert.equal(MCP_TOOL_ROLE.register_queue_table, "operator");
    const presented = presentTopupRecipe(
      { campaign: 1, vocab: { a: 1 }, rules: { spend: "any spend above $5 needs Josh" } },
      { includeVocab: true, sendsLast14d: 90 },
    );
    assert.equal(presented.sends_last_14d, 90);
    assert.match(String((presented.rules as { spend: string }).spend), /\$5 or above/);
    const slim = presentTopupRecipe({ campaign: 1, vocab: { a: 1 }, rules: { spend: "x" } }, { includeVocab: false });
    assert.equal(slim.vocab, undefined);
    const trimmed = trimRecipeSummary({
      campaign_id: 1,
      builds: [
        { build_label: "hot", interested: 2 },
        { build_label: "cold", interested: 0 },
      ],
      any_reconstructed: false,
      leads_without_method: 0,
      campaign_not_found: false,
    });
    assert.equal(trimmed.builds.length, 1);
    assert.equal(trimmed.builds_total, 2);
  });
});
