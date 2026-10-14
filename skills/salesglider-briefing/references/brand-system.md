# SalesGlider Growth Partners — brand system

Everything here was sampled from the live site, not guessed. Two earlier
attempts used plausible-looking greens and creams that were all wrong.
Do not substitute approximations.

## Palette

| Token | Hex | Use |
|---|---|---|
| Brand green | `#3C865B` | Logo "Glider", eyebrows, section numbers, rules, key figures, page numbers |
| Deep forest | `#0E2E28` | Cover field, table header rows |
| Ink | `#0F1A14` | Body text, section titles |
| Cream | `#EDE8DE` | Alternating table rows, callout fill, stat strip |
| Paper | `#FAF8F5` | Text on forest, alternating table rows |
| Muted | `#6E7B74` | Secondary text, footnotes, running header/footer |
| Rule | `#D5CFC3` | Hairlines between table rows |
| On-dark muted | `#9FB5AA` | Secondary text on the forest cover |

## Type

- **Playfair Display** — display serif. Logo, section numbers, stat figures, italic accent phrases.
- **Inter** — sans. Everything else: body, headings, tables, running head/foot.

Both are on npm as `@fontsource/playfair-display` and `@fontsource/inter`, but
ship only `.woff`/`.woff2`. See `scripts/setup_fonts.sh` — converting them to
TTF and installing locally is what makes the PDF preview truthful. Without it
LibreOffice substitutes and every layout check you do is against the wrong font.

Sizes are docx half-points (21 = 10.5pt):

| Element | Size |
|---|---|
| Body | 21 |
| Table body | 19 |
| Table header | 18 |
| Sub-heading | 21 |
| Section title | 27 |
| Section number (serif) | 34 |
| Eyebrow | 16 |
| Footnote / italic note | 18 |
| Running header & footer | 15 |
| Cover title | 62 |
| Cover accent (serif italic) | 40 |

Body below 21 reads cramped in a document an executive has to work through.
9.5pt was tried and rejected.

## The logo

**There is no logo image file.** The site renders the mark as live text, and so
should any document. Checked and confirmed absent from: all nine Supabase
storage buckets, the site nav, the site footer (the icon there is LinkedIn),
and both gosalesglider.com and salesglidergrowth.com.

Construction:

- `Sales` — Playfair Display, **bold italic**, ink on light / paper on dark
- `Glider` — Playfair Display, **bold roman**, brand green
- `GROWTH PARTNERS` — Inter bold, ~42% of the wordmark size, letterspaced 120, muted

`brand.js` exposes this as `wordmark({ size, onDark, sub })`.

If Josh ever supplies an airplane/glider mark, place it above the wordmark on
the cover and inline in the running header, and note it here.

## Signature devices

Take these from the site rather than inventing new ones.

1. **`//` eyebrow.** Green, uppercase, letterspaced, prefixed with two slashes:
   `// EXECUTIVE BRIEFING`. Keep the slashes tight — letterspacing applied to
   `//` visibly splits them. Put the spacing on the label only.

2. **Bold sans headline with an italic serif line under it.** The hero does
   exactly this: a bold Inter statement followed by a Playfair italic phrase in
   green. Used on the cover, and sparingly in the body for emphasis lines.

3. **Cream and paper alternating table rows**, forest header row, hairline
   rules top and bottom only — no vertical borders.

4. **Callout with a green left bar** on a cream field, opened by a `//` eyebrow.

5. **Stat strip.** Serif green figures over small muted labels, on cream, no
   borders. Three or four tiles.

## Page setup

- US Letter, `12240 × 15840` DXA. Content width `9360` (6.5in).
- Body margins: top 1180, bottom 950, sides 1440, header 640, footer 500.
- Cover is **its own section with zero margins**, holding one fixed-height
  (`HeightRule.EXACT`) forest cell. Content past that height is clipped, so
  budget the vertical rhythm.
- Body section restarts page numbering at 2 so the cover is unnumbered.
- Running header: wordmark, document label, right-aligned subject.
- Running footer: right-aligned, page number in green.
