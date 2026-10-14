/* =============================================================
   SalesGlider Growth Partners — docx brand toolkit
   Palette sampled directly from gosalesglider.com. Do not guess
   these values; they were wrong twice before they were measured.

   Usage:
     const B = require('./brand');
     const doc = B.buildDocument({ cover: {...}, body: [...] });
   ============================================================= */

const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat,
  PageBreak, VerticalAlign, HeightRule, LineRuleType
} = require('docx');

/* ---------- Palette ---------- */
const GREEN  = "3C865B";  // brand green: logo "Glider", CTAs, key figures, rules
const FOREST = "0E2E28";  // deep forest: cover field, table headers
const INK    = "0F1A14";  // near-black body text
const CREAM  = "EDE8DE";  // page cream: alternating rows, callout fill
const PAPER  = "FAF8F5";  // off-white: text on forest, alternating rows
const MUTED  = "6E7B74";  // secondary text
const RULE   = "D5CFC3";  // hairlines
const ONDARK = "9FB5AA";  // secondary text on forest

/* ---------- Type ---------- */
const SERIF = "Playfair Display";  // display, logo, numerals, italic accents
const SANS  = "Inter";             // everything else

/* Sizes are docx half-points. 21 = 10.5pt. */
const SZ = {
  body: 21, table: 19, tableHead: 18, sub: 21,
  sectionTitle: 27, sectionNum: 34,
  eyebrow: 16, note: 18, small: 16, runner: 15,
  coverTitle: 62, coverAccent: 40, coverEyebrow: 17, wordmark: 34
};

const PAGE_W = 12240, PAGE_H = 15840;   // US Letter, DXA
const W = 9360;                          // 6.5in content width

/* =============================================================
   CRITICAL: always pass lineRule with line.
   A bare w:line="288" is read as a FIXED line height, which
   clamps large text and makes headlines overlap each other.
   Every paragraph below sets LineRuleType.AUTO for this reason.
   ============================================================= */

function t(text, o = {}) {
  return new TextRun({
    text,
    font: o.font || SANS,
    size: o.size || SZ.body,
    bold: !!o.bold,
    italics: !!o.italics,
    color: o.color || INK,
    characterSpacing: o.spacing
  });
}

function p(content, o = {}) {
  return new Paragraph({
    spacing: {
      before: o.before || 0,
      after: o.after === undefined ? 140 : o.after,
      line: o.line || 288,
      lineRule: LineRuleType.AUTO
    },
    alignment: o.align || AlignmentType.LEFT,
    indent: o.indent,
    keepNext: !!o.keepNext,
    children: Array.isArray(content) ? content : [t(content, o)]
  });
}

/* ---------- Logo wordmark (live text, not an image) ----------
   "Sales" bold italic serif + "Glider" bold serif in brand green,
   with letterspaced GROWTH PARTNERS beneath. There is no logo
   image file; the website renders it as text too.              */
function wordmark({ size = SZ.wordmark, onDark = false, sub = true, indent } = {}) {
  const out = [new Paragraph({
    spacing: { after: sub ? 20 : 0, line: 288, lineRule: LineRuleType.AUTO },
    indent,
    children: [
      t("Sales",  { font: SERIF, size, bold: true, italics: true, color: onDark ? PAPER : INK }),
      t("Glider", { font: SERIF, size, bold: true, color: GREEN })
    ]
  })];
  if (sub) {
    out.push(new Paragraph({
      spacing: { after: 0, line: 288, lineRule: LineRuleType.AUTO },
      indent,
      children: [t("GROWTH PARTNERS", {
        size: Math.round(size * 0.42), bold: true,
        color: onDark ? ONDARK : MUTED, spacing: 120
      })]
    }));
  }
  return out;
}

/* ---------- "//" eyebrow, the site's signature label device ----------
   Keep the slashes tight and letterspace only the label; applying
   characterSpacing to "//" splits the two slashes apart.          */
function eyebrow(label, o = {}) {
  const size = o.size || SZ.eyebrow;
  return new Paragraph({
    spacing: {
      before: o.before === undefined ? 220 : o.before,
      after: o.after === undefined ? 70 : o.after,
      line: 288, lineRule: LineRuleType.AUTO
    },
    keepNext: true,
    children: [
      t("//", { size, bold: true, color: o.color || GREEN }),
      t("   ", { size }),
      t(label.toUpperCase(), { size, bold: true, color: o.color || GREEN, spacing: 90 })
    ]
  });
}

/* ---------- Numbered section heading with green rule ---------- */
function section(num, title) {
  return new Paragraph({
    spacing: { before: 300, after: 130, line: 288, lineRule: LineRuleType.AUTO },
    keepNext: true,
    border: { bottom: { color: GREEN, style: BorderStyle.SINGLE, size: 10, space: 7 } },
    children: [
      t(String(num), { font: SERIF, size: SZ.sectionNum, bold: true, color: GREEN }),
      t("   ", { size: SZ.sectionNum }),
      t(title, { size: SZ.sectionTitle, bold: true, color: INK })
    ]
  });
}

function sub(title) {
  return new Paragraph({
    spacing: { before: 210, after: 65, line: 288, lineRule: LineRuleType.AUTO },
    keepNext: true,
    children: [t(title, { size: SZ.sub, bold: true, color: INK })]
  });
}

function bullet(lead, rest) {
  const kids = [];
  if (lead) kids.push(t(lead, { bold: true, color: INK }));
  kids.push(t(rest));
  return new Paragraph({
    numbering: { reference: "sg", level: 0 },
    spacing: { after: 90, line: 288, lineRule: LineRuleType.AUTO },
    children: kids
  });
}

function cell(paras, o = {}) {
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
    margins: { top: o.pad || 115, bottom: o.pad || 115, left: 150, right: 150 },
    verticalAlign: o.valign || VerticalAlign.TOP,
    borders: o.plain ? {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }
    } : {
      top:    { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left:   { style: BorderStyle.NONE },
      right:  { style: BorderStyle.NONE }
    },
    children: paras
  });
}

/* ---------- Standard table: forest header, cream/paper alternating ----------
   headers may be null for a plain label/value table.
   opts.boldFirst bolds the first column (label column).          */
function tbl(widths, headers, rows, opts = {}) {
  const trs = [];
  if (headers) {
    trs.push(new TableRow({
      tableHeader: true,
      children: headers.map((h, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: FOREST, color: "auto" },
        margins: { top: 115, bottom: 115, left: 150, right: 150 },
        borders: {
          top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }
        },
        children: [p(h, { size: SZ.tableHead, bold: true, color: PAPER, spacing: 30, after: 0 })]
      }))
    }));
  }
  rows.forEach((r, ri) => {
    const shade = ri % 2 === 1 ? CREAM : PAPER;
    trs.push(new TableRow({
      cantSplit: true,                        // never break a row across pages
      children: r.map((c, i) => cell(
        [p(c, { size: SZ.table, after: 0, bold: (opts.boldFirst && i === 0) })],
        { width: widths[i], shade }))
    }));
  });
  return new Table({
    columnWidths: widths,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows: trs
  });
}

/* ---------- Callout: cream block with a green left bar ---------- */
function callout(label, lines) {
  return new Table({
    columnWidths: [W],
    width: { size: W, type: WidthType.DXA },
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        width: { size: W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: CREAM, color: "auto" },
        margins: { top: 190, bottom: 190, left: 240, right: 240 },
        borders: {
          top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          left: { style: BorderStyle.SINGLE, size: 22, color: GREEN }
        },
        children: [
          eyebrow(label, { before: 0, after: 100 }),
          ...lines.map((l, i) => p(l, { size: SZ.body, after: i === lines.length - 1 ? 0 : 120 }))
        ]
      })]
    })]
  });
}

/* ---------- Stat strip: [["$25M","closed for clients"], ...] ---------- */
function stats(items) {
  const w = Math.floor(W / items.length);
  return new Table({
    columnWidths: items.map(() => w),
    width: { size: W, type: WidthType.DXA },
    rows: [new TableRow({
      cantSplit: true,
      children: items.map(([big, small]) => cell([
        p(big,   { font: SERIF, size: 30, bold: true, color: GREEN, align: AlignmentType.CENTER, after: 30 }),
        p(small, { size: SZ.small, color: MUTED, align: AlignmentType.CENTER, after: 0 })
      ], { width: w, shade: CREAM, plain: true, pad: 150 }))
    })]
  });
}

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

/* ---------- Running header / footer ---------- */
function runningHeader(docLabel, rightLabel) {
  return new Header({
    children: [new Paragraph({
      spacing: { after: 0, line: 288, lineRule: LineRuleType.AUTO },
      border: { bottom: { color: RULE, style: BorderStyle.SINGLE, size: 4, space: 5 } },
      tabStops: [{ type: "right", position: W }],
      children: [
        t("Sales",  { font: SERIF, size: 16, bold: true, italics: true, color: INK }),
        t("Glider", { font: SERIF, size: 16, bold: true, color: GREEN }),
        t("   " + docLabel, { size: SZ.runner, color: MUTED }),
        t("\t", { size: SZ.runner }),
        t(rightLabel, { size: SZ.runner, color: MUTED })
      ]
    })]
  });
}

function runningFooter(leftLabel) {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { line: 288, lineRule: LineRuleType.AUTO },
      children: [
        t(leftLabel + "  ·  ", { size: 15, color: MUTED }),
        new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 15, bold: true, color: GREEN }),
        t(" / ", { size: 15, color: MUTED }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 15, color: MUTED })
      ]
    })]
  });
}

/* ---------- Full-bleed forest cover ----------
   Its own section with zero margins; a single fixed-height cell
   supplies the field. Anything past the cell height is clipped,
   so keep the vertical rhythm inside the budget below.
   cover = { eyebrow, titleLines:[], accent, meta:[[k,v]], footNote } */
function coverSection(cover) {
  return {
    properties: {
      page: { size: { width: PAGE_W, height: PAGE_H },
              margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } }
    },
    children: [new Table({
      columnWidths: [PAGE_W],
      width: { size: PAGE_W, type: WidthType.DXA },
      rows: [new TableRow({
        height: { value: PAGE_H, rule: HeightRule.EXACT },
        children: [new TableCell({
          width: { size: PAGE_W, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: FOREST, color: "auto" },
          margins: { top: 1500, bottom: 1100, left: 1440, right: 1440 },
          borders: {
            top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }
          },
          children: [
            ...wordmark({ onDark: true }),
            eyebrow(cover.eyebrow, { before: 4300, after: 200, size: SZ.coverEyebrow }),
            ...cover.titleLines.map((line, i) => p(
              [t(line, { size: SZ.coverTitle, bold: true, color: PAPER })],
              { after: i === cover.titleLines.length - 1 ? 220 : 60, line: 264 })),
            p([t(cover.accent, { font: SERIF, size: SZ.coverAccent, italics: true, color: GREEN })], { after: 0 }),
            new Paragraph({
              spacing: { before: 1500, after: 300, line: 288, lineRule: LineRuleType.AUTO },
              border: { bottom: { color: GREEN, style: BorderStyle.SINGLE, size: 12, space: 2 } },
              children: [t("", { size: 2 })]
            }),
            ...cover.meta.map(([k, v]) => new Paragraph({
              spacing: { after: 110, line: 288, lineRule: LineRuleType.AUTO },
              tabStops: [{ type: "left", position: 2700 }],
              children: [
                t(k, { size: SZ.small, bold: true, color: GREEN, spacing: 40 }),
                t("\t", { size: 17 }),
                t(v, { size: SZ.note, color: PAPER })
              ]
            })),
            p([t(cover.footNote || "Confidential  ·  gosalesglider.com", { size: 15, color: ONDARK })],
              { before: 1200, after: 0 })
          ]
        })]
      })]
    })]
  };
}

/* ---------- Assemble ---------- */
function buildDocument({ cover, body, meta = {} }) {
  return new Document({
    creator: meta.creator || "Joshua Osborn, SalesGlider Growth Partners",
    title: meta.title || "SalesGlider Growth Partners",
    description: meta.description || "SalesGlider Growth Partners document",
    styles: { default: { document: { run: { font: SANS, size: SZ.body, color: INK } } } },
    numbering: {
      config: [{
        reference: "sg",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2013", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 210 } },
                   run: { color: GREEN, font: SANS, bold: true } }
        }]
      }]
    },
    sections: [
      coverSection(cover),
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: 1180, bottom: 950, left: 1440, right: 1440, header: 640, footer: 500 },
            pageNumbers: { start: 2 }
          }
        },
        headers: { default: runningHeader(meta.headerLeft || "Executive Briefing",
                                          meta.headerRight || "") },
        footers: { default: runningFooter(meta.footer || "Confidential") },
        children: body
      }
    ]
  });
}

async function write(doc, path) {
  const fs = require('fs');
  fs.writeFileSync(path, await Packer.toBuffer(doc));
  return path;
}

module.exports = {
  GREEN, FOREST, INK, CREAM, PAPER, MUTED, RULE, ONDARK,
  SERIF, SANS, SZ, W, PAGE_W, PAGE_H,
  t, p, wordmark, eyebrow, section, sub, bullet, cell, tbl, callout, stats,
  pageBreak, runningHeader, runningFooter, coverSection, buildDocument, write,
  AlignmentType, BorderStyle, Paragraph, TextRun, PageBreak
};
