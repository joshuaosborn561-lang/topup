---
name: salesglider-unsubscribe
description: Generate the mandatory spun reply-based opt-out PS block that ends every SalesGlider Growth cold email, for any client and any vertical. Use whenever Josh asks for the opt-out, the unsubscribe line, the PS block, or asks to check whether copy has one, and automatically on every sequence build before upload. Encodes the reply-not-link rule, the 64-variant spin structure, the exemption from the 90-word ceiling, and the Smartlead settings that must pair with it.
---

# SalesGlider opt-out PS

## The rule

Every email in every campaign ends with a conversational, reply-based opt-out. E1, every bump,
every lane, every client. There is no email short enough to skip it and no campaign exempt
from it.

## The block

Three spin points, four options each, 64 rendered variants:

```
PS- {if this isn't for you|if I've got this wrong|if this misses|if now's not the time}, {say the word|one word|just say so|reply no} and {I'll close the file|you won't hear from me again|I'll stop here|that's the last you'll see of me}.
```

## On gift campaigns

The E1 PS carries the reversal restate first, then the opt-out, as a single PS. Two separate
PS lines look like a form.

```
PS- {the tickets come either way|they're yours either way}, just for hearing us out. {if this isn't for you|if I've got this wrong|if this misses|if now's not the time}, {say the word|one word|just say so|reply no} and {I'll close the file|you won't hear from me again|I'll stop here|that's the last you'll see of me}.
```

Swap `tickets` for whatever the gift is. The bump uses the bare opt-out with no restate.

## Why reply-based and not a link

A one-click unsubscribe link on a cold send is a deliverability liability and reads corporate.
A reply costs the recipient the same effort, gives us a signal we can route, and keeps the
email looking like one person wrote to another. Never insert a link, never insert a footer,
never use Smartlead's built-in unsubscribe text.

## Rules that travel with it

- The opt-out block does **not** count toward the 90-word longest-path ceiling. Everything
  else in the email does. Run the spintax validator with the block in place and read the
  count with it excluded.
- `unsubscribe_text` stays empty string in Smartlead campaign settings. The PS is the
  mechanism. Setting both double-serves the opt-out.
- Never reduce the variant count to save words. The spin volume is the deliverability point.
- Anyone who replies asking out goes to the suppression list. See the `global-suppression`
  skill for where that lands and what scope it applies at.

## Checklist

1. Every step in the sequence has a PS opt-out, including the last one
2. Three spin points, four options each, no nesting
3. No dash punctuation anywhere in the block
4. Gift campaigns fuse restate and opt-out into one PS on E1 only
5. `unsubscribe_text` is empty in campaign settings
6. Longest path under 90 words excluding this block
