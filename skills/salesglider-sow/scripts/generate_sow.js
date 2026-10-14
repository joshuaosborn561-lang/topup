/**
 * SalesGlider Growth Partners SOW Generator
 *
 * Usage: node generate_sow.js <path-to-config.json> <output-path.docx>
 *
 * See ../references/config-schema.md for the full config format.
 */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, BorderStyle } = require('docx');

const TITLE_SIZE = 28; // 14pt
const HEADING_SIZE = 24; // 12pt
const BODY_SIZE = 22; // 11pt
const FONT = "Arial";
const LINE_SPACING = 276; // 1.15

function heading(num, text) {
  return new Paragraph({
    spacing: { before: 300, after: 120, line: LINE_SPACING },
    children: [new TextRun({ text: `${num}. ${text}`, bold: true, size: HEADING_SIZE, font: FONT })]
  });
}
function sub(num, text) {
  return new Paragraph({
    spacing: { before: 200, after: 80, line: LINE_SPACING },
    children: [new TextRun({ text: `${num} ${text}`, bold: true, size: BODY_SIZE, font: FONT })]
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before || 80, after: opts.after || 80, line: LINE_SPACING },
    indent: opts.indent ? { left: 360 } : undefined,
    children: [new TextRun({ text, size: BODY_SIZE, font: FONT, bold: opts.bold || false })]
  });
}
function pm(runs, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before || 80, after: opts.after || 80, line: LINE_SPACING },
    indent: opts.indent ? { left: 360 } : undefined,
    children: runs.map(r => new TextRun({ size: BODY_SIZE, font: FONT, ...r }))
  });
}
function bullet(text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { before: 40, after: 40, line: LINE_SPACING },
    children: [new TextRun({ text, size: BODY_SIZE, font: FONT })]
  });
}
function bulletBold(label, text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { before: 40, after: 40, line: LINE_SPACING },
    children: [
      new TextRun({ text: label, bold: true, size: BODY_SIZE, font: FONT }),
      new TextRun({ text, size: BODY_SIZE, font: FONT })
    ]
  });
}
function letterItem(text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { before: 40, after: 40, line: LINE_SPACING },
    children: [new TextRun({ text, size: BODY_SIZE, font: FONT })]
  });
}
function categoryLabel(text) {
  return pm([{ text, bold: true }], { before: 160 });
}
function sigLine(label) {
  return [
    new Paragraph({ spacing: { before: 400, after: 0 }, children: [] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000", space: 1 } },
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: " ", size: BODY_SIZE, font: FONT })]
    }),
    p(label, { before: 0 })
  ];
}
function money(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---- Numbering config: generate enough bullet + letter references ----
function buildNumbering(maxBulletGroups) {
  const config = [];
  for (let i = 1; i <= maxBulletGroups; i++) {
    config.push({
      reference: `b${i}`,
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
    });
  }
  config.push({
    reference: "letters",
    levels: [{ level: 0, format: LevelFormat.LOWER_LETTER, text: "%1)", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
  });
  return config;
}

// ---- Main builder ----
function buildSow(cfg) {
  const sp = cfg.serviceProvider || { name: "JMO Solutions LLC", location: "Dallas, Texas" };
  const client = cfg.client;
  const fees = cfg.fees;
  const term = cfg.term;
  const children = [];

  // TITLE BLOCK
  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80, line: LINE_SPACING },
      children: [new TextRun({ text: cfg.title || "SalesGlider Growth Partners Agreement (Standalone)", bold: true, size: TITLE_SIZE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80, line: LINE_SPACING },
      children: [new TextRun({ text: client.displayName, bold: true, size: HEADING_SIZE, font: FONT })] })
  );
  if (cfg.subtitle) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80, line: LINE_SPACING },
      children: [new TextRun({ text: cfg.subtitle, bold: true, size: HEADING_SIZE, font: FONT })] }));
  }
  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line: LINE_SPACING },
      children: [new TextRun({ text: `Effective Date: ${cfg.effectiveDate || "_______________"}`, size: BODY_SIZE, font: FONT })] }),
    p(`This ${cfg.title || "SalesGlider Growth Partners Agreement"} (the \u201CAgreement\u201D) is entered into by and between:`),
    pm([{ text: `1. ${sp.name}`, bold: true }, { text: `, ${sp.location} (\u201CService Provider\u201D), and` }], { indent: true }),
    pm([{ text: `2. ${client.legalName}`, bold: true }, { text: ` (\u201CClient\u201D)${client.primaryContact ? `. Primary contact: ${client.primaryContact}.` : "."}` }], { indent: true }),
    p("Each may be referred to as a \u201CParty,\u201D and together as the \u201CParties.\u201D", { before: 120 })
  );

  // 1. SERVICES
  let bulletGroupCounter = 0;
  const nextBulletRef = () => `b${++bulletGroupCounter}`;

  children.push(heading("1", "Services"));
  let subIdx = 1;
  children.push(sub(`1.${subIdx++}`, "Program Overview."), p(cfg.programOverview));

  if (cfg.includedServices && cfg.includedServices.length) {
    children.push(sub(`1.${subIdx++}`, "Included Services."), p(cfg.includedServicesIntro || "The fee includes the following services:"));
    for (const category of cfg.includedServices) {
      children.push(categoryLabel(category.label));
      const ref = nextBulletRef();
      for (const item of category.items) children.push(bullet(item, ref));
    }
  }

  for (const extra of (cfg.extraServiceSubsections || [])) {
    children.push(sub(`1.${subIdx++}`, extra.title));
    if (Array.isArray(extra.body)) {
      for (const line of extra.body) children.push(p(line));
    } else {
      children.push(p(extra.body));
    }
    if (extra.bullets) {
      const ref = nextBulletRef();
      for (const item of extra.bullets) children.push(bullet(item, ref));
    }
  }

  children.push(sub(`1.${subIdx++}`, "No Guarantee of Sales."), p(cfg.noGuaranteeText ||
    "Service Provider does not guarantee closed-won revenue, a specific number of leads, or any return on investment. Client\u2019s results depend on market receptivity, offer strength, and Client\u2019s follow-up execution."));

  if (cfg.meetingGuarantee) {
    children.push(sub(`1.${subIdx++}`, "Meeting Guarantee."), p(cfg.meetingGuarantee));
  }
  if (cfg.meetingCap) {
    children.push(sub(`1.${subIdx++}`, "Meeting Cap."), p(cfg.meetingCap));
  }

  // 2. SERVICES NOT INCLUDED
  if (cfg.excludedServices && cfg.excludedServices.length) {
    children.push(heading("2", "Services Not Included"));
    children.push(p("The following services are expressly excluded from this Agreement unless added by separate written amendment:"));
    const ref = nextBulletRef();
    for (const item of cfg.excludedServices) children.push(bullet(item, ref));
  }

  // 3. ICP
  children.push(heading("3", "Ideal Customer Profile (ICP) and Target Market"));
  children.push(sub("3.1", "ICP."), p(cfg.icpIntro || "The initial ICP parameters for this engagement are:"));
  const icpRef = nextBulletRef();
  for (const item of (cfg.icpBullets || [])) children.push(bullet(item, icpRef));
  if (cfg.icpNote) children.push(p(cfg.icpNote));

  // 4. TERM
  children.push(heading("4", "Term; Termination"));
  children.push(sub("4.1", "Term."), p(term.termText));
  children.push(sub("4.2", "Cancellation."), p(term.cancellationText ||
    "Either Party may cancel this Agreement by providing thirty (30) days\u2019 written notice. If a Party fails to provide a full thirty (30) days\u2019 written notice, the succeeding thirty (30) days will be billed in full as a cancellation fee. If a full thirty (30) days\u2019 notice is provided, no cancellation fee applies."));
  if (term.postTermText) children.push(sub("4.3", "Post-Term Options."), p(term.postTermText));

  // 5. FEES
  children.push(heading("5", "Fees and Payment"));
  let feeIdx = 1;
  children.push(sub(`5.${feeIdx++}`, fees.feeLabel || "Fees."), p(fees.feeText));
  if (fees.perMeetingFee) {
    children.push(sub(`5.${feeIdx++}`, fees.perMeetingFee.label || "Per-Meeting Fee."), p(fees.perMeetingFee.text));
  } else {
    children.push(sub(`5.${feeIdx++}`, "No Per-Lead or Per-Meeting Fees."), p(fees.noPerLeadText ||
      "There are no additional per-lead or per-meeting fees. The fee described above is the sole compensation for all services described in this Agreement."));
  }
  children.push(sub(`5.${feeIdx++}`, "Payment Method (Stripe)."), p("All fees will be paid through Stripe via credit card (CC) or ACH."));
  children.push(sub(`5.${feeIdx++}`, "Billing Timing."), p(fees.billingTimingText || "Fees are billed in advance."));
  if (fees.includeGracePeriod !== false) {
    children.push(sub(`5.${feeIdx++}`, "Failed Payments; Grace Period; Pause."), p(fees.gracePeriodText ||
      "If a payment fails, Client has a three (3) business day grace period to cure. If not cured within that period, Service Provider may pause all services until all past-due amounts are paid. Pausing does not change the Term or eliminate amounts owed."));
  }

  // 6. CLIENT RESPONSIBILITIES
  children.push(heading("6", "Client Responsibilities"));
  let crIdx = 1;
  for (const item of (cfg.clientResponsibilities || [])) {
    children.push(sub(`6.${crIdx++}`, item.title), p(item.text));
  }

  // 7. CONFIDENTIALITY
  children.push(heading("7", "Confidentiality"));
  children.push(p("Each Party will keep confidential and not disclose the other Party\u2019s non-public business, technical, and commercial information obtained in connection with this Agreement, and will use it only to perform under this Agreement. This obligation does not apply to information that is publicly available through no fault of the receiving Party, independently developed, or rightfully received from a third party."));
  if (cfg.ndaClause) {
    children.push(sub("7.1", "Non-Disclosure Agreement."), p(cfg.ndaClause));
  }

  // 8. IP
  children.push(heading("8", "Intellectual Property (IP) and Asset Ownership"));
  let ipIdx = 1;
  if (cfg.websiteOwnershipClause) {
    children.push(sub(`8.${ipIdx++}`, "Website Ownership."), p(cfg.websiteOwnershipClause));
  }
  children.push(sub(`8.${ipIdx++}`, "Ownership During Term."), p("During the Term, Service Provider owns the revenue systems assets it creates, including messaging frameworks, sequences, templates, lead lists, and targeting materials."));
  children.push(sub(`8.${ipIdx++}`, "Transfer Upon Termination."), p("Upon expiration or termination of this Agreement (and subject to all amounts due being paid), Service Provider will transfer to Client all campaign data, lead lists, and assets created specifically for Client\u2019s engagement, in a reasonable format, excluding Service Provider\u2019s pre-existing materials, internal tools, and general know-how."));

  // 9. DATA PRIVACY
  children.push(heading("9", "Data Privacy and Compliance"));
  children.push(sub("9.1", "Compliance."), p(cfg.complianceText ||
    "Each Party will comply with applicable laws and regulations relating to the Services, including CAN-SPAM and similar outreach laws. All cold email campaigns will use burner domains to protect Client\u2019s primary domain deliverability."));
  children.push(sub("9.2", "No Legal Advice."), p("Service Provider does not provide legal advice on Client\u2019s specific compliance obligations. Client is responsible for ensuring its offers, claims, and any required disclosures are compliant."));
  if (cfg.extraComplianceClause) {
    children.push(sub("9.3", cfg.extraComplianceClause.title), p(cfg.extraComplianceClause.text));
  }

  // 10. INDEMNITY
  children.push(heading("10", "Indemnity; Limitation of Liability"));
  children.push(sub("10.1", "Mutual Indemnity."), p("Each Party (\u201CIndemnifying Party\u201D) will indemnify, defend, and hold harmless the other Party and its officers, members, managers, employees, and agents from third-party claims, damages, and reasonable costs (including attorneys\u2019 fees) arising out of (a) the Indemnifying Party\u2019s gross negligence or willful misconduct, or (b) the Indemnifying Party\u2019s material breach of this Agreement."));
  children.push(sub("10.2", "Limitation of Liability."), p(`Except for (a) payment obligations, (b) confidentiality breaches, or (c) a Party\u2019s gross negligence or willful misconduct, each Party\u2019s total liability arising out of or relating to this Agreement will not exceed ${money(cfg.liabilityCap)} USD ${cfg.liabilityCapNote || "(equal to the total fees under this Agreement)"}.`));

  // 11. DISPUTES
  children.push(heading("11", "Dispute Resolution; Governing Law; Venue"));
  children.push(sub("11.1", "Mediation First."), p("The Parties will first attempt to resolve any dispute through good-faith negotiation and then mediation administered by a mutually agreed mediator in Dallas, Texas (or remotely if the Parties agree)."));
  children.push(sub("11.2", "Litigation; Venue."), p("If not resolved by mediation, either Party may pursue litigation. The Parties agree to exclusive venue in state or federal courts located in Dallas County, Texas."));
  children.push(sub("11.3", "Governing Law."), p("This Agreement is governed by the laws of the State of Texas, without regard to conflict-of-law principles."));

  // 12. FORCE MAJEURE
  children.push(heading("12", "Force Majeure"));
  children.push(p("Neither Party will be liable for delays or failures to perform due to events beyond its reasonable control (e.g., acts of God, war, terrorism, labor disputes, network outages, platform policy changes, or governmental actions), provided the affected Party gives prompt notice and resumes performance as soon as reasonably practicable."));

  // 13. SEVERABILITY
  children.push(heading("13", "Severability"));
  children.push(p("If any provision of this Agreement is held unenforceable, the remaining provisions will remain in full force and effect, and the unenforceable provision will be modified to the minimum extent necessary to make it enforceable."));

  // 14. ENTIRE AGREEMENT
  children.push(heading("14", "Entire Agreement; Amendments"));
  children.push(sub("14.1", "Entire Agreement."), p("This Agreement constitutes the entire agreement between the Parties regarding its subject matter and supersedes all prior or contemporaneous discussions or writings relating to the Services described here."));
  children.push(sub("14.2", "Written Amendments."), p("Any amendment or modification must be in writing and signed by both Parties."));

  // 15. SIGNATURES
  children.push(heading("15", "Signatures"));
  children.push(new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }));
  children.push(pm([{ text: sp.name, bold: true }, { text: " (Service Provider)" }]));
  children.push(p(sp.location));
  children.push(...sigLine(sp.signerName || "Joshua Osborn, Founder"));
  children.push(...sigLine("Date"));

  children.push(new Paragraph({ spacing: { before: 500, after: 0 }, children: [] }));
  children.push(pm([{ text: client.legalName, bold: true }, { text: " (Client)" }]));
  children.push(...sigLine(client.signerName || client.primaryContact || "Name / Title"));
  children.push(...sigLine("Date"));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    numbering: { config: buildNumbering(bulletGroupCounter + 2) },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children
    }]
  });

  return doc;
}

// ---- CLI entry point ----
if (require.main === module) {
  const [,, configPath, outputPath] = process.argv;
  if (!configPath || !outputPath) {
    console.error("Usage: node generate_sow.js <config.json> <output.docx>");
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  const doc = buildSow(cfg);
  Packer.toBuffer(doc).then(buffer => {
    fs.writeFileSync(path.resolve(outputPath), buffer);
    console.log(`SOW written to ${outputPath}`);
  });
}

module.exports = { buildSow };
