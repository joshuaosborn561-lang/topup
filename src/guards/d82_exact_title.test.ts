import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { exactTitleWhereSql, outboundFilters, type GetleadsFilters } from "../clients/getleads.js";
import { peoplePreviewBody } from "../clients/aiArkPreview.js";
import { GETLEADS_STORED_KEYS, getleadsParamsFromFilters } from "../jobs/filters.js";

/**
 * D82 — GetLeads titles are exact match by default; AI Ark counts use
 * STRICT. Substring only when the receipt says so. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D82 — exact title match", () => {
  it("GetLeads count and pull send lower(current_title) IN unless the receipt asks for substring", () => {
    assert.equal(exactTitleWhereSql(["CIO", "Director of IT"]), "lower(current_title) IN ('cio', 'director of it')");
    const exact = outboundFilters({ job_titles: ["CIO"] } as GetleadsFilters);
    assert.equal(exact.where_sql, "lower(current_title) IN ('cio')");
    assert.ok(!("job_titles" in exact), "D82: exact mode must not also send substring job_titles. Ask Josh.");
    const parsed = getleadsParamsFromFilters({ job_titles: ["CIO"], title_match: "substring" });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const sub = outboundFilters(parsed.params as GetleadsFilters);
    assert.deepEqual(sub.job_titles, ["CIO"]);
    assert.ok(!("where_sql" in sub));
    assert.ok(GETLEADS_STORED_KEYS.includes("title_match"));
  });

  it("AI Ark counts use STRICT exact-title mode unless the receipt asks for substring", () => {
    const exact = peoplePreviewBody({ job_titles: ["Owner"] } as GetleadsFilters);
    assert.equal(exact.ok, true);
    if (!exact.ok) return;
    const mode = (exact.body.contact as { experience: { latest: { title: { any: { include: { mode: string } } } } } }).experience.latest.title.any.include.mode;
    assert.equal(mode, "STRICT", "D82: AI Ark exact-title mode is STRICT. Ask Josh.");
    const sub = peoplePreviewBody({ job_titles: ["Owner"], title_match: "substring" } as GetleadsFilters);
    assert.equal(sub.ok, true);
    if (!sub.ok) return;
    const word = (sub.body.contact as { experience: { latest: { title: { any: { include: { mode: string } } } } } }).experience.latest.title.any.include.mode;
    assert.equal(word, "WORD");
  });

  it("CANON folds D82 as live, not code pending", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Title filters are exact match/, "D82: fold into CANON. Ask Josh.");
    const rule = canon.match(/Title filters are exact match[\s\S]*?\(D82\)\./);
    assert.ok(rule, "D82: CANON names the title rule. Ask Josh.");
    assert.doesNotMatch(rule?.[0] ?? "", /code pending/, "D82: the code-pending note is gone. Ask Josh.");
    assert.match(canon, /lower\(current_title\) IN/);
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D82 \| Live;/m, "D82: status index is live. Ask Josh.");
  });
});
