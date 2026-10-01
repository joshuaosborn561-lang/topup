import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { configReadiness, loadConfig } from "../config.js";
import { roleForToken } from "../mcp/server.js";

/** D41 — HTTPS MCP needs no login. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D41 — MCP needs no login", () => {
  it("CANON, the ledger, and README say no login — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const servers = await readFile(new URL("skills/MCP_SERVERS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D\d+\*\*/);
    assert.match(canon, /\*\*No\s+login\.\*\*/);
    assert.match(ledger, /## D41 — MCP needs no login/);
    assert.match(ledger, /does not require a/);
    assert.match(readme, /No login \(D41\)/);
    assert.ok(!readme.includes("Authorization: Bearer"), "D41: README must not tell Cursor to send a bearer token. Ask Josh.");
    assert.match(servers, /No login \(D41\)/);
  });

  it("a missing or unknown token is operator, never 401 — Ask Josh", async () => {
    const d = { ownerToken: "owner-tok-1", operatorToken: "operator-tok-2" };
    assert.equal(roleForToken(undefined, d), "operator");
    assert.equal(roleForToken("Bearer nope", d), "operator");
    assert.equal(roleForToken(`Bearer ${d.ownerToken}`, d), "owner");
    const server = await readFile(new URL("src/mcp/server.ts", root), "utf8");
    assert.ok(!server.includes("owner or operator token required"), "D41: /mcp must not 401. Ask Josh.");
    const boot = await readFile(new URL("src/index.ts", root), "utf8");
    assert.ok(!boot.includes("MCP tokens are not both set"), "D41: /mcp mounts without tokens. Ask Josh.");
    assert.match(boot, /app\.use\(\s*"\/mcp"/);
    const cfg = loadConfig({});
    assert.equal(configReadiness(cfg).mcp, true, "D41: readiness.mcp is true without tokens. Ask Josh.");
  });
});
