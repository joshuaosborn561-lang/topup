import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { SAMPLE_ROWS_MAX } from "../mcp/server.js";

/** D39 — Grok bot is the babysitter; rows never enter its context. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D39 — Grok bot is the babysitter", () => {
  it("CANON, AGENTS, and the ledger name the babysitter rule — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const agents = await readFile(new URL("AGENTS.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D39\*\*/);
    assert.match(canon, /Grok bot is the \*\*babysitter\*\*/);
    assert.match(canon, /MCP → Supabase/);
    assert.match(canon, /source_table/);
    assert.match(canon, /do not enter Grok bot context/);
    assert.match(canon, /Railway crons/);
    assert.match(agents, /Grok bot is the babysitter \(D39\)/);
    assert.match(agents, /enter Grok bot context/);
    assert.match(ledger, /## D39 — Grok bot is the babysitter/);
    assert.match(ledger, /nuked our grok bot/);
  });

  it("the service MCP still only samples ten masked rows (D2 stays) — Ask Josh", () => {
    assert.equal(SAMPLE_ROWS_MAX, 10, "D39: Grok bot may not widen sample_rows. Ask Josh.");
  });

  it("vendor MCP docs keep rows on source_table / writeback, not chat", async () => {
    const servers = await readFile(new URL("skills/MCP_SERVERS.md", root), "utf8");
    assert.match(servers, /source_table/);
    assert.match(servers, /writeback/);
    assert.match(servers, /Rows never travel through the service/);
  });
});
