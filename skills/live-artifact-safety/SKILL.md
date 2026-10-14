---
name: live-artifact-safety
description: Never destroy work Josh is doing inside an interactive artifact. Use this whenever an HTML deck, editable document, canvas, or any artifact Josh has been editing needs a change, and whenever Josh reports a bug in one, asks to add a section, cut a variant, or says "I can't edit X". Also use before any rebuild, regenerate, or re-present of a file Josh already has open. Encodes the export-first protocol and the build rules that stop the bug-patch-rebuild loop that cost him a full editing session on the Cornerstone Earthworks copy deck, Sept 2026.
---

# Live artifact safety

## The rule

**Never regenerate an artifact Josh is editing.**

His edits live in browser state. Claude cannot read them. Re-presenting the file resets it to the built-in defaults and the work is gone with no undo.

This holds even when the storage key is unchanged, even when field ids match, even when the change looks additive. Do not reason your way past it. If the artifact is live and the edits are not in hand, it does not get rebuilt.

## What "live" means

Any artifact Josh has opened and worked in since it was handed over. Assume live unless he has just said he is done with it, or he has pasted the exported content back.

## The protocol when a change is needed

1. **Ask for the export first.** "Hit Copy all (or Download) and paste it back, then I'll patch it." One sentence, then stop.
2. **Wait.** Do not rebuild speculatively while waiting. Do not hand back "a version to try in the meantime."
3. **Patch from his exported version**, not from the original seed data.
4. **Hand back a new file** and say plainly what changed.

If he says to go ahead without exporting, say once that his edits will be lost, then do it.

## What Josh pasting the HTML back does NOT give you

Pasting the artifact source shows the **defaults baked into the file**, not his edits. The two look identical on the page and are completely different data. Reading the pasted `LANES` array and concluding "these are his edits" is wrong. Only the Copy all / Download output carries his changes.

## Build rules that prevent the loop

The session that produced this skill burned five rebuilds on one deck. Each rebuild was an attempt to fix a bug the previous rebuild introduced. The specific causes:

**Never make a field conditionally read-only.** A guard like `if(MODE!=='x') return;` in an input handler silently swallows keystrokes. It looks like a dead UI with no error. That single line survived three rebuilds and was the actual cause of "I can't edit this."

**Never derive one editable view from another.** If there are two versions of the copy, build two independent sets of plain textareas. Derived or generated views always end up needing to be edited, and then the derivation fights the edits.

**Test the function, not the wiring.** Confirming a button fires and the markup exists proves nothing. Execute the transform and print its output. A doubled escape (`\\{` instead of `\{`) made a swap match nothing while every other check passed.

**Keep validators merge-tag aware.** `{{Local_Sports_Team}}` inside a spin group like `{{{Local_Sports_Team}} tix|...}` breaks naive brace stripping and gets flagged as unbalanced. Strip merge tags to a placeholder character, never to empty string.

## Before handing any artifact over

- Every editable field is a plain textarea, always writable
- No mode, toggle, or state can make a field read-only
- Syntax checked with `node --check`
- Every transform function executed against real input, output printed and read
- All content validated: word counts, path counts, brace errors

Get it right once. The cost of a rebuild is not your time, it is his work.
