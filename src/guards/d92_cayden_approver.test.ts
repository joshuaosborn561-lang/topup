import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_VERBS } from "../grok/allowlist.js";
import { GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { ASK, isOwnerApprover, OWNER_APPROVER_NAMES } from "../policy/rules.js";
import { awaitingOwnerStatus, isAwaitingOwner, RUN_STATUSES } from "../domain/runs.js";
import { RECEIPT_META_KEYS } from "../jobs/filters.js";
import { confirmFiltersApprover } from "../recipes/receipt.js";
import { NEEDS_JOSH } from "../console/roles.js";
import { audienceName } from "../ledger/lane.js";

/** D92 — Cayden is a full approver equal to Josh. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D92 — Cayden is a full approver", () => {
  it("CANON names the rule, the verb, the bucket keys, and the lane filter", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D92\*\*/, "D92: fold into CANON. Ask Josh or Cayden.");
    assert.match(canon, /Cayden is a full approver equal to Josh/, "D92. Ask Josh or Cayden.");
    assert.match(canon, /awaiting_owner/, "D92: the write status. Ask Josh or Cayden.");
    assert.match(canon, /`confirm_filters/, "D92: the confirm verb is on the page. Ask Josh or Cayden.");
    assert.match(canon, /industries_by_campaign/, "D92: bucket keys. Ask Josh or Cayden.");
    assert.match(canon, /icp_gate/, "D92: receipt meta. Ask Josh or Cayden.");
    assert.match(canon, /registry lane/, "D92: stamps stay on the registry lane. Ask Josh or Cayden.");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D92 \|/m, "D92 index row");
    assert.match(ledger, /^## D92 — /m, "D92 entry");
  });

  it("ASK, owner names, and confirm accept Josh or Cayden", () => {
    assert.equal(ASK, "Ask Josh or Cayden.");
    assert.deepEqual([...OWNER_APPROVER_NAMES], ["josh", "cayden"]);
    assert.equal(isOwnerApprover("Josh"), true);
    assert.equal(isOwnerApprover("Cayden"), true);
    assert.equal(isOwnerApprover("Grok"), false);
    assert.ok(confirmFiltersApprover("Cayden").ok);
    assert.ok(confirmFiltersApprover("Josh").ok);
    assert.equal(confirmFiltersApprover("agent").ok, false);
    assert.equal(NEEDS_JOSH, "This needs Josh or Cayden.");
    assert.equal(audienceName("owner"), "Josh or Cayden");
  });

  it("awaiting_owner is the write; awaiting_josh still counts", () => {
    assert.ok((RUN_STATUSES as readonly string[]).includes("awaiting_owner"));
    assert.ok((RUN_STATUSES as readonly string[]).includes("awaiting_josh"));
    assert.equal(awaitingOwnerStatus(), "awaiting_owner");
    assert.equal(isAwaitingOwner("awaiting_owner"), true);
    assert.equal(isAwaitingOwner("awaiting_josh"), true);
    assert.equal(isAwaitingOwner("awaiting_operator"), false);
  });

  it("confirm_filters is a canon verb and icp_gate is receipt meta", () => {
    assert.ok((CANON_VERBS as readonly string[]).includes("confirm_filters"));
    assert.ok((GROK_VERBS as readonly string[]).includes("confirm_filters"));
    assert.equal(MCP_TOOL_ROLE.confirm_filters, "operator");
    assert.ok((RECEIPT_META_KEYS as readonly string[]).includes("icp_gate"));
  });

  it("the retag script is dry-run first and never writes banned columns", async () => {
    const src = await readFile(new URL("scripts/retag-bcp-pe-it-stamps.ts", root), "utf8");
    assert.match(src, /--apply/, "D92: apply is opt-in after merge. Ask Josh or Cayden.");
    assert.match(src, /if \(!apply\) return/, "D92: dry-run returns before any write. Ask Josh or Cayden.");
    assert.doesNotMatch(src, /\b(set|update)\s+dl_status|\b(set|update)\s+sg_exclude|\bskip_[a-z0-9_]+\s*=/, "D92: never write banned columns. Ask Josh or Cayden.");
    assert.doesNotMatch(src, /update_campaign_status/, "D92: never flip Smartlead. Ask Josh or Cayden.");
    assert.match(src, /ALLOWED_SUPABASE_PROJECT_REF/, "D92: refuse another project. Ask Josh or Cayden.");
    assert.match(src, /campaign_builds is a view/, "D92: do not DELETE the view. Ask Josh or Cayden.");
  });

  it("listPullReceipts and campaignBuilds stay on the registry lane", async () => {
    const repo = await readFile(new URL("src/db/repo.ts", root), "utf8");
    assert.match(repo, /registryLane/, "D92: receipts honor the registry lane. Ask Josh or Cayden.");
    assert.match(repo, /cb\.lane = cr\.lane/, "D92: builds honor the registry lane. Ask Josh or Cayden.");
    assert.match(repo, /and \(\$3::text is null or r\.lane = \$3\)/, "D92: receipt fallback also stays on the registry lane. Ask Josh or Cayden.");
    assert.doesNotMatch(repo, /if \(rows\.length\) return rows/, "D92: an empty lane-filtered builds list must not fall through to any(). Ask Josh or Cayden.");
  });
});
