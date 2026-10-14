# SOW Config Schema

The generator (`scripts/generate_sow.js`) takes a JSON config file describing
one SOW and produces a formatted .docx. This doc explains every field.

Standard legal sections (Confidentiality, IP, Data Privacy, Indemnity,
Disputes, Force Majeure, Severability, Entire Agreement, Signatures) are
always generated automatically with SalesGlider's standard boilerplate —
you only need to specify what's unique to this deal.

## Top-level fields

| Field | Required | Description |
|---|---|---|
| `title` | no | Defaults to "SalesGlider Growth Partners Agreement (Standalone)". Use a different string if the deal calls for something else (e.g. a pilot/POC). |
| `subtitle` | no | Optional line under the client name (e.g. "10,000-Lead Proof of Concept"). |
| `effectiveDate` | no | String, e.g. `"August 6, 2026"`. Omit/leave blank to generate a blank line for the client to fill in. |
| `serviceProvider` | no | Object `{ name, location, signerName }`. Defaults to JMO Solutions LLC / Dallas, Texas / Joshua Osborn, Founder. **Only include a DBA if Josh explicitly asks for one — default is no DBA.** |
| `client` | yes | See below. |
| `programOverview` | yes | 1.1 paragraph — plain language summary of what's being built and why. |
| `includedServicesIntro` | no | Intro sentence before the service categories (defaults to "The fee includes the following services:"). |
| `includedServices` | yes | Array of `{ label, items[] }` — each becomes a bolded category header (e.g. "Email Infrastructure & Outreach") followed by a bullet list. This is the bulk of Section 1.2. |
| `extraServiceSubsections` | no | Array of `{ title, body, bullets? }` for any additional numbered subsections under Section 1 (e.g. "Meeting Booking", "TAM and Send Volume", "Website Design & Build", "Market Exclusivity", "Onboarding"). `body` can be a string or array of strings (multiple paragraphs). |
| `noGuaranteeText` | no | Overrides the default "No Guarantee of Sales" paragraph. |
| `meetingGuarantee` | no | If the deal includes a guaranteed number of meetings, put the full clause text here (see pattern below). Adds a "Meeting Guarantee" subsection. |
| `meetingCap` | no | If capping how many meetings you'll deliver (e.g. free POCs), put the clause text here. |
| `excludedServices` | no | Array of strings for Section 2 ("Services Not Included"). Always include this — it prevents scope creep disputes. |
| `icpIntro` | no | Intro sentence for Section 3.1 (defaults to "The initial ICP parameters for this engagement are:"). |
| `icpBullets` | yes | Array of strings describing target company size, decision-maker titles, geography, industry. |
| `icpNote` | no | Free-text paragraph after the ICP bullets — use for caveats, exclusivity notes, or "will be refined during onboarding" language. |
| `term` | yes | Object `{ termText, cancellationText?, postTermText? }`. `termText` is required (e.g. "The term begins on the Effective Date and continues for three (3) months..."). `cancellationText` defaults to the standard 30-day notice / cancellation-fee clause — override only if the deal has different termination terms (e.g. "no early termination," Kyle Peterson style guarantees, etc). `postTermText` is optional (what happens after the term ends). |
| `fees` | yes | See below. |
| `clientResponsibilities` | yes | Array of `{ title, text }` for Section 6. |
| `ndaClause` | no | If the client asked for an NDA on request, add the clause text here. |
| `websiteOwnershipClause` | no | If a website build is in scope, add ownership language here (goes at the top of Section 8). |
| `complianceText` | no | Overrides the default CAN-SPAM/burner-domain paragraph in Section 9.1. |
| `extraComplianceClause` | no | Object `{ title, text }` — use for industry-specific compliance notes (e.g. healthcare Stark Law considerations). |
| `liabilityCap` | yes | Number, no `$` or commas (e.g. `9000`). Used in Section 10.2. |
| `liabilityCapNote` | no | Overrides the default "(equal to the total fees under this Agreement)" explanation — use e.g. "(equal to three (3) months of the monthly retainer)" if the cap doesn't equal full contract value. |

## `client` object

```json
{
  "legalName": "Reliable Technology Services LLC",
  "displayName": "Reliable Technology Services",
  "primaryContact": "John Smith",
  "signerName": "John Smith, CEO"
}
```

- `legalName` — used in the party block and signature section. Get this right; it's the contracting entity.
- `displayName` — used in the title block under "SalesGlider Growth Partners Agreement." Usually the same as `legalName` but can be a shorter/friendlier version (e.g. legal name "Roofs by Peterson LLC" but display "Roofs by Peterson").
- `primaryContact` — optional, adds "Primary contact: X." to the party paragraph.
- `signerName` — optional, defaults to `primaryContact` in the signature block.

## `fees` object

```json
{
  "feeLabel": "Monthly Retainer.",
  "feeText": "Client will pay Service Provider a monthly retainer of $2,000.00 USD...",
  "perMeetingFee": {
    "label": "Per-Meeting Fee.",
    "text": "In addition to the monthly retainer, Client will pay Service Provider $200.00 USD for each Qualified Meeting booked..."
  },
  "billingTimingText": "Monthly fees are billed in advance.",
  "includeGracePeriod": true,
  "gracePeriodText": null
}
```

- `feeLabel` — the bold sub-header for 5.1 (e.g. "Monthly Retainer.", "Engagement Fee.", "Monthly Fee.").
- `feeText` — the actual pricing paragraph. Spell out the full pricing logic here (base fee, total contract value, waivers, reduced first month, etc.) since pricing structures vary a lot deal to deal.
- `perMeetingFee` — **omit this field entirely if there's no per-meeting fee** (the generator will automatically render the standard "No Per-Lead or Per-Meeting Fees" subsection instead). If there IS a per-meeting/per-lead fee, provide `{ label, text }` and the generator renders a correctly-labeled subsection instead — never leave the "No Per-Lead" header in place when a per-meeting fee actually exists, that's a contradiction.
- `billingTimingText` — override if not simply "billed in advance" (e.g. "billed in arrears", "due in full upon execution").
- `includeGracePeriod` — set `false` to omit the failed-payment/pause clause entirely (e.g. one-time-payment-upfront deals with no ongoing billing).
- `gracePeriodText` — override the default 3-business-day grace period language if needed.

## Common patterns

**Meeting guarantee clause** (fill in the blanks):
> Service Provider guarantees a minimum of [N] qualified meetings booked to Client's calendar during the [TERM] Initial Term. A "qualified meeting" means [DEFINITION]. If fewer than [N] qualified meetings have been delivered by the end of the Initial Term, Service Provider will continue running the campaign at no additional charge beyond the fees already paid until [N] qualified meetings have been delivered. This is the sole performance remedy under this Agreement.

**Meeting cap clause** (for free POCs — protects you from working forever for free):
> Service Provider's obligation to book meetings under this Agreement is capped at [N] qualified meetings total. If [N] qualified meetings are booked before the end of the Term, Service Provider may pause outbound sending for the remainder of the engagement, and the Parties will move directly into the post-engagement discussion.

**No-DBA reminder:** Unless Josh explicitly says otherwise, `serviceProvider.name` should just be `"JMO Solutions LLC"` — no "DBA SalesGlider Leads" suffix.

**Liability cap:** Default to the full total contract value. Only use "3 months of the monthly retainer" style caps if there's no fixed total (e.g. an open-ended monthly retainer with no set term-end).

**Typography:** Use curly quotes/apostrophes (`\u201C` `\u201D` `\u2019`) in all config text, not straight ones (`"` `'`). The generator's hardcoded boilerplate uses curly typography throughout, so straight quotes in config text will look inconsistent in the final document (e.g. write `Client\u2019s` not `Client's`).
