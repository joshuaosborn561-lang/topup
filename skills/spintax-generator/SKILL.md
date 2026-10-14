---
name: spintax-generator
description: "Apply spintax to SalesGlider Growth cold email copy for send-fingerprint variation, and validate it before it ships. Use whenever Josh asks to add spintax, spin the copy, vary the copy for deliverability, check the longest path, verify a sequence is under 90 words, or asks how many variants a campaign needs. Enforces the house volume standard (ONE approved body per email slot, spun to 20+ rendered paths, 2 subject variants; never invent extra bodies) and the house safety rules: inline {a|b} syntax only, spin on low-risk elements only, core value prop and proof figures left completely untouched, merge tags preserved, no nesting, no dash punctuation, and every variant verified under 90 words on its LONGEST rendered path. Applies to any client campaign copy in any vertical."
---

# Spintax Generator

Two different things are being counted here and they must not be confused.

**Bodies** are separately written emails. A human wrote each one. They differ in angle,
structure and opening.

**Spin paths** are the rendered permutations inside one body, produced by `{a|b}` groups.
The machine produced them. They differ only in low risk phrasing.

**The house standard is one body per slot, spun hard.** Josh approves a body, and spintax
then produces at least twenty rendered versions of *that* body. Writing extra bodies to hit
a count is inventing copy he never approved. Josh corrected this Sept 23 2026: "20" means
twenty spintax renderings of the same core, not twenty different emails.

## The volume standard

| Level | Required | Notes |
|---|---|---|
| Bodies per email slot | **1** | the approved body, nothing invented alongside it |
| Spin paths inside that body | **20 minimum** | on the longest path, still under 90 words |
| Subject variants | **2** | see subject-line-offer-naming |

Every follow up in the sequence is its own approved body under the same rule.

If Josh explicitly asks for multiple angles tested against each other, that is an A/B test
he asked for, not this standard. Write only the number he asked for.

### Hitting 20+ paths from one body

Options per spin point stay at **two or three**. The count comes from having several spin
points, not from stuffing one.

```
5 points x 2 options            = 32 paths
3 points x 3 options            = 27 paths
2 points x 3 + 2 points x 2     = 36 paths
6 points x 2 options            = 64 paths
4 points x 3 options            = 81 paths
```

**Six to nine spin points per body is the working range,** since one body carries all the
variation. Stop adding points once rendered paths stop reading like a person wrote them.
Heavy spin is what made the MSP 20 to 200 batch read robotic, so read four or five rendered
paths end to end before shipping.

A short bump of two or three sentences will not hold nine points. Four or five is fine
there as long as it clears twenty paths.

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
- **The opening line.** It is the approved angle. Spinning it turns one body into several
  bodies, which is what this standard exists to prevent. A greeting word before it is fine.
- **Any proof point, figure, percentage, or dollar amount.** These have to be defensible to
  the client. Varying them creates versions nobody signed off on.
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
The opt-out PS block is exempt.

## Workflow

1. Write the clean copy first and get it approved. Spintax is applied last, never drafted into.
2. Apply six to nine spin points to the approved body, from the approved element list.
3. Read four or five rendered paths end to end. If any reads machine assembled, pull a point.
4. **Run the validator.** Do not hand copy over without it.
5. Report per slot: spin point count, path count, longest path word count. Anything under
   20 paths or over 90 words is a failure, not a warning.

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

Josh reviews and approves copy before it is uploaded or replaced in Smartlead, never after.
Show him the spun body in full, plus two or three rendered paths, before upload.
