const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat,
  PageBreak, VerticalAlign, HeightRule, LineRuleType
} = require('docx');
const fs = require('fs');

/* ---------- Brand palette, sampled from gosalesglider.com ---------- */
const GREEN  = "3C865B";   // brand green: logo "Glider", CTAs, key figures
const FOREST = "0E2E28";   // hero / deep forest
const INK    = "0F1A14";   // near-black text
const CREAM  = "EDE8DE";   // page cream
const PAPER  = "FAF8F5";   // off-white
const MUTED  = "6E7B74";
const RULE   = "D5CFC3";
const ONDARK = "9FB5AA";   // muted text on forest

const SERIF = "Playfair Display";
const SANS  = "Inter";
const W     = 9360;        // 6.5in content width
const PAGE_W = 12240, PAGE_H = 15840;

function t(text, o = {}) {
  return new TextRun({
    text,
    font: o.font || SANS,
    size: o.size || 21,
    bold: !!o.bold,
    italics: !!o.italics,
    color: o.color || INK,
    characterSpacing: o.spacing,
    allCaps: !!o.caps
  });
}

function p(content, o = {}) {
  return new Paragraph({
    spacing: { before: o.before || 0, after: o.after === undefined ? 140 : o.after,
               line: o.line || 288, lineRule: LineRuleType.AUTO },
    alignment: o.align || AlignmentType.LEFT,
    indent: o.indent,
    keepNext: !!o.keepNext,
    border: o.border,
    children: Array.isArray(content) ? content : [t(content, o)]
  });
}

/* ---------- Logo wordmark: "Sales" bold italic serif + "Glider" bold serif green ---------- */
function wordmark({ size = 30, onDark = false, sub = true, indent } = {}) {
  const out = [new Paragraph({
    spacing: { after: sub ? 20 : 0 },
    indent,
    children: [
      t("Sales", { font: SERIF, size, bold: true, italics: true, color: onDark ? PAPER : INK }),
      t("Glider", { font: SERIF, size, bold: true, color: GREEN })
    ]
  })];
  if (sub) {
    out.push(new Paragraph({
      spacing: { after: 0 },
      indent,
      children: [t("GROWTH PARTNERS", {
        size: Math.round(size * 0.42),
        bold: true,
        color: onDark ? ONDARK : MUTED,
        spacing: 120
      })]
    }));
  }
  return out;
}

/* ---------- Brand eyebrow: "// LABEL" in green, letterspaced ---------- */
function eyebrow(label, o = {}) {
  return new Paragraph({
    spacing: { before: o.before === undefined ? 220 : o.before, after: o.after === undefined ? 70 : o.after },
    keepNext: true,
    indent: o.indent,
    children: [
      t("//", { size: o.size || 16, bold: true, color: o.color || GREEN }),
      t("   ", { size: o.size || 16 }),
      t(label.toUpperCase(), { size: o.size || 16, bold: true, color: o.color || GREEN, spacing: 90 })
    ]
  });
}

/* ---------- Section heading: green number + bold sans title ---------- */
function section(num, title) {
  return new Paragraph({
    spacing: { before: 300, after: 130 },
    keepNext: true,
    border: { bottom: { color: GREEN, style: BorderStyle.SINGLE, size: 10, space: 7 } },
    children: [
      t(num, { font: SERIF, size: 34, bold: true, color: GREEN }),
      t("   ", { size: 26 }),
      t(title, { size: 27, bold: true, color: INK })
    ]
  });
}

function sub(title) {
  return new Paragraph({
    spacing: { before: 210, after: 65 },
    keepNext: true,
    children: [t(title, { size: 21, bold: true, color: INK })]
  });
}

function bullet(lead, rest) {
  const kids = [];
  if (lead) kids.push(t(lead, { size: 21, bold: true, color: INK }));
  kids.push(t(rest, { size: 21 }));
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
        children: [p(h, { size: 18, bold: true, color: PAPER, spacing: 30, after: 0 })]
      }))
    }));
  }
  rows.forEach((r, ri) => {
    const shade = ri % 2 === 1 ? CREAM : PAPER;
    trs.push(new TableRow({
      cantSplit: true,
      children: r.map((c, i) => cell(
        [p(c, { size: 19, after: 0,
                bold: (opts.boldFirst && i === 0),
                color: (opts.boldFirst && i === 0) ? INK : INK })],
        { width: widths[i], shade }))
    }));
  });
  return new Table({
    columnWidths: widths,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows: trs
  });
}

/* ---------- Accent callout with green left bar ---------- */
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
          ...lines.map((l, i) => p(l, { size: 21, after: i === lines.length - 1 ? 0 : 120 }))
        ]
      })]
    })]
  });
}

/* ---------- Stat strip ---------- */
function stats(items) {
  return new Table({
    columnWidths: items.map(() => Math.floor(W / items.length)),
    width: { size: W, type: WidthType.DXA },
    rows: [new TableRow({
      cantSplit: true,
      children: items.map(([big, small]) => cell([
        p(big, { font: SERIF, size: 30, bold: true, color: GREEN, align: AlignmentType.CENTER, after: 30 }),
        p(small, { size: 16, color: MUTED, align: AlignmentType.CENTER, after: 0 })
      ], { width: Math.floor(W / items.length), shade: CREAM, plain: true, pad: 150 }))
    })]
  });
}

const runHeader = new Header({
  children: [new Paragraph({
    spacing: { after: 0 },
    border: { bottom: { color: RULE, style: BorderStyle.SINGLE, size: 4, space: 5 } },
    tabStops: [{ type: "right", position: W }],
    children: [
      t("Sales", { font: SERIF, size: 16, bold: true, italics: true, color: INK }),
      t("Glider", { font: SERIF, size: 16, bold: true, color: GREEN }),
      t("   Executive Briefing", { size: 15, color: MUTED }),
      t("\t", { size: 14 }),
      t("United States Go-to-Market  ·  Dots", { size: 15, color: MUTED })
    ]
  })]
});

const runFooter = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      t("Confidential  ·  9 September 2026  ·  ", { size: 15, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 15, bold: true, color: GREEN }),
      t(" / ", { size: 15, color: MUTED }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 15, color: MUTED })
    ]
  })]
});

const blank = new Paragraph({ children: [], spacing: { after: 0 } });

/* =================== COVER (full-bleed forest) =================== */
const coverSection = {
  properties: {
    page: { size: { width: PAGE_W, height: PAGE_H },
            margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } }
  },
  children: [
    new Table({
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
            ...wordmark({ size: 34, onDark: true }),

            eyebrow("Executive Briefing", { before: 4300, after: 200, size: 17 }),

            p([t("United States", { size: 62, bold: true, color: PAPER })], { after: 60, line: 264 }),
            p([t("Go-to-Market", { size: 62, bold: true, color: PAPER })], { after: 220, line: 264 }),
            p([t("mirroring the model that already works.", {
                 font: SERIF, size: 40, italics: true, color: GREEN })], { after: 700 }),

            new Paragraph({
              spacing: { before: 1500, after: 300 },
              border: { bottom: { color: GREEN, style: BorderStyle.SINGLE, size: 12, space: 2 } },
              children: [t("", { size: 2 })]
            }),

            ...[
              ["Prepared for", "Avihai Hershkovitz, Dots"],
              ["Prepared by", "Joshua Osborn, SalesGlider Growth Partners"],
              ["Date", "9 September 2026"],
              ["Scope", "United States. Europe remains with Catalyst."],
              ["Decision required", "Approve a three-month engagement; confirm the ICP session"]
            ].map(([k, v]) => new Paragraph({
              spacing: { after: 110 },
              tabStops: [{ type: "left", position: 2700 }],
              children: [
                t(k, { size: 16, bold: true, color: GREEN, spacing: 40 }),
                t("\t", { size: 17 }),
                t(v, { size: 18, color: PAPER })
              ]
            })),

            p([t("Confidential  ·  gosalesglider.com", { size: 15, color: ONDARK })], { before: 1200, after: 0 })
          ]
        })]
      })]
    })
  ]
};

/* =================== BODY =================== */
const bodyChildren = [

  // ---------- 1 ----------
  section("1", "Recommendation"),
  p("Dots already has a working outbound engine in Europe. The US does not need a new one. It needs the same one, at scale, with the channel order reversed.", { after: 150 }),

  callout("Recommendation", [
    "Run the Catalyst model in the US: agency-executed, HubSpot as the system of record, all three channels live, Dots holding platform access. Then reverse the channel order. Email leads at 100,000 sends a month. LinkedIn runs at platform capacity against profiles we verify are active. The phone goes to your own BDR/SDR team, working the records email and LinkedIn cannot reach.",
    "The model does not change. The channel order does, because US IT buyers are reachable at scale on email and effectively unreachable by cold dial."
  ]),

  sub("Why now rather than after the raise"),
  p("Three months, $12,000 total, no renewal obligation. Against that, eighteen qualified meetings committed. If we miss, we keep working past the term at no cost until we hit it. Your exposure is capped both ways.", { after: 110 }),
  p("Timing is a separate argument. Sending domains need a full warmup cycle before they can carry traffic, and that cannot be compressed. Start now and you have live pipeline and a populated call list when the round closes and the new hires arrive. Start later and you have a kickoff call.", { after: 0 }),

  // ---------- 2 ----------
  section("2", "Situation"),
  tbl([2200, 7160], null, [
    ["Europe", "Working. Catalyst runs cold calling as the primary channel with dedicated SDRs, email and LinkedIn behind it, everything logged and closed in HubSpot."],
    ["United States", "Not started. Not a strategic decision. There has been no internal capacity to stand it up, and spending is held until the round closes."],
    ["Constraint", "Headcount is full until post-close hiring. Any US motion has to run on almost no internal time."],
    ["Open question", "Whether US IT decision makers respond to cold outreach at all, and on which channel. Sections 4 and 5."]
  ], { boldFirst: true }),

  new Paragraph({ children: [new PageBreak()] }),

  // ---------- 3 ----------
  section("3", "The European Model, Decomposed"),
  p("What is working in Europe, component by component. Most of it transfers unchanged.", { after: 150 }),

  tbl([2200, 7160], ["Component", "How it works today"], [
    ["Ownership", "External agency, not internal headcount. Dots buys an outcome, not a hiring plan."],
    ["Channel mix", "Cold calling is the primary producer, run by dedicated SDRs. Email and LinkedIn support it."],
    ["Tooling", "HeyReach for LinkedIn on an agency-held account, plus a second platform alongside it."],
    ["System of record", "HubSpot. SDRs dial through it, log activity, and open deals off qualified conversations."],
    ["Client visibility", "Avihai and the Director of IT hold platform seats. Nothing is a black box."],
    ["Qualification", "The agency qualifies on the call. A deal is created only once the prospect meets the bar."]
  ], { boldFirst: true }),

  p([t("Every one of those components carries over. ", { bold: true }),
     t("Only their weighting changes.", { font: SERIF, italics: true, size: 21, color: GREEN })],
    { before: 170, after: 0 }),

  // ---------- 4 ----------
  section("4", "Reordering the Channel Mix"),
  p("Cold calling works for Catalyst in Europe. It will not carry a US program as the primary channel. That is about the audience, not the channel or the execution.", { after: 150 }),

  sub("The evidence"),
  bullet("Connect rates. ", "Roughly one connect per hundred dials into US IT. Mobile screening, spam labeling and no-direct-dial policies all stack in this function."),
  bullet("Stated preference. ", "US IT buyers rank email first, LinkedIn second, phone last. As a first touch, the phone costs more than it returns."),
  bullet("Regulation. ", "GDPR limits what is possible in Europe. In the US, CAN-SPAM requires an honest sender and a working opt-out, and little else. Email is cheaper and more permissible here than there."),
  bullet("Throughput. ", "Five SDRs at a hundred dials a day produce about 11,000 touches a month. This program produces 100,000, roughly nine times that, with no hiring."),

  p("The phone is not removed. It moves from first touch to last coverage, worked by your own BDR/SDR team on the records email and LinkedIn cannot reach. Section 5 sets out the routing.", { before: 150, after: 150 }),

  eyebrow("Track record"),
  stats([["$25M", "closed for clients"],
         ["0.21–1.01%", "bounce rate on recent campaigns"],
         ["Under 5 min", "average speed to lead"],
         ["100,000", "sends per month at full rate"]]),

  // ---------- 5 ----------
  section("5", "Coverage Model: Three Lanes"),
  p("Each record goes to the channel that can actually reach the person. Nothing reachable is discarded because one channel missed it.", { after: 150 }),

  tbl([1450, 2450, 2730, 2730],
    ["Lane", "Routing rule", "Volume", "Owner"],
    [
      ["1. Email",
       "Verified, deliverable business email on file after a two-stage verification waterfall",
       "100,000 sends per month at full rate",
       "SalesGlider: sourcing, copy, sending, deliverability and reply handling"],
      ["2. LinkedIn",
       "Active LinkedIn profile, confirmed by our activity screen: a post, repost or quote post within the last 30 days",
       "200 per seat per week, the platform ceiling. Two seats, about 1,730 a month.",
       "SalesGlider, sending from a Dots-owned seat"],
      ["3. Telephone",
       "No verified email and no active LinkedIn presence, but a telephone number on file",
       "Delivered weekly as a call-ready list, approximately 2,000 records per month at full rate",
       "Dots' BDR/SDR team, the same function Catalyst's SDRs perform in Europe"]
    ], { boldFirst: true }),

  sub("Two points worth drawing out"),
  bullet("Lanes 1 and 2 overlap on purpose. ", "Anyone with both a verified email and an active profile gets both, multi-threaded rather than duplicated. Lane 3 is what is left over."),
  bullet("The activity screen exists because capacity is capped. ", "At 200 touches per seat per week, every touch spent on a dormant profile is a touch wasted. We screen for recent activity before a record is loaded."),

  p("Lane 3 is the closest mirror of Europe. You already have a working SDR calling motion. Nobody has been feeding it US records. This program does that as a by-product of the other two lanes, at no extra sourcing cost.", { before: 170, after: 0 }),

  new Paragraph({ children: [new PageBreak()] }),

  // ---------- 6 ----------
  section("6", "The US Program, Mapped Against Europe"),
  tbl([1850, 3755, 3755], ["Component", "Europe: Catalyst", "United States: SalesGlider + Dots"], [
    ["Ownership", "External agency, no internal headcount", "Same for lanes 1 and 2. Lane 3 worked in-house by Dots."],
    ["Primary channel", "SDR-led cold calling", "Cold email at 100,000 sends per month"],
    ["Second channel", "Email and LinkedIn", "LinkedIn across two seats at platform capacity, activity-verified profiles only"],
    ["Telephone", "Primary channel, agency SDRs", "Coverage channel, Dots' own BDR/SDR team, supplied weekly with call-ready records"],
    ["LinkedIn tooling", "HeyReach on an agency-held account", "HeyReach on a Dots-owned account. The connection graph stays yours."],
    ["System of record", "HubSpot", "Same. Replies, activity and deals land in your HubSpot."],
    ["Client visibility", "Avihai and Director of IT hold platform seats", "Same, plus written reviews at days 30, 60 and 90"],
    ["Qualification", "Agency qualifies before a deal is opened", "Same for lanes 1 and 2. Lane 3 qualification sits with your SDRs, as in Europe."],
    ["Territory", "Europe", "United States only. No shared list, no overlapping accounts, no channel conflict with Catalyst."]
  ], { boldFirst: true }),

  p("Suppression runs at account level against your HubSpot before any list loads. The two agencies never touch the same accounts.", { before: 160, size: 18, color: MUTED, italics: true, after: 0 }),

  new Paragraph({ children: [new PageBreak()] }),

  // ---------- 7 ----------
  section("7", "Operating Model and Governance"),
  tbl([2200, 7160], null, [
    ["Time required from Dots", "One 60-minute ICP session up front, then about 30 minutes a week for copy and list approval. Nothing sends without your sign-off."],
    ["Where the work sits", "Lanes 1 and 2 are entirely ours: infrastructure, sourcing, enrichment, verification, activity screening, copy, sending, deliverability, reply handling. Lane 3 execution is yours."],
    ["Where the data sits", "Your HubSpot. Nothing of consequence lives in a system Dots does not own."],
    ["Sending infrastructure", "280–320 mailboxes across 70–90 dedicated domains, in two pools on a two-week rotation. All separate from dotstech.com, so your primary domain reputation is never exposed to cold traffic."],
    ["Deliverability control", "Inbox placement held above 85%, tested before launch and monitored live. If it drops, sending pauses before pipeline suffers."],
    ["Lane 3 handover", "Records delivered weekly into HubSpot with firmographic context, so your SDRs are not dialing a bare name and number."],
    ["Reporting cadence", "Weekly performance summary; formal written review at days 30, 60 and 90."],
    ["Primary metric", "Interested replies: people who respond wanting to continue. We do not report raw reply rate, which counts out-of-offices and opt-outs as engagement."],
    ["Accountability", "Eighteen qualified meetings across the three-month term, from the email and LinkedIn lanes we execute. If we have not delivered eighteen by the end of the term, we keep working at no cost until we have."],
    ["Qualified meeting, defined", "A held meeting with a named person at an account matching the agreed ICP, who accepted and attended. Agreed in writing at the ICP session so the Section 9 commitment is unambiguous."],
    ["Required from Dots", "HubSpot access, two Dots-owned LinkedIn seats before day 31, and a named individual to take the meetings."]
  ], { boldFirst: true }),

  // ---------- 8 ----------
  section("8", "Ninety-Day Roadmap"),
  tbl([1500, 1900, 5960], ["Window", "Objective", "Deliverables"], [
    ["Days 1–30", "Build and launch",
     "Domains and mailboxes provisioned and warming. ICP session and written target definition. First 25,000 US records sourced, verified and routed into lanes. Sequence written and approved by you. Placement cleared above 85%. First sends day 21–25, about 15,000 by day 30. First lane 3 lists to your SDR team, about 800 records."],
    ["Days 31–60", "Scale and open LinkedIn",
     "Email at about 60,000 sends a month. LinkedIn live across two seats at 200 touches per seat per week against activity-verified profiles. Lane 3 delivered weekly, about 1,200 records. Two or three messaging angles tested head to head. First qualified meetings booked. Written review at day 60."],
    ["Days 61–90", "Full rate and concentration",
     "Email at 100,000 sends a month. LinkedIn at capacity on both seats. Lane 3 at about 2,000 records a month. Effort concentrated on the winning segment. Recommendation on additional LinkedIn seats. Twelve-month scaling plan sized to your post-close headcount."]
  ], { boldFirst: true }),

  new Paragraph({ children: [new PageBreak()] }),

  sub("Planning basis"),
  p("Each lane is modeled separately, on published industry-standard rates rather than our own numbers. Every assumption is shown so you can challenge it. These are models. The commitment is at the end of this section and in Section 9.", { after: 170 }),

  eyebrow("Lane 1: Email", { before: 60 }),
  tbl([3060, 3150, 3150], ["Step", "Assumption", "Across the 90-day term"], [
    ["Sends", "≈15,000 in month one after warmup, 60,000 in month two, 100,000 in month three", "≈ 175,000"],
    ["Interested replies", "1 per 2,000 sends, the published industry standard for a strong B2B campaign", "≈ 88"],
    ["Meetings booked", "20% of interested replies", "≈ 18"]
  ], { boldFirst: true }),

  eyebrow("Lane 2: LinkedIn, two seats"),
  tbl([3060, 3150, 3150], ["Step", "Assumption", "Across the 90-day term"], [
    ["Connection requests", "200 per seat per week across two seats, the platform ceiling. Live from day 31, so two months of the term.", "≈ 3,430"],
    ["Connections accepted", "12% acceptance, against activity-verified profiles only", "≈ 411"],
    ["Replies", "20% of accepted connections", "≈ 82"],
    ["Interested replies", "About one third of all replies", "≈ 27"],
    ["Meetings booked", "20% of interested replies", "≈ 5"]
  ], { boldFirst: true }),
  p("Two seats is the assumption throughout. A third seat adds roughly two more meetings across the term. The constraint is seats, not audience.", { before: 110, size: 18, color: MUTED, italics: true, after: 0 }),

  new Paragraph({ children: [new PageBreak()] }),

  eyebrow("Lane 3: Telephone, worked by Dots' BDR/SDR team", { before: 0 }),
  p("Included so your team can size its own contribution. We supply the records. The dialing, and the outcome, is yours. Figures assume one attempt per record; a second and third scale the lane proportionally.", { after: 150 }),
  tbl([3060, 3150, 3150], ["Step", "Assumption", "Across the 90-day term"], [
    ["Call-ready records delivered", "≈800 in month one, 1,200 in month two, 2,000 in month three, delivered weekly", "≈ 4,000"],
    ["Connected conversations", "1 in 100, the standard US IT pickup rate", "≈ 40"],
    ["Meetings booked", "20% of connected conversations", "≈ 8"]
  ], { boldFirst: true }),

  sub("What this adds up to"),
  tbl([4200, 2580, 2580], ["Lane", "Owner", "Modeled meetings, 90 days"], [
    ["1. Email", "SalesGlider", "≈ 18"],
    ["2. LinkedIn (two seats)", "SalesGlider", "≈ 5"],
    ["3. Telephone", "Dots' BDR/SDR team", "≈ 8"],
    ["Total across all three lanes", "Combined", "≈ 31"],
    ["Committed under Section 9", "SalesGlider, lanes 1 and 2 only", "18"]
  ], { boldFirst: true }),

  p("Every rate above is an accepted industry benchmark, not a number of ours. The eighteen-meeting commitment covers the two lanes we execute, which model about twenty-three across the term. If the benchmarks hold we clear it. If they do not, we keep working past the term until we do. Lane 3 scales with your team's dialing and sits outside the commitment. Any material variance is reported at day 30, unprompted.", { before: 170, size: 18, color: MUTED, italics: true, after: 0 }),

  new Paragraph({ children: [new PageBreak()] }),

  // ---------- 9 ----------
  section("9", "Commercial Terms"),
  tbl([2200, 7160], null, [
    ["Term", "Three months from launch. No renewal obligation and no long-term contract."],
    ["Fee", "$4,000 per month. $12,000 across the term."],
    ["Inclusive of", "Infrastructure, domains, mailboxes, data, enrichment, verification, LinkedIn activity screening, tooling, copy, sending, deliverability management and reply handling. No separate line items and no pass-through costs."],
    ["Commitment", "Eighteen qualified meetings within the three-month term, from the lanes we execute (email and LinkedIn). If we have not delivered eighteen by the end of the term, we keep working at no cost until we have. Meetings your SDR team books from lane 3 are additional and do not count against this figure."],
    ["Qualified meeting", "A held meeting with a named person at an account matching the agreed ICP, who accepted and attended. Defined in writing at the ICP session."],
    ["Cost per committed meeting", "$667 at the committed number, and lower if the program runs ahead of it."],
    ["Comparison", "One in-house SDR costs $75,000–$110,000 a year loaded, about $19,000–$27,500 a quarter, before tooling and data. They produce roughly a ninth of the touch volume and commit to nothing."]
  ], { boldFirst: true }),

  // ---------- 10 ----------
  section("10", "Decision Required"),
  callout("Two decisions", [
    "1.   Approve the three-month engagement at $4,000 per month, against the eighteen-meeting commitment set out in Section 9.",
    "2.   Confirm the 60-minute ICP working session, and the two LinkedIn seats Dots will provision before day 31."
  ]),
  p("The ICP session comes before any sending. After it you get the written target definition, the list criteria, and a sample of the actual people the campaign would reach, including the lane 3 records your SDR team would receive. The audience is agreed before the first email leaves.", { before: 160, after: 300 }),

  new Paragraph({
    spacing: { before: 120, after: 60 },
    border: { top: { color: GREEN, style: BorderStyle.SINGLE, size: 10, space: 10 } },
    children: [t("Joshua Osborn", { size: 21, bold: true, color: INK })]
  }),
  p([t("Sales", { font: SERIF, size: 17, bold: true, italics: true, color: INK }),
     t("Glider", { font: SERIF, size: 17, bold: true, color: GREEN }),
     t("  Growth Partners  ·  gosalesglider.com", { size: 16, color: MUTED })],
    { after: 0 })
];

const doc = new Document({
  creator: "Joshua Osborn, SalesGlider Growth Partners",
  title: "Executive Briefing: United States Go-to-Market for Dots",
  description: "SalesGlider Growth Partners executive briefing prepared for Dots",
  styles: { default: { document: { run: { font: SANS, size: 21, color: INK } } } },
  numbering: {
    config: [{
      reference: "sg",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "\u2013", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 210 } }, run: { color: GREEN, font: SANS, bold: true } }
      }]
    }]
  },
  sections: [
    coverSection,
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: 1180, bottom: 950, left: 1440, right: 1440, header: 640, footer: 500 },
          pageNumbers: { start: 2 }
        }
      },
      headers: { default: runHeader },
      footers: { default: runFooter },
      children: bodyChildren
    }
  ]
});

Packer.toBuffer(doc).then(b => {
  fs.writeFileSync('/home/claude/Dots_US_Executive_Briefing.docx', b);
  console.log('written');
});
