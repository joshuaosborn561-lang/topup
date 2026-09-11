---
name: salesglider-cold-email-copy
description: The SalesGlider Growth house standard for writing cold email copy for any client in any vertical. Use whenever Josh asks to write copy, draft emails, write a sequence, create variants, revise or tighten copy, or fix an email. The voice and structure below are extracted from Josh's live Smartlead campaigns (SalesGlider Trades, BCP Healthcare, Peterson C1, Aug 2026), so match them instead of writing generic cold email.
---

# SalesGlider cold email copy standard

## The rules

1. **90 words or less.** Verify with a script. If spintax exists, count the longest rendered path.
2. **Structure, in this order, every Email 1:**
   1. Offer first. The gift or the free thing is the opening line, before any context.
   2. Who the client is. One line.
   3. Social proof. A real named or sized actor.
   4. Demonstrable ROI. A number the reader can check.
   5. Risk reversal. What specifically costs them nothing, then a soft close.
3. **No dashes of any kind.** Em dash, en dash, hyphen as pause: none. Use "..." instead.
4. **No fabricated claims.** Client said it or client documented it, or it does not go in.
5. Spintax comes later via spintax-generator, low risk elements only. Draft clean first.
6. **Spin every approved element you can, at up to 3 options each, not just the greeting.**
   A single spin point on the greeting alone under-varies the send fingerprint. Density target
   from a validated live build: **roughly 8 to 10 spin points per email**, one on nearly every
   approved element (opener verb, opener noun phrase, risk reversal, transition, both CTAs, PS
   reversal restate, PS delivery verb). Stop at 3 options per point; the validator warns past that.
7. **Segment-specific proof (a named client, a brand, a count) is a spintaxed template plus a
   merge variable, never a precomputed sentence per segment.** Precomputing one full sentence per
   brand or segment in the database is a trap: it can't be spun, it multiplies maintenance
   whenever the sentence needs to change, and it silently drifts across segments. Instead store
   the *value* (a brand name, a store count) as a plain merge field, and write one spintaxed
   template sentence that consumes it. One template serves every row in that segment tier;
   the fact and the phrasing update independently.

## Variable-driven proof line, worked example

Wrong (precomputed per segment, cannot spin, from the Vasco build before the fix):
```
"We already run warranty for a handful of Honda stores."   <- stored whole, one per brand, in the DB
```

Right (template plus merge variable):
```
{{brand}}                                                    <- plain value in the CSV/CRM: "Honda", "Ford", "Subaru"...
"{We already run|We currently run|We handle} warranty for {a handful of|several} {{brand}} stores."
```

Same pattern for a count-based segment with no single brand to name:
```
"{We run|We handle} warranty for 41 stores {across NY and NJ|in the NY and NJ area}."
```

And for a flagship/home-brand segment carrying a bespoke number:
```
"{We already run|We currently run|We handle} warranty for 12 {{brand}} stores... {{brand}} is our home brand."
```

Each tier of a segmented send (by brand, by size, by geography, by anything) gets its own
template like this, not its own hardcoded sentence. Build the DB column to hold the readable
display value (e.g. `brand_display`: "CDJR" becomes "Chrysler Jeep Dodge" for a merge tag, not
the internal code), and pick which template a row uses via a tier column, not by baking the
whole sentence per row.

## The structure, shown from live copy

Opening line IS the offer:
- "I've got an extra {couple|pair of} {{Local_Sports_Team}} tickets {on me|no charge}."
- "I've got an extra pair of AirPods with your name on them."
- "I would like to run a free email campaign to 10,000 leads, totally on me."
Never open with "not pitching anything here" or any variant of announcing what the email is not. The extra gift IS the opener.

Then who the client is, one line, no throat clearing:
- "quick context, we're Roofs by Peterson, commercial roofing out of Rockwall."
- "We're a cybersecurity firm that steps in as your outsourced security leader, running the program so you don't need a full-time hire."
- "We run outbound for trades businesses around {{location}}."

Then proof and ROI, usually fused into one or two lines:
- "one of our specialty trades clients got 41 replies in a single week off their first campaign with us."
- "Ran this for a Fortune 200 healthcare company... zero HIPAA breaches, passed every audit with no critical or high findings."
- "Roughly 130 jobs in four years. We've lost money on three of them, about six grand total."
- "one of our clients did $100k in new business 30 days after their first lead from us... over $2M in pipeline last quarter."

Then risk reversal plus a soft close:
- "Tickets are yours just for checking it out... open to it?"
- "you only pay once it's working."
- "no cost to find out how that works, and if it's not a fit, no hard feelings."
- PS lines carry the reversal restate: "PS- tickets come either way, just for hearing us out." "PS- no long-term contracts, choose your term."

## The opt-out PS is mandatory, on every email

Every email in every campaign ends with a conversational, reply-based opt-out. No exceptions,
no "this one is short enough", no leaving it off the bump. This is house law and it is the
single easiest thing to forget under time pressure.

It is a spun block, three spin points of four options each, 64 rendered variants:

```
PS- {if this isn't for you|if I've got this wrong|if this misses|if now's not the time}, {say the word|one word|just say so|reply no} and {I'll close the file|you won't hear from me again|I'll stop here|that's the last you'll see of me}.
```

On a gift campaign the E1 PS carries the reversal restate first, then the opt-out, in one PS:

```
PS- {the tickets come either way|they're yours either way}, just for hearing us out. {if this isn't for you|...}, {say the word|...} and {I'll close the file|...}.
```

Rules:

- Reply-based, never a link. A one-click unsubscribe link is a deliverability liability on
  cold sends and reads corporate. "reply no and I'll close the file" reads like a person.
- The opt-out block does **not** count toward the 90-word ceiling. Everything else does.
- `unsubscribe_text` stays empty in Smartlead campaign settings. The PS is the mechanism.
- Never spin the opt-out down to fewer options to save words. The variant count is the point.

## Sequence length

One follow up. E1 plus a single bump, and that is the whole sequence.

Longer sequences exist in older client campaigns and are not the standard going forward.
Do not build a 4-email or 7-email sequence unless Josh asks for one by name.

## The voice, extracted from the campaigns

- Short lines, one thought per line, a blank line between every sentence. No paragraphs.
- Casual to the point of lowercase. "worth sharing more?" not "Would you be open to learning more?"
- Blunt and colloquial where it lands: "most subs our size, the owner is the scheduler, and he's crappy at it." "That's the number that matters to you, because when a sub misses, the overage lands on your budget, not his."
- Honesty as proof. The Peterson copy admits losing money on three jobs. Weakness stated plainly reads as receipts, not weakness.
- "..." is the connective tissue: "on me... open to it?"
- Soft closes from the live set, "worth sharing more?" is the house favorite: "worth sharing more?" "open to it?" "worth a chance?" "interested?" "want to test us on the next one?" "do you mind if I send it over?"
- Bumps are two lines: "{{first_name}}, that offer's still open whenever you want it." plus one concrete new thing, then a permission ask.
- Subjects name the gift and nothing else: "{{Local_Sports_Team}} tix", "AirPods". See the
  `subject-line-offer-naming` skill. Curiosity hooks like "quick video" or "idea" are retired.
- Merge tags: {{first_name}}, {{company_name}}, {{location}}, {{Local_Sports_Team}}, {{brand}}, %signature%.

## Dense spin worked example

From a validated build, 8 spin points in one Email 1 (64 total across a 7-email sequence, all
longest paths still under 90 words):

```
{{first_name}},

{I have|I've got|Got} {an extra|a spare} pair of Yankees tickets {for you|with your name on them}... {want them, on me?|yours if you want them|on me if you want them}

{quick context,|for context,|so you know who's asking,} we're [Client], [City]. [one line of what we do].

{We already run|We currently run|We handle} warranty for {a handful of|several} {{brand}} stores.

[proof sentence, untouched, a real number].

{worth sharing more?|want the details?|worth a look?}

%signature%

PS- {[gift] come either way|they're yours either way}, our founder can {be there|swing by|drop them off} tomorrow.
```

Run the spintax-generator validator after every draft, not just before shipping. A file this
dense is easy to accidentally nest or leave a merge tag caught inside a spin group.

## After Josh approves

spintax-generator, then smartlead-campaign-settings, then the QA gate.
