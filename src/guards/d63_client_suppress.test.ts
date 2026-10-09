import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { excludedInboxesOf, recycleExclusionOf } from "../stages/route/index.js";
import {
  classifySeats,
  DEFAULT_RECYCLE_DAYS,
  excludedGenericInboxesSql,
  excludedInboxesSql,
  excludedPodsSql,
  expiredEligibleSql,
  hardBounceSql,
  otherPod,
  positiveReplySql,
  publicSuppressionSql,
  recycleHoldReason,
  recycleRouteOk,
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
    assert.match(suppress, /excluded_pods/, "D63: suppress stamps the named-seat POD. Ask Josh.");
    assert.match(suppress, /excluded_generic_inboxes/, "D63: suppress stamps generic seats. Ask Josh.");
    assert.match(suppress, /excluded_campaigns/, "D63: suppress stamps the prior campaign ids. Ask Josh.");
    assert.equal(excludedInboxesSql(), "'[]'::jsonb", "D63: public.sends has no sender column; stamp empty until Josh names the source.");
    assert.equal(excludedPodsSql(), "'[]'::jsonb", "D63: no named-seat POD map here yet. Ask Josh.");
    assert.equal(excludedGenericInboxesSql(), "'[]'::jsonb", "D63: no generic seat map here yet. Ask Josh.");
    assert.match(grok, /expired_eligible/, "D63: the suppress tool describes expired_eligible. Ask Josh.");
    assert.doesNotMatch(suppress, /cron\.schedule|node-cron/, "D63: no cron. Applied at pull time only. Ask Josh.");
  });

  it("route keys on the other named-seat POD; generics hold; mailbox set is not the key", async () => {
    const route = await readFile(new URL("src/stages/route/index.ts", root), "utf8");
    const recycle = await readFile(new URL("src/stages/suppress/recycle.ts", root), "utf8");
    const stage = await readFile(new URL("src/stages/stage/index.ts", root), "utf8");
    const migration = await readFile(new URL("supabase/migrations/0020_d63_client_suppress.sql", root), "utf8");
    assert.match(route, /recycleRouteOk/, "D63: route keys on POD, not the live mailbox set. Ask Josh.");
    assert.doesNotMatch(route, /campaignMailboxSetOk/, "D63: do not key route on a campaign mailbox set. Ask Josh.");
    assert.doesNotMatch(recycle, /function campaignMailboxSetOk/, "D63: campaign mailbox sets are not stable. Ask Josh.");
    assert.match(stage, /excluded_inboxes/, "D63: stage copies excluded_inboxes. Ask Josh.");
    assert.match(stage, /excluded_pods/, "D63: stage copies excluded_pods. Ask Josh.");
    assert.match(stage, /excluded_generic_inboxes/, "D63: stage copies excluded_generic_inboxes. Ask Josh.");
    assert.match(migration, /excluded_inboxes text\[\]/, "D63: leads_staging carries excluded_inboxes. Ask Josh.");
    assert.match(migration, /excluded_pods text\[\]/, "D63: leads_staging carries excluded_pods. Ask Josh.");
    assert.match(migration, /excluded_generic_inboxes text\[\]/, "D63: leads_staging carries excluded_generic_inboxes. Ask Josh.");

    assert.equal(otherPod("A"), "B");
    assert.equal(otherPod("B"), "A");
    const empty = { excluded_inboxes: [], excluded_pods: [], excluded_generic_inboxes: [] };
    assert.equal(recycleRouteOk(empty, null), true);
    assert.equal(recycleRouteOk({ excluded_inboxes: ["a@x.com"], excluded_pods: ["A"], excluded_generic_inboxes: [] }, "B"), true, "D63: named POD A routes to a campaign on POD B. Ask Josh.");
    assert.equal(recycleRouteOk({ excluded_inboxes: ["a@x.com"], excluded_pods: ["A"], excluded_generic_inboxes: [] }, "A"), false, "D63: do not route onto the excluded POD. Ask Josh.");
    assert.equal(recycleRouteOk({ excluded_inboxes: ["a@x.com"], excluded_pods: ["A"], excluded_generic_inboxes: [] }, null), false, "D63: unknown campaign POD holds. Ask Josh.");
    assert.equal(recycleRouteOk({ excluded_inboxes: ["g@x.com"], excluded_pods: [], excluded_generic_inboxes: ["g@x.com"] }, "B"), false, "D63: a generic seat holds; cannot re-check at send. Ask Josh.");
    assert.equal(recycleHoldReason({ excluded_inboxes: ["g@x.com"], excluded_pods: [], excluded_generic_inboxes: ["g@x.com"] }, "B"), "excluded_generic");
    assert.equal(
      recycleRouteOk({ excluded_inboxes: ["mystery@x.com"], excluded_pods: [], excluded_generic_inboxes: [] }, "B"),
      false,
      "D63: unclassified inboxes hold. Ask Josh.",
    );

    const seats = new Map([
      ["named-a@x.com", { kind: "named" as const, pod: "A" as const }],
      ["gen@x.com", { kind: "generic" as const, pod: null }],
    ]);
    const classified = classifySeats(["named-a@x.com", "gen@x.com"], seats);
    assert.deepEqual(classified.excluded_pods, ["A"]);
    assert.deepEqual(classified.excluded_generic_inboxes, ["gen@x.com"]);
    assert.deepEqual(excludedInboxesOf({ excluded_inboxes: [" A@Box.com "] }), [" A@Box.com "]);
    assert.deepEqual(recycleExclusionOf({}).excluded_pods, []);
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
    assert.match(canon, /other POD/, "D63: CANON.md keys named seats on the other POD. Ask Josh.");
    assert.match(canon, /Generic seats hold/, "D63: CANON.md holds generic seats. Ask Josh.");
    assert.match(ledger, /other client POD|other POD|other half/, "D63: the ledger keys named seats on the other POD. Ask Josh.");
    assert.match(ledger, /^## D63 — /m, "D63: append the decision, do not edit an old one. Ask Josh.");
    assert.match(ledger, /unsubscribe risk/, "D63: Josh accepted the unsubscribe risk. Ask Josh.");
  });
});
