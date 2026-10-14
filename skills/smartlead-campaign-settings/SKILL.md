---
name: smartlead-campaign-settings
description: "Stand up and QA a Smartlead campaign to Josh's standard for SalesGlider Growth: half-client staffing floor and ESP mix, assigning the currently-sending pod, the 21-day warmup gate, the 85% SmartDelivery placement gate, schedule, plain text, tracking off, stop-on-reply, AI lead categorization, bounce autopause OFF, mailbox linking, email body HTML, merge tag gate, and the pre-launch QA checklist. Use whenever Josh asks to build a Smartlead campaign, set up a sequence, staff or attach inboxes, configure sending rules or a schedule, run a pre-launch placement or seed test, upload copy, or references 'the settings we established' or 'same as my other campaigns'. Also use before setting any campaign ACTIVE. Setup and pre-launch QA only — rest execution, top-up, fan-out, live placement pulls, bounce and pause handling belong to the deliverability wizard app. Use this instead of guessing at values; skipping it has silently left campaigns on Smartlead defaults."
---

# Smartlead Campaign Settings

Everything required to stand up a SalesGlider campaign correctly. Values were read from
Josh's live campaigns via the real API and from the deliverability wizard's canon, not
invented.

Creating a campaign, uploading a sequence, and linking mailboxes is **not enough**. Several
separate calls must all be made explicitly or the campaign silently runs on Smartlead
defaults.

**The living rulebook is `CANON.md` in the `deliverabilitywizard` repo (D127).** The wizard
app on Railway converges most infrastructure settings every 15 minutes — per-mailbox volume
and gap, signatures, warmup flags, bounce autopause OFF, placement test backfill, staffing
floors. This skill builds to the **same** values so a launch is never fighting the machine.
If this file and `CANON.md` ever disagree, canon wins; update this skill in the same breath.

**Scope.** This skill staffs a launch, QAs it, and gets out of the way. Rest execution,
top-up, fan-out, live placement pulls, bounce response, and pause handling are the app's
15-minute health job and 10-minute bounce loop. Do not run any of those from here and do not
duplicate their logic below.

**Do not launch canary or partial attachment.** The 85% placement gate replaced that. The
canary fleet is placement instrumentation (D54) — it never staffs a live campaign.

---

## 1. Fleet staffing

**Floor is half the client's own staffable inboxes** (D58/D82). Count the client's
connected, non-resting, non-retired, warmup-cleared boxes; the campaign must staff at least
half of them. There are **no named-client exceptions** (Vasco is nobody special) and **the
old global 50 floor is dead** — do not resurrect it. The checker also wants roughly **30%
Google and 30% Microsoft** in the mix (`CAMPAIGN_ESP_MIX_MIN_PERCENT=30`); a fleet skewed
45 Google to 5 Microsoft fails the mix even when the count is met.

Staffable means all of:

- connected SMTP **and** IMAP
- serving **this client only** — one client per sender, hard (D26/D75); a box on another
  client's ACTIVE campaigns is not supply, ever
- not resting: neither a client off-week box nor a generic on its sit (D43)
- not on a retired domain — retired domains stay off live campaigns forever (D65)
- not a canary or copy-canary box (D54/D55)
- warmup age gate cleared (section 2) — a box that owes warmup days is not supply even when
  the campaign sits under floor (D139)

Client inboxes fill first. **Generics staff only a POC client (currently Goliath) or a
campaign Josh has Slack-approved** (D81/D82) — they are not default gap-filler for ordinary
clients. The "Generic" and "POC" Smartlead client records are mailbox pools, not clients;
never rewrite a generic's pool assignment to force it onto a client (D142). The one
automatic exception: a domain-retire tap auto-approves generic cover for the ACTIVE
campaigns it pulled senders from, so volume never drops while replacements warm (D134).

**Fenced campaigns.** Leave these alone entirely... do not staff, rest, or top up: Smartlead
ids `3628940`, `3611325`, `3611268` (old MSRS / HVAC / Roofers; still in
`TOP_UP_EXCLUDE_CAMPAIGNS`).

### When supply falls short of the floor

Client fortnights and generic send clocks pull supply down on unsynchronized clocks, so a
short fleet is a normal outcome, not an anomaly. It is also not something to solve by
improvising.

If the client's staffable boxes land under the floor, **stop and tell Josh the number**,
then take direction. Do not:

- attach a resting or sitting box to close the gap
- waive the warmup age gate — a fresh import waits out its 21 days even while its campaigns
  sit under floor (D139)
- attach another client's boxes (D26)
- launch short and plan to top up later

The real options are delaying the launch, running fewer campaigns concurrently, buying
inventory (spend-gated behind `/approvals`, $25 domain / 25 mailbox monthly caps — Josh's
call), or Josh Slack-approving generic backfill (D81). All are business calls. The app also
posts its own `generic_backfill` asks when a live campaign runs short — do not pre-empt
them by hand.

### There is no hold pile

The HOLD/rotation system is **deleted** (D130) and pulls are **kill-only** (D51/D128):
placement %, bounce %, blacklist hits, and leftover `HOLD-UNTIL-*` tags do NOT bench a
mailbox. The only things that remove a box from live campaigns are Josh killing it or
retiring its domain, and the 21-day warmup gate (D105). A leftover HOLD tag on a box is
decoration from a dead system — it is never a reason to skip the box at staffing time, and
never a reason to strip anything either. Warmup exemption likewise does not live in tags:
it comes from the prewarmed config (section 2), a flag only Josh grants (D142).

### Which pod is sending right now — read it, then assign it

Each client's inboxes split **evenly into stable A and B halves** that alternate 2 weeks on
and 2 weeks off (D43); a client is never fully dark. The halves show in Smartlead as
`POD-A`/`POD-B` mailbox tags — decoration for humans (D135). At staffing time you do not
compute the fortnight yourself; you read what the app is already doing and mirror it:

1. **Mirror a live campaign.** `Smartlead:list_campaign_mailboxes` on any of the client's
   existing ACTIVE campaigns. The attached set **is** the currently-sending pod — the health
   job converges it every 15 minutes. Attach those same boxes, plus any staffable box
   carrying the same pod tag that fan-out has not reached yet.
2. **Cross-check the tag.** The POD tag shared by the attached majority names the sending
   pod. A client box carrying the **other** tag is off-week and not attachable, however
   healthy and connected it looks.
3. **No ACTIVE campaign to mirror** (the client's first launch): there is no off-week yet —
   every staffable box is in play. Attach them all and let the rest job start the A/B cycle
   on its own clock. Do not invent a split by hand.
4. **Ambiguous** (attached set spans both tags, or tags are missing): read the latest
   `[client-rest]` line in the wizard's Railway logs — it names the on-week cohort and what
   was benched/restored — or ask Josh. Do not guess.

- The off-week half is **removed from live campaigns.** Warmup stays on.
- Parking a box at `MESSAGE_PER_DAY=0` is **not** rest. Unlink it.

The cycle itself is run by the app (D43). What matters at staffing time is that **off-week
boxes are not attachable and do not count toward the floor.**

Two ways the count goes wrong:

- **A resting box left linked from a previous cycle.** It shows in the sender list and
  inflates the count while sending nothing.
- **A box parked at `MESSAGE_PER_DAY=0`.** Same effect. Unlink rather than leaving it at zero.

Count staffable senders by reading the attached list back, not by trusting the campaign's
sender count.

### Generic send clock, not the client fortnight

Generics do **not** sit when clients sit. Each generic sends roughly **14 days**, sits
roughly **14 days**, then returns to supply (D43). Clocks are staggered per box by when that
box started sending.

**A generic on its sit is not staffable and is not top-up supply.**

### Fan-out applies to on-week boxes only

Same-client fan-out is the rule (D84): attach the client's **on-week** inboxes across that
client's ACTIVE campaigns; a client-owned box belongs on every ACTIVE campaign for its
client even if it currently sits on zero. BCP-owned domains count as BCP even with no
`client_id` (D99). Do not split boxes proportionally by lead volume. Resting boxes are
skipped, and so is anything that owes warmup days (D139).

`link_mailboxes` is additive and idempotent, so re-calling with the full on-week list adds
only the missing boxes. It will **not** remove one that has since gone off-week. Unlinking
is a separate, explicit call.

The app also tops up and fans out every 15 minutes. If a mailbox you expected is missing, or
one you removed reappears, read the `[health]`, `[client-rest]`, and `[generic-rest]` log
lines (and `/health`) before attaching by hand. Manual moves that fight the job get reverted
or doubled.

**Never `START` or `PAUSE` a campaign from automation. Pauses belong to humans in both
directions (D40/D148).** A campaign someone paused or stopped by hand is never auto-resumed.

### Per-mailbox settings

Every staffed mailbox, without exception (the app converges these every pass — set them
right at build so the first 15 minutes aren't wrong):

| Setting | Value |
|---|---|
| Campaign emails per day | **30** (warmup mail not counted, D24) |
| Minimum gap between emails | **10 minutes** (D30/D35) |
| Warmup | **ON**, always, including rest weeks — the canary fleet is the only warmup-OFF fleet (D83), and it never staffs |
| Signature | plain `First Last` newline `{Client Brand}` (D31) |

**Real throughput ceiling: staffed senders × 30/day.** The campaign-level
`max_leads_per_day: 10000` is not a real number. Plan volume against the staffed count
times 30.

---

## 2. Warmup age gate

A mailbox may not send live campaign mail until it has served **21 days from its InboxKit
import** (D1 clock, D50 duration, D105 gate). There is no shorter tier — the old 14-day
pool-generic tier is gone; every non-exempt box owes the full 21.

**Exempt from the clock entirely** (D19/D142):

- every mailbox on `PREWARMED_DOMAINS`: crosslaunchco.com, crossscaleco.com, cleartechco.com
- the from-name generic fleets in `EXTRA_GENERIC_MAILBOXES`
- the canary fleet (which never staffs anyway, D54)

**Pre-warmed is a flag only Josh grants.** Generic-pool membership never implies it (D142) —
a random pool generic still owes its 21 days.

**The clock runs from the InboxKit import date (`warmedAt`), never from Smartlead's
`warmup_details` or warmup start date** — those reflect when the box entered Smartlead, not
when it was warmed, and using them benches boxes that are ready (or launches boxes that
aren't).

**The warmup age gate runs before the placement test, not after.** Testing an under-age
fleet produces a number that means nothing.

**The gate is not waivable from chat** (D18), including when a launch date is close. An
under-age box needed to reach the floor is a signal to wait, or to ask Josh about prewarmed
supply — not to start early. The app's gate will pull an under-21-day box off an ACTIVE
campaign on the next pass anyway, so a waived launch un-staffs itself within 15 minutes.

Related build-time consequence (D143): a freshly imported box that still owes warmup days
does not even get its `client_id` attach yet — the app defers the write until the 21 days
are served, because a client-tagged young box is exactly what outside writers staff onto
live campaigns early. Do not hand-attach a client_id to a box that has not served its clock.

---

## 3. Placement test gate

**Every campaign passes a SmartDelivery placement test before it goes live.** This replaced
launching at partial attachment.

### Setup

One **recurring** SmartDelivery schedule per campaign, `every_days: 1`. Not a fresh manual
test each morning. A campaign found missing its test gets one backfilled by the app on the
same health pass (D116) — but at build time, create it yourself.

**Test quota is unlimited** (`TOTAL_TEST_QUOTA=0`, D45). Do not ration tests and do not skip
the control test below. The API caps a single test at **50 senders**; a fleet bigger than
that tests in slices — slice it yourself rather than testing a subset and extrapolating.

### Two numbers, and only one is a gate

| When | Number | Meaning |
|---|---|---|
| **Pre-launch** (this skill) | **85%** same-ESP, promo tab counts as a miss | A gate. Below it, the campaign does not go ACTIVE (D46/D106). |
| **Live** (the app) | **80%** same-ESP | A **reading**, not a pull. Nothing benches a sender on placement — pulls are kill-only (D51/D128). |

Launch at 85 so there is margin. After launch, placement numbers are diagnosis inputs
(infra vs copy, D49/D93/D96) and feed Josh's retire decisions — they never automatically
remove a mailbox. **Do not launch at 80**, and never use the blended all-ESP score for
anything (D32).

**Gmail Promotions tab counts as a MISS** on the launch test. Promo placement does not
produce replies, so counting it as delivered makes the number meaningless. Score it
honestly.

### Test the real sender set

Run against the **actual mailboxes that will ship the campaign**, at full attachment, after
the warmup age gate clears. Testing a subset and extrapolating defeats the purpose, because
the failure this gate exists to catch is usually a few specific boxes dragging an average.

### Below 85: mailboxes or copy?

Do not stall on a failed test. Diagnose, then relaunch on what survives.

**Step one, read the variance, not the average.** SmartDelivery reports placement per
sending mailbox.

- **Clustered failure** (40 boxes at 90 and 10 at 40) is **infrastructure**. The average is
  lying to you.
- **Uniform failure** (everything in a tight band at the same low number) is **copy**, or
  something shared across the fleet: SPF, DKIM, a link domain.

**Step two, run a control test.** Neutral body, same fleet, plain text, no links, no offer
language. (Live campaigns get this permanently as the known-good pod control, D56/D131;
pre-launch you run it once by hand.)

| Control | Campaign copy | Verdict | Action |
|---|---|---|---|
| High | Low | **Copy** | Link domain, spam trigger words, image or tracking artifact |
| Low | Low | **Mailboxes** | Leave the laggards off the launch list, retest, launch on survivors — and hand Josh the laggard list; retiring a domain is his tap (D49/D146) |
| Low | High | Noise | Rerun both |

**The link domain fails first more often than the words do.** Test
`book.salesglidergrowth.co` placement independently before rewriting copy.

Passing this gate means the infrastructure is sound at rest. Post-launch placement
monitoring, diagnosis, and the word-hunt are the app's job.

---

## 4. Schedule ... `Smartlead:set_schedule`

```json
{
  "campaign_id": "<id>",
  "schedule": {
    "timezone": "America/Chicago",
    "days_of_the_week": [1, 2, 3, 4],
    "start_hour": "09:00",
    "end_hour": "18:00",
    "min_time_btw_emails": 10,
    "max_leads_per_day": 10000
  }
}
```

- **Monday to Thursday only.** No Friday, no weekends.
- **9:00 to 18:00 America/Chicago.**
- **`min_time_btw_emails: 10`.** Settled (D30/D35, held at both mailbox and campaign level —
  the checker writes a drifted campaign back to the 10-minute floor on sight, D138). Do not
  use 13 or 20, both of which appear in older campaigns and older instructions.
- **`max_leads_per_day: 10000`** is uncapped at the campaign level. The real bound is
  staffed senders × 30/day. Do not quote 10000 as throughput.
- **API gotcha:** the raw endpoint wants `max_new_leads_per_day`. `set_schedule` translates
  this internally; `smartlead_request` does not and will 400.

## 5. General settings ... `POST /campaigns/{id}/settings`

```json
{
  "send_as_plain_text": true,
  "track_settings": ["DONT_TRACK_EMAIL_OPEN", "DONT_TRACK_LINK_CLICK"],
  "stop_lead_settings": "REPLY_TO_AN_EMAIL",
  "enable_ai_esp_matching": true,
  "follow_up_percentage": 100,
  "unsubscribe_text": ""
}
```

- **`send_as_plain_text: true`** is a delivery-layer toggle. Bodies are still authored in
  the `<div>` HTML structure below.
- **Tracking fully off**, opens and clicks. Deliberate.
- **`stop_lead_settings: "REPLY_TO_AN_EMAIL"`** ... a reply to any step exits the sequence.
- **`follow_up_percentage: 100`** ... every non-replier gets the full sequence.
- **API gotcha:** `GET /campaigns/{id}` echoes back `DONT_EMAIL_OPEN` / `DONT_LINK_CLICK`.
  Posting those values back will 400. Always write the `DONT_TRACK_*` form.

## 6. AI categorization and bounce settings

Use `Smartlead:update_campaign_ai_bounce_settings` (single) or
`update_campaigns_ai_bounce_settings` (batch).

**Pass every field explicitly. Do not rely on `use_bcp_defaults: true`.** The defaults have
drifted from Josh's standard before and the failure is silent.

| Setting | API field | Value |
|---|---|---|
| Bounce auto-pause threshold | `bounce_autopause_threshold` | `"100"` (string — this is **OFF**) |
| Active AI categories | `ai_categorisation_options` | `[6, 1, 3]` |
| Restart OOO when lead returns | `out_of_office_detection_settings.autoCategorizeOOO` | `true` |
| Ignore OOO from reply % | `ignoreOOOasReply` | **`true`** |
| Re-activate OOO after delay (deprecated) | `autoReactivateOOO` | `false` |
| | `reactivateOOOwithDelay` | `null` |

**Smartlead's bounce autopause is OFF, everywhere, on purpose (D80/D88/D124/D148).**
`"100"` disables it. Never set `"7"` or any live threshold — the old value from before the
rewrite. Josh's standing call is that **nothing pauses on bounces** (D148, "I don't want
anything paused anymore... investigating remediating and readding"): the app's 10-minute
bounce loop is the only bounce actor — it detects a real burst, classifies the SMTP reasons,
Slacks one receipt, routes the remediation (tenant-cap page, burned-domain retire ask,
bad-list callout), and re-queues remediated leads itself. The app also force-converges any
campaign whose threshold drifts off 100, so a hand-set "7" both fights the machine and
pauses a campaign canon says never pauses.

`[6, 1, 3]` maps to **Out Of Office, Interested, Not Interested**, those three only.

`ignoreOOOasReply: true` goes on every campaign. **Category 6 must also be filtered out
before quoting reply counts to a client**, regardless of this setting.

**The payload mixes British and American spelling, and mixes snake_case with camelCase.
This is not a typo in this document. Copy the field names exactly.**

- `ai_categorisation_options` ... British **s**, snake_case
- `autoCategorizeOOO` ... American **z**, camelCase
- `bounce_autopause_threshold` ... snake_case, value is the **string** `"100"`, not `100`

`autoCategorizeOOO` and `autoReactivateOOO` are **mutually exclusive.** Setting both true is
invalid. `ai_categorization_enabled` (American z) is **not** a real field and correctly
400s. Do not retry it.

**Why the AI part matters:** AI categorization was off across all eight Goliath campaigns,
leaving 50+ replies with `lead_category_id: null` and untriaged. Turning it on only affects
future replies, never backfills. Set it before going live.

## 7. Mailbox setup ... `Smartlead:link_mailboxes`

Attach **all on-week staffable client inboxes** (fan-out, D84). Generics join only on a POC
campaign or with Josh's approval (section 1). Confirm the mix lands near 30% Google / 30%
Microsoft.

Every mailbox needs a signature set. Null signatures across all 88 mailboxes has happened.

**Signature format: `First Last` newline `{Client Brand}` (D31), generated automatically.**
The app writes a missing, malformed, or foreign-client signature itself on sight
(D74/D92/D125) — but set them correctly at link time anyway so the first sends are right:

```
signature = f"{from_name}\n{client_company_name}"
```

`from_name` is already on the mailbox record. `client_company_name` comes from the
Smartlead client record (`Smartlead:list_clients`, the `logo` field, e.g. "Vasco Warranty")
or from the company name Josh gave for the build. Write it with
`Smartlead:update_email_account`, `account: {"signature": "..."}`, **before**
`link_mailboxes` runs.

If `from_name` is missing or clearly not a person (a shared inbox, a role account), skip
the auto-default and flag it for Josh rather than guessing a name.

**`client_id` rules (D136/D142/D143):**

- Set `client_id` on the **campaign** always.
- Set `client_id` on a mailbox only when it is genuinely that client's box **and it has
  served its 21-day warmup** — the app deliberately defers the client attach on younger
  boxes (D143); do not front-run it.
- **Never rewrite a box that already carries a real `client_id`** (D136). Splits and
  ambiguous domains are advisories for Josh, not guesses.
- Never re-point a Generic/POC pool box's assignment to a client (D142) — pool membership
  is what makes it a generic.

---

## Email body formatting

### One sentence per `<div>`, separated by `<div><br></div>`

Every distinct sentence gets its own div. Paragraph breaks are an explicit empty div, never
a bare `<br>` between divs. The bare-`<br>` pattern looks correct in an API diff and renders
wrong in Smartlead's editor.

```html
<div>{Hey|Hi} {{first_name}},</div><div><br></div><div>I've got a {couple|pair of} {{Local_Sports_Team}} tickets {on me|yours if you want them}.</div><div><br></div><div>%signature%</div>
```

`%signature%` is its own final div. If a PS follows, `%signature%` comes first, PS after,
each on its own line:

```html
<div>%signature%</div><div><br></div><div>PS- no long term contract, {you choose your term|cancel whenever}.</div>
```

### Use the native `variants` array

`upload_sequence` takes a `variants` array per step. Use it for A/B/C testing across offers
or case studies. **Never** concatenate whole email bodies with `|` as manual spintax... that
sends literal `{`, `}`, and `|` characters to prospects. Confirmed broken in production.

Variants split **evenly across all leads in a campaign.** Gating a variant to a lead
segment (for example, Variant C to 300+ seat orgs only) is impossible with variants and
requires **separate campaigns.**

### Merge tags: the hard gate

**System fields**, per Smartlead's API docs, always available on the lead object: `email`,
`first_name`, `last_name`, `company_name`, `phone_number`, `website`, `location`,
`linkedin_profile`, `company_url`.

**Everything else is a custom field**, stored inside `custom_fields`. That includes
`job_title`, which Smartlead's own docs show as custom. Also `gift`, `Local_Sports_Team`,
`employee_range`, `industry`.

**Custom field names are stored exactly as typed.** A field added as `Gift` creates the key
`Gift`, and `{{gift}}` will match nothing and send a blank line. Case, underscores, and
spaces all matter. There is no normalization.

**Never assume a custom key. Read it back** from `Smartlead:list_campaign_leads`, which
returns `custom_fields` as a nested object. Whatever keys appear there are the keys to use,
character for character.

**Two different bugs have both reached real prospects. One check does not catch both.**

*Bug one, wrong tag name.* `{{company}}` is not a Smartlead field. It does not auto-map and
sends as literal text. It shipped in five BCP campaigns and was found only by a post-launch
audit. Others that look right and are not: `{{firstname}}`, `{{lastname}}`, `{{phone}}`,
`{{city}}`.

*Bug two, field absent from leads.* `{{gift}}` was a valid tag, but roughly 7 of 8
education leads had no `gift` key. 312 emails went out with a blank line before anyone
noticed. The tag was correct; the data was not there.

The first is a copy problem, the second is a data problem, and a campaign can have either
independently.

**Run the gate before `upload_sequence` and again before ACTIVE:**

```
# pull both straight from the API, no hand editing
GET /campaigns/{id}/sequences                     -> sequences.json
Smartlead:list_campaign_leads (several offsets)   -> leads.json

python3 scripts/check_merge_tags.py sequences.json leads.json
```

The script lives beside this skill at `scripts/check_merge_tags.py`. Exit code 1 means do
not upload; it names the offending step and variant. If the script is missing, do the same
comparison by hand from the two files: every `{{tag}}` must be either a system field or a
`custom_fields` key present on enough sampled leads.

**Sample leads at several offsets, never just offset 0.** The Goliath gap was invisible at
offset 0 and obvious at offset 1600. A single-offset sample is not a sample.

**Never hand-transcribe the JSON into the script.** Write the raw API response to a file.

---

## Import rules

- `import_leads` updates custom fields on existing leads rather than duplicating. Use it
  deliberately for field patches.
- Chunk ceiling is **200 to 220 leads** per call.
- **Never hand-transcribe JSON payloads** into tool calls. Rows drop silently, no error.
- The only valid verification is `upload_count` **exactly equalling** the number submitted.
  Spot-checking offsets is not verification and has produced two false "verified" claims.
- `upload_count` and `already_added_to_campaign` **overlap**, they do not sum.
- Never run concurrent imports against one campaign from two sessions.

---

## Pre-launch QA gate

Nothing goes ACTIVE until every line passes. (Going ACTIVE is a human/Josh call — automation
never STARTs a campaign, D40; the app's QA-unpause covers only PAUSED POC campaigns after
signature QA, D77/D82.)

**Infrastructure**

1. **Staffable senders at or above half the client's own inboxes** (D58), roughly 30%
   Google and 30% Microsoft, counted after excluding off-week rest, generics on their sit,
   retired domains, canaries, and anything owing warmup days. Ignore leftover HOLD tags —
   that system is deleted (D130).
2. **Zero resting mailboxes attached.** Verify by read-back. No box at `MESSAGE_PER_DAY=0`.
3. **Every attached mailbox has served 21 days from InboxKit import**, except the prewarmed
   domains / from-name fleets Josh has flagged (D142). No 14-day shortcuts — that tier no
   longer exists.
4. **Recurring SmartDelivery schedule exists** at `every_days: 1`.
5. **Launch placement 85% or higher, same-ESP, promo counted as a miss** (D46/D106), run
   against the full real sender set after the warmup gate cleared. A failed test is
   diagnosed and relaunched on survivors, not waived.
6. Signatures `First Last` / `{Client Brand}` on all linked mailboxes; per-mailbox at
   30/day, 10-minute gap, warmup on.
7. **`bounce_autopause_threshold` is the string `"100"`** — Smartlead's autopause OFF
   (D124/D148). Never a live threshold.

**Campaign**

8. **Merge tag gate passed.** `check_merge_tags.py` exits 0 against live sequences and a
   multi-offset lead sample. This is a gate, not a glance.
9. `%signature%` present on every variant and every step.
10. `client_id` set on the **campaign**, and on every mailbox that qualifies under the
    D136/D142/D143 rules in section 7.
11. Suppression and domain block list applied, scoped to that `client_id` (run the
    global-suppression skill; the Smartlead block list is never deleted, only added to).
12. Cross-campaign dedupe verified against full exports.
13. Schedule applied and verified by read-back.
14. AI categorization on, `ignoreOOOasReply: true` passed explicitly.
15. No off-ICP leads. Retail, student orgs, and school districts have all slipped through.
16. Every proof claim in the copy is client-approved. No exceptions.

**Suppression is a hard gate.** Never load a campaign before the client's existing-customer
list is received and applied. Two clients' own customers have been cold-emailed.

An AP or billing export is not a domain block list. It lists billing entities, not sending
domains. Ask for company names and resolve them to domains yourself.

---

## Verifying settings actually landed

`set_schedule` and `update_campaign_settings` both return `{"ok": true}` with no echo of
what was applied. To confirm real values, `GET /campaigns/{campaign_id}` via
`smartlead_request` and check `send_as_plain_text`, `min_time_btwn_emails`,
`stop_lead_settings`, and `scheduler_cron_value` against the values above.

A success response is not verification. Read it back. After launch, `/health` on the wizard
(`canonCompliant`, `canonFindings`, `stages`, `deploy`) is the production read on whether
the campaign is being kept to these values.

## Source of truth

**`CANON.md` in the `deliverabilitywizard` repo is the one-page authority (D127); this
skill mirrors it for build-time work.** Schedule and general settings were read from live
campaigns via the real API; AI categorization field mapping came from Josh after the MCP
tools landed.

Decisions this skill leans on: floor and staffing D26/D58/D75/D81/D82/D84/D99/D139; rest
D43 (pod tags D135); kill-only pulls and the deleted hold/rotation system D51/D128/D130;
warmup clock and exemptions D1/D50/D105/D142/D143; placement gates and quota
D32/D45/D46/D106/D116; bounce posture D80/D124/D141/D148 (nothing pauses; the app's burst
loop investigates, remediates, re-queues); pauses are human D40; signatures D31/D74/D92;
retired domains D65; spend gates D18.

The old numbers this skill used to carry are **dead**: the 50-sender global floor, the
proven-weak HOLD test, the 14-day pool warmup tier, the live 80%/5% pull bars, and bounce
autopause at `"7"`. If any instruction — including an older copy of this skill — says
otherwise, canon wins.

If Josh changes a standard, the change lands in the repo (`DECISIONS.md` + `CANON.md`, same
PR) **and** in this skill. Do not rely on a future session remembering the old number.
