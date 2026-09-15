---
name: subject-line-offer-naming
description: Write SalesGlider Growth cold email subject lines as the bare name of the gift being offered, nothing else, with exactly two variants. Use whenever Josh asks to write, fix, or update subject lines, builds a new campaign sequence, or asks to make subjects match the offer. Covers the AirPods lane, the sports ticket lane with the Local_Sports_Team merge field, and any future gift. Applies to E1 and to every follow up in the sequence, across any client and any vertical.
---

# Subject line offer naming

## The rule

The subject line is the name of the gift. Nothing else goes in it.

No curiosity hooks, no questions, no company or first name merge tags, no "quick one", no "idea for you", no fake-reply framing on the first email. The offer is the strongest thing we have, so the subject says the offer and the body does the rest.

## Why

These campaigns lead with a gift in the first line. When the subject teases something different from what the body opens with, the reader gets a small bait and switch on the way in. When the subject is just the gift, the open is honest and the body confirms it immediately.

It also keeps subjects short, which is the only reliable subject-line lever left. Two to four words, lowercase-natural except the product name.

## Variant count: exactly two

**Two variants per slot. Not three.** This is the house standard and it is deliberate.

The body carries the variation load: 20 written bodies, each with 20 or more rendered spin paths, per the spintax-generator standard. The subject is the one element that should stay recognizable across the whole campaign, because it is what the offer is named after. A third variant adds fingerprint noise the body already supplies, and it splits reporting three ways on the only field worth reading open rates against.

Two also keeps the A/B clean. One control, one alternate.

## E1 subjects

Two variants, both naming the same gift.

**AirPods lane**

```
{AirPods|AirPods for you}
```

**Sports ticket lane**

```
{{{Local_Sports_Team}} tix|{{Local_Sports_Team}} tickets}
```

Use `tix` as the default. It reads like a person wrote it. Spell out `tickets` only as the second variant.

**Any other gift**, same shape: name it, optionally add "for you" or "extra", stop.

```
{Yeti|Yeti for you}
{Topgolf|Topgolf on me}
```

## Follow up subjects

Follow ups may use the reply form, since by then there is a real prior email to reply to. Still two variants.

```
{re: AirPods|AirPods}
{re: {{Local_Sports_Team}} tix|{{Local_Sports_Team}} tix}
```

Never invent a new subject on a follow up. It stays the same gift, optionally with `re:`.

## Merge tag safety

If the subject carries a merge field, every lead in the campaign must have that field populated or the subject renders broken. Check the field before upload:

- `Local_Sports_Team` comes from the sports-team-assignment skill and must be present on every row.
- Literal gifts like AirPods need no field and cannot break, which is why they are the safer default when list hygiene is uncertain.

Never put `{{first_name}}` or `{{company_name}}` in a subject. Those belong in the body.

## Role-inbox lanes

Some lanes send to `info@` or `office@` with no named person. The subject rule does not change. The gift is still the subject, because a role inbox is even less tolerant of a curiosity hook than a person is.

## Spintax rules

Standard house spintax applies. Inline `{a|b}` only, no nesting, no dashes. Keep both variants naming the same gift... spinning across different offers makes reporting meaningless.

Casing warnings from the spintax checker on product names like AirPods are expected and correct. Do not lowercase a proper noun to silence them.

## Checklist before upload

1. Subject names the gift and nothing else
2. Exactly two variants, both the same gift
3. Under five words on the longest path
4. No first name or company merge tags
5. Any merge field used is populated on 100 percent of the list
6. Follow up reuses the same gift, `re:` optional
