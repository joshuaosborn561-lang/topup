---
name: spintax-generator
description: "Apply spintax to SalesGlider Growth cold email copy for send-fingerprint variation, and validate it before it ships. Use whenever Josh asks to add spintax, spin the copy, vary the copy for deliverability, check the longest path, verify a sequence is under 90 words, or asks how many variants a campaign needs. Enforces the house volume standard (20 distinct bodies per email slot, 20+ rendered spin paths inside each body, 2 subject variants) and the house safety rules: inline {a|b} syntax only, spin on low-risk elements only, core value prop and proof figures left completely untouched, merge tags preserved, no nesting, no dash punctuation, and every variant verified under 90 words on its LONGEST rendered path. Applies to any client campaign copy in any vertical."
---

# Spintax Generator

Two different things are being counted here and they must not be confused.

**Variants** are separately written bodies. A human wrote each one. They differ in angle,
structure and opening, not just wording.

**Spin paths** are the rendered permutations inside one body, produced by `{a|b}` groups.
The machine produced them. They differ only in low-risk phrasing.

## The volume standard

| Level | Required | Notes |
|---|---|---|
| Bodies per email slot | **20 minimum** | separately written, not spun from each other |
| Spin paths inside each body | **20 minimum** | on the longest path, still under 90 words |
| Subject variants | **2** | see subject-line-offer-naming |

That is 400+ distinct rendered emails per slot. E1 gets 20 bodies. Each follow up in the
sequence gets its own 20.

Twenty bodies is a lot of writing and that is the point. It is what keeps a 3,000 send
campaign from having one fingerprint. Do not manufacture the count by spinning harder,
because heavy spin is what made the MSP 20-to-200 batch read robotic.

### Hitting 20 spin paths without over-spinning

Options per spin point stay at **two or three**. The count comes from having several spin
points, not from stuffing one.

```
5 points x 2 options            = 32 paths
3 points x 3 options            = 27 paths
2 points x 3 + 2 points x 2     = 36 paths
```

Four to six spin points per body is the working range. A body with two spin points cannot
reach 20 and needs another point, not more options in an existing one.

### Where the 20 bodies come from

Vary the **angle**, not the claim. The value prop and the proof stay identical across all
20. What changes:

- which pain opens the email
- whether the proof point comes before or after the pain
- direct observation versus a question
- one sentence of context versus two
- which CTA shape closes it
- what the PS does

If two bodies differ only in synonyms, they are one body with a spin point in it. Merge
them and write a real one.

## What gets spun

Only these.

- **Greeting** ... `{Hey|Hi}`
- **Gift or offer phrasing** ... `a couple {extra|spare} {{gift}}`
- **Risk-reversal line** ... `{yours regardless|yours either way}`
- **Transitions** ... `{Reason for reaching out:|Why I'm reaching out:}`
- **CTA closers** ... `{Worth a reply?|Open to it?|Worth a look?}`
- **PS lines**
- **Bump openers** ... `{offer still stands|the offer's still good}`

## What never gets spun

- The **core value proposition**. One way of saying it, the way it was approved.
- **Any proof point, figure, percentage, or dollar amount.** These have to be defensible to
  the client. Varying them creates versions nobody signed off on. This holds across all 20
  bodies, not just within one.
- **Proprietary terms, product names, company names, people's names.**
- **Merge tags.** `{{first_name}}`, `{{company_name}}`, `{{gift}}`,
  `{{Local_Sports_Team}}`, `%signature%` pass through untouched. Merge tags use double
  braces, spintax uses single. The validator checks this collision specifically.

## Syntax rules

- **Inline `{a|b}` only.** No widget, no table, no alternate notation.
- **Two to three options per spin point.** More does not help deliverability and starts
  degrading readability.
- **No nesting.** `{a|{b|c}}` is malformed and Smartlead renders it wrong.
- **Every option must read naturally on its own** and preserve grammar with the surrounding
  sentence. Read rendered paths, not the raw string.
- **No dash punctuation of any kind.** Not em, not en, not hyphens as punctuation. Use
  "..." or commas. Standing house rule.

## The 90-word rule

Under 90 words on the **longest rendered path**, not the raw string and not the average.
This applies to every one of the 20 bodies independently. The opt-out PS block is exempt.

## Workflow

1. Write the clean copy first and get it approved. Spintax is applied last, never drafted into.
2. Write the remaining bodies to reach 20, varying angle rather than wording.
3. Apply four to six spin points per body from the approved element list.
4. **Run the validator on all 20.** Do not hand copy over without it.
5. Report per body: spin point count, path count, longest-path word count. Report any body
   under 20 paths or over 90 words as a failure, not a warning.

```
python3 scripts/check_spintax.py <file.md> [more files...]
python3 scripts/check_spintax.py --max-words 90 --min-paths 20 copy.md
python3 scripts/check_spintax.py --show-longest copy.md
```

The validator checks:

| Check | Why |
|---|---|
| Nested spintax | Smartlead renders it wrong |
| Unbalanced braces | Silent breakage in send |
| Merge tags intact | A mangled `{{first_name}}` sends "Hey {first_name}" |
| Merge tag caught inside a spin group | Double/single brace collision |
| Longest path word count | The 90-word rule, measured correctly |
| Path count per body | The 20-path floor |
| Body count per slot | The 20-body floor |
| Dash punctuation | Standing house rule |
| Spin points with 1 option | Dead spintax, usually a typo |
| Spin points with 4+ options | Over-spun, drifts robotic |
| Casing consistency inside a group | Shepherd style is all lowercase |

Exit code is non-zero if any hard check fails, so it gates a handoff.

## Output convention

When adding spintax to an approved file, write a **new version** rather than overwriting,
so prior copy stays intact. Append a one-line note recording what was spun and what was
deliberately left clean.

## Two construction styles

Keep one style per file.

- **Josh / Braun detachment** ... direct, normal casing, permission-based, no pressure.
- **Shepherd** ... all lowercase, "not pitching anything here," "reason for reaching out:".

In Shepherd style every spin option must also be lowercase.

## Sequencing note

Twenty bodies per slot means the approval gate matters more, not less. Josh reviews and
approves copy before it is uploaded or replaced in Smartlead, never after. Get the value
prop and every proof figure signed off before writing bodies 2 through 20, because a proof
correction after the fact means rewriting all twenty.
