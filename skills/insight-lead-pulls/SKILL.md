---
name: insight-lead-pulls
description: Pull Insight leads — director and above at mid-size US companies with small IT departments. Grok bot (D39) must not execute this pull in chat — start start_topup or hand a CSV URL to LeadPipe ingest_csv. Use whenever Josh asks for Insight, Embark-style, Awardco-style, or OEM rep lists. Gateway catch-alls are dropped, not segmented.
---

# Insight lead pulls

**Grok bot (D39):** do not execute this pull in chat. `start_topup` or LeadPipe `ingest_csv`.

LeadPipe client_tag `insight`.

## ICP (items 56, 57)

Director and above at US companies **201 to 2,000** with IT departments of **15 or fewer**. No SLED. Managers only under 500. Three contacts per company.

Modeled on Embark, Awardco, DocGo, Shane Co. Growth rate is a score, never a filter.

OEM reps are pulled by employer and role (item 59).

## Gateway catch-alls (item 58)

Dropped, not segmented. A recipe for this client sets `verify.drop_gateway_catchalls: true`. SEG catch-alls do not go to a SEG campaign. Item 6 (segment, do not throw out) still applies to every other client.

Do not invent campaign ids here. The first Insight recipe names the live campaigns.
