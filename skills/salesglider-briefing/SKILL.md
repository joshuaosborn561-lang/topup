---
name: salesglider-briefing
description: Build client-facing SalesGlider Growth Partners documents — executive briefings, proposals, pitch decks, one-pagers, QBRs, and any deliverable a prospect or client will actually read — as branded .docx plus a font-embedded .pdf. Use this whenever Josh asks for a proposal, briefing, exec summary, deck, presentation, one-pager, or "something to send" to a prospect, client, or partner, and whenever he asks to restyle, rebrand, tighten, or fix the formatting of an existing one. Also use when he says it should "look professional", "not look like it came from Claude", asks where his logo is, or asks to apply his branding. Encodes the sampled brand palette, the Playfair/Inter type system, the wordmark, the house voice, the no-em-dash and American-spelling rules, and the docx pitfalls that silently break layout. Always use this instead of hand-writing document code, because the palette, the line-spacing bug, and the cover construction were all learned the hard way.
---

# SalesGlider client document builder

Produces branded, executive-grade documents for SalesGlider Growth Partners
(JMO Solutions LLC). Read `references/brand-system.md` and
`references/voice-and-language.md` before writing any content. They are short.

## Workflow

### 1. Set up fonts first

```bash
bash scripts/setup_fonts.sh
```

Do this before rendering anything. Playfair Display and Inter are not installed
by default, and without them every preview you inspect is a substituted font.
Layout problems will hide from you.

### 2. Gather the substance before touching layout

Pull real source material rather than inventing it:

- **Fireflies** for meeting history. `fireflies_search` with `keyword:"<name>"`,
  or `fireflies_get_transcripts` filtered by participant email. Read the actual
  transcripts, not just the summaries. Direct quotes of what the client said
  their objection is are the strongest material in the document.
- **The website** for current positioning, proof figures, and pricing.
  `gosalesglider.com` and `salesglidergrowth.com` are the same site.
- **Memory** for pricing, proof assets, and deliverability standards.

If a fact is contradicted between sources (site says one price, Josh says
another), use Josh's and flag the conflict to him.

### 3. Write the content, then build

Draft the argument first in plain text. Apply
`references/voice-and-language.md`. Only then write the generator.

```js
const B = require('./scripts/brand');

const doc = B.buildDocument({
  meta: {
    title: "Executive Briefing: <subject>",
    headerLeft: "Executive Briefing",
    headerRight: "<subject>  ·  <client>",
    footer: "Confidential  ·  <date>"
  },
  cover: {
    eyebrow: "Executive Briefing",
    titleLines: ["United States", "Go-to-Market"],
    accent: "mirroring the model that already works.",
    meta: [["Prepared for", "..."], ["Prepared by", "..."], ["Date", "..."],
           ["Scope", "..."], ["Decision required", "..."]]
  },
  body: [
    B.section("1", "Recommendation"),
    B.p("..."),
    B.callout("Recommendation", ["...", "..."]),
    B.sub("Why now"),
    B.bullet("Lead in. ", "rest of the point"),
    B.tbl([2200, 7160], null, [["Label", "Value"]], { boldFirst: true }),
    B.stats([["$25M", "closed for clients"], ["100,000", "sends per month"]]),
    B.pageBreak()
  ]
});
B.write(doc, '/home/claude/out.docx');
```

### 4. Render and actually look at it

```bash
python /mnt/skills/public/docx/scripts/office/soffice.py --headless --convert-to pdf out.docx
pdftoppm -r 95 -jpeg out.pdf pg
```

Then `view` the pages. Rendering without looking has missed a title where every
line overlapped.

### 5. Run the checks

```bash
python3 -c "
import subprocess
t=subprocess.run(['pdftotext','out.pdf','-'],capture_output=True,text=True).stdout
print('em dashes:', t.count('\u2014'))
brit=[w for w in ['programme','Programme','dialling','modelled','Modelled','labelling','deprioritised'] if w in t]
print('British spellings:', brit or 'none')
print('words:', len(t.split()))
"
# every page should start with a heading, not a table continuation
for i in $(seq 1 20); do printf '%2d: ' $i; pdftotext -f $i -l $i out.pdf - 2>/dev/null | sed -n '3,5p' | tr '\n' ' ' | cut -c1-55; echo; done
```

A page beginning with a bare column header means a table split. Fix it in step 6.

### 6. Balance pagination last

Strip every forced page break, render, see where tables naturally split, then
add breaks back **only** before the tables that split. Adding breaks
speculatively leaves half-empty pages; this order does not.

### 7. Ship both formats

Write `.docx` and `.pdf` to `/mnt/user-data/outputs` and present both. The PDF
embeds the fonts, so the client sees the real design whether or not they have
Playfair and Inter installed. Set document `creator` to Josh.

## Pitfalls that will bite you

- **`line` without `lineRule` is read as a fixed line height.** Bare
  `w:line="288"` clamps every paragraph to 14.4pt, so a 31pt cover title prints
  on top of the line above it. `brand.js` always passes `LineRuleType.AUTO`.
  If you write spacing by hand, do the same.
- **The cover cell is `HeightRule.EXACT`.** Content past the page height is
  silently clipped, not reflowed. Budget the vertical rhythm.
- **Letterspacing on `//` splits the slashes.** Put `characterSpacing` on the
  label only.
- **Grep for British spellings case-insensitively.** `Programme` in a heading
  survived a lowercase grep.
- **`ShadingType.CLEAR`, never `SOLID`** — SOLID renders black.
- **Tables need `columnWidths` on the table and `width` on every cell**, both
  in DXA, summing to the table width.
- **There is no logo image file.** The wordmark is live text. Do not go hunting
  for a PNG and do not invent a mark; see `references/brand-system.md`.

## Files

- `scripts/brand.js` — the toolkit. Palette, type scale, wordmark, eyebrow,
  section, sub, bullet, tbl, callout, stats, cover, header/footer, buildDocument.
- `scripts/setup_fonts.sh` — installs Playfair Display and Inter.
- `references/brand-system.md` — palette, type, logo, devices, page setup.
- `references/voice-and-language.md` — house voice, hard rules, modeling
  standards, section shape.
