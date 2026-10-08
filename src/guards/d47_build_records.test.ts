import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildRecordFromRow, chooseBuildForCampaign } from "../builds/index.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";

/** D47 — build records are the memory; nothing guesses a method. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D47 — build records", () => {
  it("CANON and the ledger name D47 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /## Build records \(D47\)/);
    assert.match(canon, /cannot be reconstructed/);
    assert.match(ledger, /## D47 — /);
    assert.match(ledger, /^\| D47 \| Live/m);
    assert.equal(MCP_TOOL_ROLE.campaign_history, "operator", "D47: Cayden reads the build record. Ask Josh.");
  });

  it("a thin record is marked not repeatable with the reason; nothing is invented", () => {
    const thin = buildRecordFromRow({ smartlead_campaign_id: 1, client_tag: "x", build_label: "old", company_source: "getleads", company_filters: { job_titles: ["CEO"] } })!;
    assert.equal(thin.repeatable.ok, false);
    assert.match(thin.repeatable.why, /titles alone/);
    const none = buildRecordFromRow({ smartlead_campaign_id: 1, client_tag: "x", build_label: "mystery" })!;
    assert.equal(none.source_kind, "unknown");
    const chosen = chooseBuildForCampaign(1, [thin, none]);
    assert.equal(chosen.repeatable, false);
    assert.match(chosen.reason, /cannot be repeated/);
    assert.equal(chooseBuildForCampaign(2, [thin]).build, null, "D47: a campaign with no record gets no build, not a guess");
  });

  it("the record never carries a lead row", () => {
    const rec = buildRecordFromRow({ smartlead_campaign_id: 1, client_tag: "x", build_label: "b", company_source: "getleads", company_filters: { job_titles: ["CIO"], industries: ["Software"] }, how_i_did_it: "getleads export on CIO titles in software.", email: "person@example.com" })!;
    assert.equal(JSON.stringify(rec).includes("@example.com"), false, "D47/D2: the record is counts, labels and method text. Ask Josh.");
  });
});
