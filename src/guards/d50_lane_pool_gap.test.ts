import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D50 — registry lane, stored Maps pool, a count gap that does not park. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D50 — lane, pool, gap", () => {
  it("CANON and the ledger name D50 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D50\*\*/);
    assert.match(canon, /## The lane on the registry, the stored pool, and a count gap \(D50\)/);
    assert.match(canon, /mismatch_minor/);
    assert.match(ledger, /## D50 — /);
    assert.match(ledger, /^\| D50 \| Live/m);
  });

  it("lane lookup reads campaign_registry before pull receipts", async () => {
    const repo = await readFile(new URL("src/db/repo.ts", root), "utf8");
    const start = repo.indexOf("async laneForCampaign");
    const end = repo.indexOf("async campaignBuilds");
    const body = repo.slice(start, end);
    const registryAt = body.indexOf("topup.campaign_registry");
    const receiptsAt = body.indexOf("topup.pull_receipts");
    assert.ok(registryAt > 0 && receiptsAt > registryAt, "D50: campaign_registry is read before pull_receipts in laneForCampaign");
  });
});
