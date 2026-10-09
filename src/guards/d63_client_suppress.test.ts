import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { excludedInboxesOf } from "../stages/route/index.js";
import {
  campaignMailboxSetOk,
  DEFAULT_RECYCLE_DAYS,
  excludedInboxesSql,
  expiredEligibleSql,
  hardBounceSql,
  positiveReplySql,
  publicSuppressionSql,
  recycleWindowSql,
  SUPPRESS_RECYCLE_MONTHS,
  thisClientLead,
} from "../stages/suppress/recycle.js";

/**
 * D63 — suppression is per client; after 6 months a person (including
 * unsubscribes) is eligible again for that client except the sending
 * inboxes, which stay blocked forever. Hard bounces stay forever.
 * Applied inside suppress at pull time only. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D63 — per-client 6-month suppress and inbox block", () => {
  it("positives, DNC, bounce and prior contact are this client only, 6 months", async () => {
    const recycle = await readFile(new URL("src/stages/suppress/recycle.ts", root), "utf8");
    const suppress = await readFile(new URL("src/stages/suppress/index.ts", root), "utf8");
    assert.equal(SUPPRESS_RECYCLE_MONTHS, 6, "D63: the window is 6 months. Ask Josh.");
    assert.equal(DEFAULT_RECYCLE_DAYS, 180, "D63: the recipe default is 180 days. Ask Josh.");
    assert.equal(recycleWindowSql(), "interval '6 months'");
    assert.match(positiveReplySql(), /smartlead_client_id = \$6/, "D63: positives are this client. Ask Josh.");
    assert.match(positiveReplySql(), /interval '6 months'/, "D63: positives expire after 6 months. Ask Josh.");
    assert.match(thisClientLead("l.category_id = $3"), /smartlead_client_id = \$6/, "D63: DNC is this client. Ask Josh.");
    assert.match(hardBounceSql(), /smartlead_client_id = \$6/, "D63: bounces are this client. Ask Josh.");
    assert.doesNotMatch(hardBounceSql(), /interval /, "D63: hard bounces stay forever (no time window). Ask Josh.");
    assert.match(publicSuppressionSql(), /permanent/, "D63: permanent public.suppression stays. Ask Josh.");
    assert.match(publicSuppressionSql(), /interval '6 months'/, "D63: non-permanent unsubscribes expire. Ask Josh.");
    assert.match(recycle, /smartlead_client_id = \$6/, "D63: recycle SQL is scoped to this client. Ask Josh.");
    assert.doesNotMatch(suppress, /when \$\{[^}]*same_offer/, "D63: same_offer_other_client is not applied. Ask Josh.");
    assert.doesNotMatch(suppress, /then 'same_offer_other_client'/, "D63: same_offer_other_client is not a WHEN. Ask Josh.");
  });

  it("suppress reports expired_eligible and stamps excluded_inboxes at pull time", async () => {
    const suppress = await readFile(new URL("src/stages/suppress/index.ts", root), "utf8");
    const recycle = await readFile(new URL("src/stages/suppress/recycle.ts", root), "utf8");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(suppress, /expired_eligible/, "D63: suppress must count expired-and-eligible separately. Ask Josh.");
    assert.match(suppress, /expired-and-eligible/, "D63: the Slack/line text names the count. Ask Josh.");
    assert.match(expiredEligibleSql(), /sent_at < now\(\) - interval '6 months'/, "D63: expired means older than 6 months. Ask Josh.");
    assert.match(expiredEligibleSql(), /s\.bounced/, "D63: a hard bounce is never expired-eligible. Ask Josh.");
    assert.match(recycle, /and not \$\{hardBounceSql\(\)\}/, "D63: expired-eligible excludes hardBounceSql. Ask Josh.");
    assert.match(suppress, /excluded_inboxes/, "D63: suppress stamps excluded_inboxes on the row. Ask Josh.");
    assert.match(suppress, /excluded_campaigns/, "D63: suppress stamps the prior campaign ids. Ask Josh.");
    assert.equal(excludedInboxesSql(), "'[]'::jsonb", "D63: public.sends has no sender column; stamp empty until Josh names the source.");
    assert.match(grok, /expired_eligible/, "D63: the suppress tool describes expired_eligible. Ask Josh.");
    assert.doesNotMatch(suppress, /cron\.schedule|node-cron/, "D63: no cron. Applied at pull time only. Ask Josh.");
  });

  it("route and stage carry excluded_inboxes; unknown mailbox set is refused", async () => {
    const route = await readFile(new URL("src/stages/route/index.ts", root), "utf8");
    const stage = await readFile(new URL("src/stages/stage/index.ts", root), "utf8");
    const migration = await readFile(new URL("supabase/migrations/0020_d63_client_suppress.sql", root), "utf8");
    assert.match(route, /excludedInboxesOf/, "D63: route reads the per-lead excluded-inbox list. Ask Josh.");
    assert.match(route, /campaignMailboxSetOk/, "D63: route refuses a campaign whose mailbox set overlaps. Ask Josh.");
    assert.match(stage, /excluded_inboxes/, "D63: stage copies excluded_inboxes onto leads_staging. Ask Josh.");
    assert.match(migration, /excluded_inboxes text\[\]/, "D63: leads_staging carries excluded_inboxes. Ask Josh.");
    assert.equal(campaignMailboxSetOk([], ["a@box.com"]), true);
    assert.equal(campaignMailboxSetOk(["a@box.com"], []), false, "D63: unknown mailbox set + exclusions is refused. Ask Josh.");
    assert.equal(campaignMailboxSetOk(["a@box.com"], ["a@box.com", "b@box.com"]), false);
    assert.equal(campaignMailboxSetOk(["a@box.com"], ["b@box.com"]), true);
    assert.deepEqual(excludedInboxesOf({ excluded_inboxes: [" A@Box.com "] }), [" A@Box.com "]);
    assert.deepEqual(excludedInboxesOf({}), []);
  });

  it("never writes dl_status, sg_exclude or skip_*, and Smartlead is not asked to exclude inboxes", async () => {
    const suppress = await readFile(new URL("src/stages/suppress/index.ts", root), "utf8");
    const recycle = await readFile(new URL("src/stages/suppress/recycle.ts", root), "utf8");
    const route = await readFile(new URL("src/stages/route/index.ts", root), "utf8");
    const stage = await readFile(new URL("src/stages/stage/index.ts", root), "utf8");
    const smartlead = await readFile(new URL("src/clients/smartlead.ts", root), "utf8");
    for (const [name, src] of [
      ["suppress", suppress],
      ["recycle", recycle],
      ["route", route],
      ["stage", stage],
    ] as const) {
      assert.doesNotMatch(src, /\b(dl_status|sg_exclude)\s*=/, `D63: ${name} never writes dl_status or sg_exclude. Ask Josh.`);
      assert.doesNotMatch(src, /\bskip_[a-z0-9_]*\s*=/, `D63: ${name} never writes skip_*. Ask Josh.`);
    }
    assert.ok(!(SMARTLEAD_ALLOWED as readonly string[]).includes("update-lead-email-account"), "D63: assigning one mailbox is not an exclude list and is not on the D6 allow list. Ask Josh.");
    assert.doesNotMatch(smartlead, /update-lead-email-account|update_lead_email_account/, "D63: do not call update-lead-email-account. Ask Josh.");
    assert.doesNotMatch(smartlead, /add_to_block_list|add-domain-block-list/, "D63: do not push per-lead inbox blocks onto the global list. Ask Josh.");
  });

  it("CANON and the ledger name D63", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D63\*\*/, "D63: fold this decision into CANON.md. Ask Josh.");
    assert.match(canon, /Suppression is per client/, "D63: CANON.md states the per-client rule. Ask Josh.");
    assert.match(canon, /expired_eligible/, "D63: CANON.md names the expired-eligible count. Ask Josh.");
    assert.match(canon, /excluded_inboxes/, "D63: CANON.md names excluded_inboxes. Ask Josh.");
    assert.match(ledger, /^## D63 — /m, "D63: append the decision, do not edit an old one. Ask Josh.");
    assert.match(ledger, /unsubscribe risk/, "D63: Josh accepted the unsubscribe risk. Ask Josh.");
  });
});
