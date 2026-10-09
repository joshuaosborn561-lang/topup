import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_READS } from "../grok/allowlist.js";
import { GROK_READS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";

/**
 * D55 — leftovers is a read of counts over the stores past pulls left
 * behind. It never selects a lead column, never calls a vendor, and never
 * moves a row. Ask Josh before it does any of those.
 */

const root = new URL("../../", import.meta.url);

describe("D55 — leftovers", () => {
  it("is on the surface as a read", () => {
    assert.ok((CANON_READS as readonly string[]).includes("leftovers"));
    assert.ok((GROK_READS as readonly string[]).includes("leftovers"));
    assert.equal(MCP_TOOL_ROLE.leftovers, "operator");
  });

  it("selects counts only, calls no vendor, and the canon names it", async () => {
    const src = await readFile(new URL("src/canon/leftovers.ts", root), "utf8");
    assert.doesNotMatch(src, /select\s+(?!count)[^`]*\b(email|first_name|last_name|phone|linkedin_url)\b/i, "D55: leftovers must never select a lead column (D2)");
    assert.doesNotMatch(src, /clients\/|rails|fetch\(/, "D55: leftovers reads the database only; no vendor call");
    assert.doesNotMatch(src, /\b(update|insert|delete|truncate)\b/i, "D55: leftovers moves nothing");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /`leftovers\(/, "D55: CANON.md names leftovers");
  });
});
