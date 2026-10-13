import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { countSource } from "../canon/count.js";
import { PROSPEO_SEARCH_URL } from "../canon/prospeoSearch.js";
import { loadConfig } from "../config.js";

/**
 * D83 — Prospeo is a count source: page 1 of search-person, approved_by,
 * official industry names, inexact flags. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D83 — Prospeo count source", () => {
  it("CANON folds D83 as live, not code pending", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Prospeo is a count source/, "D83: fold into CANON. Ask Josh.");
    const rule = canon.match(/Prospeo is a count source[\s\S]*?\(D83\)\./);
    assert.ok(rule, "D83: CANON names the Prospeo count rule. Ask Josh.");
    assert.doesNotMatch(rule?.[0] ?? "", /code pending/, "D83: the code-pending note is gone. Ask Josh.");
    assert.match(canon, /`prospeo` \(page 1 of search-person/, "D83: the count read names prospeo. Ask Josh.");
    assert.doesNotMatch(canon, /Prospeo count is \*code pending\*/, "D83: the count table is live. Ask Josh.");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D83 \| Live;/m, "D83: status index is live. Ask Josh.");
  });

  it("uses the existing PROSPEO_API_KEY env name and never writes skip columns", async () => {
    const cfg = loadConfig({});
    assert.equal(cfg.PROSPEO_API_KEY, "");
    assert.equal(cfg.PROSPEO_SEARCH_URL, PROSPEO_SEARCH_URL);
    assert.match(PROSPEO_SEARCH_URL, /search-person$/);
    const env = await readFile(new URL(".env.example", root), "utf8");
    assert.match(env, /^PROSPEO_API_KEY=$/m, "D3/D83: the Prospeo key is a Railway variable, named here, never valued");
    const count = await readFile(new URL("src/canon/count.ts", root), "utf8");
    const search = await readFile(new URL("src/canon/prospeoSearch.ts", root), "utf8");
    assert.doesNotMatch(count, /\b(dl_status|sg_exclude)\s*=/, "D83: never write dl_status or sg_exclude. Ask Josh.");
    assert.doesNotMatch(search, /\b(dl_status|sg_exclude)\s*=/, "D83: never write dl_status or sg_exclude. Ask Josh.");
    assert.doesNotMatch(count, /\bskip_[a-z0-9_]*\s*=/, "D83: never write skip_*. Ask Josh.");
    assert.doesNotMatch(search, /\bskip_[a-z0-9_]*\s*=/, "D83: never write skip_*. Ask Josh.");
  });

  it("a mocked count waits for a name and flags inexact industry mappings", async () => {
    const recorded: unknown[] = [];
    const d = {
      getleads: { count: async () => ({ total_matching: 0 }) },
      aiArk: null,
      prospeo: { count: async () => ({ total_matching: 12, free: false }) },
      maps: null,
      permits: null,
      rails: {
        gate: async (req: { approvedCents?: number }) =>
          req.approvedCents && req.approvedCents > 0
            ? { kind: "proceed", worstCaseCents: 2, reason: "approved" }
            : { kind: "ask", worstCaseCents: 2, reason: "needs an owner tap" },
        record: async (r: unknown) => {
          recorded.push(r);
        },
      },
    } as never;
    const filters = { job_titles: ["Owner"], industries: ["Truck Transportation", "Outpatient Care Centers"] };
    const estimate = await countSource(d, { client_tag: "bcp", source: "prospeo", filters });
    assert.equal(estimate.count, null);
    assert.match(estimate.note ?? "", /approved_by/);
    assert.equal(estimate.estimate_cents, 2);
    assert.equal(estimate.industry_mappings?.find((m) => m.input === "Truck Transportation")?.prospeo, "Truck and Railroad Transportation");
    const ran = await countSource(d, { client_tag: "bcp", source: "prospeo", filters, approved_by: "Josh" });
    assert.equal(ran.count, 12);
    assert.equal((recorded[0] as { approvedBy: string }).approvedBy, "Josh");
  });
});
