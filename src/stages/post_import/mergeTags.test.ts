import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkMergeTags, collectTags, nearMiss, tagsIn } from "./mergeTags.js";
import { scheduleDays, settingsFindings } from "./settings.js";

/** Port of check_merge_tags.py: the same inputs give the same verdicts. */
describe("step 12 — merge tag gate (port of check_merge_tags.py)", () => {
  it("collects tags per step and per variant, labelled as the script labels them", () => {
    const tags = collectTags([
      { subject: "Hi {{first_name}}", body: "at {{ company_name }} — {{Local_Sports_Team}}" },
      { variants: [{ subject: "{{first_name}}", body: "{{gift}}" }, { subject: "", body: "{{job_title}}" }] },
    ]);
    assert.deepEqual([...tags.get("first_name")!].sort(), ["step 1", "step 2, variant A"]);
    assert.deepEqual([...tags.get("company_name")!], ["step 1"]);
    assert.deepEqual([...tags.get("gift")!], ["step 2, variant A"]);
    assert.deepEqual([...tags.get("job_title")!], ["step 2, variant B"]);
    assert.deepEqual(tagsIn("{{a}} {{ b }} {{c-d}}"), ["a", "b"]);
  });

  it("KNOWN_BAD fails: {{company}} sends as literal text", () => {
    const r = checkMergeTags(collectTags([{ body: "{{company}} {{first_name}}" }]), { present: { first_name: 10, company_name: 10 }, total: 10 });
    assert.equal(r.ok, false);
    assert.match(r.fails[0], /\{\{company\}\} is not a Smartlead field\. Use \{\{company_name\}\}/);
  });

  it("a system field under coverage warns; a custom field under 100% fails; zero coverage is the Goliath failure", () => {
    const tags = collectTags([{ body: "{{first_name}} {{Local_Sports_Team}} {{gift}}" }]);
    const r = checkMergeTags(tags, { present: { first_name: 9, Local_Sports_Team: 7, gift: 0, vendor: 10 }, total: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.warns.length, 1);
    assert.match(r.warns[0], /first_name.*system field, only 90\.0%/);
    assert.equal(r.fails.length, 2);
    assert.match(r.fails.find((f) => f.includes("Local_Sports_Team"))!, /only 70\.0% populated \(7\/10\)\. 3 leads would send a blank line/);
    assert.match(r.fails.find((f) => f.includes("{{gift}}"))!, /ZERO staged leads\. This is the Goliath failure/);
    assert.deepEqual(r.unusedFields, ["vendor"]);
  });

  it("a near miss names the field the leads actually carry", () => {
    assert.equal(nearMiss("local_sports_team", ["Local_Sports_Team", "vendor"]), "Local_Sports_Team");
    assert.equal(nearMiss("gift", ["Gift Tier"]), null);
    const r = checkMergeTags(collectTags([{ body: "{{local_sports_team}}" }]), { present: { Local_Sports_Team: 10 }, total: 10 });
    assert.match(r.fails[0], /leads carry 'Local_Sports_Team'.*Use \{\{Local_Sports_Team\}\}/);
  });

  it("an empty sample cannot verify coverage and fails", () => {
    const r = checkMergeTags(collectTags([{ body: "{{first_name}}" }]), { present: {}, total: 0 });
    assert.equal(r.ok, false);
    assert.match(r.fails[0], /lead sample is empty/);
  });

  it("all tags resolve → ok, with the ok lines the script prints", () => {
    const r = checkMergeTags(collectTags([{ body: "{{first_name}} {{job_title}}" }]), { present: { first_name: 10, job_title: 10 }, total: 10 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.oks, ["{{first_name}} system field, 100%", "{{job_title}} custom field, 100%"]);
  });
});

describe("step 12 — settings findings (skill smartlead-campaign-settings)", () => {
  it("reads the five settings and says unknown for what the response lacks", () => {
    const f = settingsFindings({
      send_as_plain_text: true,
      track_settings: ["DONT_TRACK_EMAIL_OPEN", "DONT_TRACK_LINK_CLICK"],
      stop_lead_settings: "REPLY_TO_AN_EMAIL",
      scheduler_cron_value: JSON.stringify({ days_of_the_week: [1, 2, 3, 4] }),
    });
    assert.deepEqual(
      f.map((x) => [x.check, x.verdict]),
      [
        ["send_as_plain_text", "pass"],
        ["tracking_off", "pass"],
        ["stop_on_reply", "pass"],
        ["bounce_autopause_off", "unknown"],
        ["schedule_mon_thu", "pass"],
      ],
    );
  });

  it("fails what is set wrong: tracking on, Friday in the schedule, autopause a number", () => {
    const f = settingsFindings({ send_as_plain_text: false, track_settings: ["DONT_TRACK_EMAIL_OPEN"], stop_lead_settings: "NONE", bounce_autopause_threshold: 5, days_of_the_week: [1, 2, 3, 4, 5] });
    assert.deepEqual(f.map((x) => x.verdict), ["fail", "fail", "fail", "fail", "fail"]);
    assert.deepEqual(scheduleDays({ scheduler_cron_value: "not json" }), null);
  });
});
