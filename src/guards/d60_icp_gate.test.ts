import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_VERBS } from "../grok/allowlist.js";
import { VERB_ORDER, VERB_STEPS } from "../jobs/runner.js";
import { GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { PRICES, worstCaseCents } from "../spend/prices.js";
import { stepForStage } from "../spine/steps.js";
import { icpWorstCaseCents } from "../stages/icp/index.js";

/**
 * D60 — the ICP website gate is a verb between suppress and enrich. It
 * runs before anything paid, prices Jev and the DiscoLike fallback from
 * the price table, waits for a named approval, writes the verdict onto the
 * rows and suppresses the flagged ones with a reason. It never deletes a
 * row, never returns a page or a person, and no function key lives in the
 * repo. Ask Josh before any of that changes.
 */

const root = new URL("../../", import.meta.url);

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else out.push(u);
  }
  return out;
}

describe("D60 — the ICP gate is a verb", () => {
  it("sits between suppress and enrich, on spine step 5, and is on the surface", () => {
    assert.deepEqual(VERB_ORDER.slice(0, 4), ["pull", "suppress", "icp", "enrich"], "D60: icp runs after suppression and before anything paid");
    assert.deepEqual([...VERB_STEPS.icp], ["icp"]);
    assert.equal(stepForStage("icp")?.n, 5, "D60: the gate is step 5.5 of lead-list-build; it lives on spine step 5");
    for (const list of [CANON_VERBS, GROK_VERBS]) assert.ok((list as readonly string[]).includes("icp"));
    assert.equal(MCP_TOOL_ROLE.icp, "operator");
  });

  it("prices Jev and DiscoLike from the table and never lands at $0 for a real batch", () => {
    assert.equal(PRICES.jev.kind, "paid");
    assert.equal(PRICES.discolike.kind, "paid");
    assert.ok(worstCaseCents("jev", "grade", 1000) >= 11, "D60: about $0.11 per 1,000 sites");
    assert.ok(worstCaseCents("discolike", "validate_icp", 100) >= 38, "D60: about $0.0038 per unreadable site");
    assert.ok(icpWorstCaseCents(2000) > 0 && icpWorstCaseCents(2000) < 500, "D60: a 2,000-domain gate is well under $5");
    assert.equal(icpWorstCaseCents(0), 0);
  });

  it("writes the verdict, suppresses with a reason, never deletes, never selects a person", async () => {
    const src = await readFile(new URL("src/stages/icp/index.ts", root), "utf8");
    assert.match(src, /icp_gate = v\.fit/, "D60: the verdict is written onto the rows");
    assert.match(src, /suppressed_reason.*off_icp/, "D60: flagged rows are suppressed with a reason");
    assert.doesNotMatch(src, /\bdelete from\b/i, "D60: flagged rows stay in the table");
    assert.doesNotMatch(src, /select[^`]*\b(email|first_name|last_name|phone|linkedin_url)\b[^`]*from/i, "D2/D60: the gate selects domains and counts, never a person");
    assert.match(src, /kind: "spend_approval"/, "D51/D60: the gate asks for a named approval before Jev runs");
    const m = await readFile(new URL("supabase/migrations/0019_icp_gate.sql", root), "utf8");
    for (const c of ["icp_gate text", "icp_gate_label text", "icp_gate_at timestamptz"]) assert.ok(m.includes(`add column if not exists ${c}`), `D60: lane tables carry ${c}`);
    assert.match(m, /create table if not exists topup\.icp_variants/, "D60: the label set per client lives in the database, not in code");
  });

  it("no function key is in the repo, and the canon names the gate", async () => {
    const keyShaped = /\b[A-Z][a-z0-9]{2}[A-Z][a-z0-9]{2}[A-Z][a-z0-9]{2}[A-Z][a-z0-9]{2}\b/;
    for (const f of await walk(new URL("src/", root))) {
      if (!f.pathname.endsWith(".ts")) continue;
      const text = await readFile(f, "utf8");
      assert.ok(!/ICP_(SITE_FETCH|LLM|DISCO)_KEY\s*[:=]\s*["'][A-Za-z0-9]{8,}["']/.test(text), `D3/D60: a function key is written into ${f.pathname}`);
      if (f.pathname.endsWith("icpGate.ts")) assert.ok(!keyShaped.test(text), "D3/D60: the client takes its keys from the environment");
    }
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /`icp\(/, "D60: CANON.md names the icp verb");
    assert.match(canon, /icp-website-gate/, "D60: CANON.md points at the skill");
  });
});
