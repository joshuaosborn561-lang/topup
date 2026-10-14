---
name: salesglider-sow
description: Generate a SalesGlider Growth Partners Statement of Work (SOW) as a formatted .docx file for JMO Solutions LLC (Josh Osborn's outbound lead-gen agency). Use this whenever Josh asks to write, draft, create, redo, or update a SOW, contract, or agreement for a client — whether from a call transcript, a Fireflies recording, or a plain list of deal terms (price, term, scope, ICP, guarantees). Also use when Josh asks to change/adjust an existing SOW (pricing, term length, scope, exclusions, meeting guarantees, DBA name, client legal name, etc.) or wants a SOW converted into a DocuSign-ready template. Always use this skill instead of hand-writing the docx generation code from scratch — it encodes SalesGlider's standard legal boilerplate, formatting, and section structure so every SOW stays consistent.
---

# SalesGlider SOW Generator

Generates a professional, legally-structured Statement of Work as a .docx file
for JMO Solutions LLC (dba varies by context — see note below) using a
data-driven generator script, instead of hand-writing document-creation code
for every deal.

## When to use this

Trigger this skill whenever Josh:
- Asks for a SOW/contract/agreement for a named client
- Pastes or references a call transcript / Fireflies recording and wants a SOW built from it
- Gives you a list of deal terms (price, term length, scope, guarantees) and wants a SOW
- Asks to modify an existing SOW (price, term, exclusions, ICP, guarantees, entity name)
- Asks to turn a SOW into a DocuSign template

## Workflow

### 1. Gather deal terms

If Josh gives you a transcript (pasted text, uploaded doc, or Fireflies call),
read the whole thing and extract:
- Client legal name + any DBA, primary contact name
- Pricing structure (monthly fee, per-meeting fee, one-time fee, waived first month, etc.) and total contract value
- Term length and any special termination/cancellation terms
- Full scope of services discussed (channels, volume, deliverables like websites/AI agents/lead magnets)
- What's explicitly NOT included
- ICP / target market (company size, decision-maker titles, geography, industry)
- Any guarantees (meeting minimums, "work until we get you X", money-back, opt-outs)
- Onboarding timing / campaign start dates if discussed
- Any compliance quirks specific to the client's industry (e.g. healthcare gift restrictions)

If Josh gives you terms directly instead of a transcript, just use those. If
something important is missing or ambiguous (e.g. liability cap basis, whether
LinkedIn is in scope), make a reasonable default per the patterns in
`references/config-schema.md` and flag the assumption in your reply — don't
block on asking unless it's a genuinely load-bearing ambiguity (e.g. price).

**Default assumptions unless told otherwise:**
- Service Provider = `JMO Solutions LLC`, Dallas, Texas. **No DBA** unless Josh explicitly asks for one.
- Governing law: Texas. Disputes: mediation first in Dallas, then litigation in Dallas County.
- Cancellation: 30 days written notice, next-30-days billed as fee if notice isn't given.
- Liability cap: total contract value (unless the deal has no fixed total, in which case use 3 months of the recurring fee).
- Payment: Stripe, CC or ACH, billed in advance.

### 2. Build the config

Read `references/config-schema.md` for the full field reference, and look at
`references/example-config.json` for a realistic filled-out example. Write a
JSON config file capturing this specific deal — don't skip the "Services Not
Included" section (it prevents scope-creep disputes) or the ICP section.

Save the config to a working file, e.g. `/tmp/sow-config.json`.

### 3. Generate the docx

```bash
cd /path/to/this/skill
npm install -g docx  # if not already installed
node scripts/generate_sow.js /tmp/sow-config.json /tmp/output.docx
```

Then validate it renders correctly:
```bash
python /mnt/skills/public/docx/scripts/office/validate.py /tmp/output.docx
```

### 4. Deliver

Copy the file to `/mnt/user-data/outputs/` with a clear name — the convention is:

```
SalesGlider Growth Partners SOW - <Client Display Name>.docx
```

Then call `present_files` on it. Keep your reply to Josh short: a bullet list
of what's specific to this deal (price, term, key scope items, any guarantee),
not a restatement of the standard boilerplate that's the same on every SOW.

## Modifying an existing SOW

If Josh wants changes to a SOW already generated in this conversation, prefer
editing the config JSON and re-running the generator over hand-editing XML —
it's faster and less error-prone. If the original config isn't available
(e.g. from an earlier session), reconstruct one from the previous docx's
visible content, then edit and regenerate.

For small find-and-replace style changes across a docx you don't have the
config for (e.g. "remove the DBA everywhere"), it's fine to unpack and
str_replace the XML directly per the docx skill's normal workflow — but for
anything touching pricing, term, or scope structure, regenerating from an
updated config is more reliable.

## DocuSign templates

If Josh asks for a DocuSign-ready template: leave `client.legalName` /
`effectiveDate` blank (empty string) in the config so they render as blank
fill-in lines, and mention to Josh that he'll need to add signature/date
anchor fields in DocuSign itself when he uploads it (this skill doesn't
inject DocuSign anchor tags automatically — if he wants those, add plain
white-text anchor strings like `/sn1/`, `/dt1/` near each signature block by
extending the config's `serviceProvider.signerName` / `client.signerName`
fields, or ask him if he wants that wired into the generator).

## Notes

- The generator always produces the same 15-section legal structure (Services →
  Not Included → ICP → Term → Fees → Client Responsibilities → Confidentiality →
  IP → Data Privacy → Indemnity → Disputes → Force Majeure → Severability →
  Entire Agreement → Signatures) so every SalesGlider SOW looks and reads the same.
- Formatting: Arial, 11pt body / 12pt section headers / 14pt title, numbered
  sections with lettered sub-bullets, 1" margins, signature blocks with
  underlines.
- Keep pricing/term/scope language in the config as *complete, specific
  paragraphs* — don't rely on the generator to compose pricing logic from
  scratch, since deal structures vary too much (flat fee vs. per-meeting vs.
  waived first month vs. milestone-based) for a generic template to get right.
