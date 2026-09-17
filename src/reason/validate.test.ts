import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Exclusion } from "./exclusions.js";
import { collidingExclusion } from "./exclusions.js";
import type { Proposal } from "./proposal.js";
import { parseProposal } from "./proposal.js";
import { validateProposal } from "./validate.js";

const goliathCsuite: Exclusion = {
  id: "ex-csuite",
  client_tag: "goliath",
  lane: null,
  kind: "persona",
  value: "csuite",
  reason: "Dave rejected C suite, IT DM only",
  decided_on: "2026-08-01",
  decided_by: "josh",
  active: true,
};

const goliathItManager: Exclusion = {
  id: "ex-itm",
  client_tag: "goliath",
  lane: null,
  kind: "title_pattern",
  value: "IT Manager",
  reason: "excluded every band",
  decided_on: "2026-08-18",
  decided_by: "josh",
  active: true,
};

const parlayCto: Exclusion = {
  id: "ex-cto",
  client_tag: "parlay",
  lane: null,
  kind: "title",
  value: "CTO",
  reason: "Parlay IT DM list does not include CTO",
  decided_on: "2026-08-01",
  decided_by: "josh",
  active: true,
};

function base(over: Partial<Proposal> = {}): Proposal {
  const parsed = parseProposal({
    lane: "parlay/it_dm_tickets",
    basis_receipt_ids: ["11111111-1111-1111-1111-111111111111"],
    basis_verdicts: { "11111111-1111-1111-1111-111111111111": "unknown" },
    action: "repeat",
    segment: {
      icp_kind: "linkedin_native",
      company_source: "getleads",
      company_filters: { job_titles: ["CIO", "IT Director"], company_size: ["11 to 50", "51 to 200", "201 to 500"] },
      domain_source: "already",
      person_source: "getleads",
      email_source: "getleads",
      email_max_tier: "leadmagic",
      band: ["11 to 50"],
      mail_class: [],
      gift: null,
      offer_key: [],
    },
    diff_from_basis: [],
    counts: { pool: 400, already_in_client: 10, suppressed: 20, projected_net_new: 370, projected_verified: 300, expected_interested_per_2000: 1.2 },
    cost: { worst_case_usd: 0, by_step: { getleads: 0 } },
    widening_options: [{ label: "201 to 500", company_filters: { company_size: ["201 to 500"] }, pool: 80, net_new: 60, cost_usd: 0 }],
    pilot_required: false,
    confidence: "medium",
    reasons: ["repeat the Sept 9 receipt after a getleads recount"],
    flags: ["backfill only basis"],
    count_call_id: "getleads_count:1",
    ...over,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.proposal;
}

describe("D39 proposal validation", () => {
  it("rejects integer bands", () => {
    const r = parseProposal({
      ...base(),
      segment: { ...base().segment, company_filters: { job_titles: ["CIO"], company_size: [201] } },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /band|integer/i);
  });

  it("rejects a banned vendor anywhere in the plan", () => {
    const v = validateProposal(
      { ...base(), reasons: ["use hunter then getleads"] },
      { clientTag: "parlay", lane: "it_dm_tickets", exclusions: [], countCalls: [{ id: "getleads_count:1", kind: "getleads_count", filters: {}, total: 400 }] },
    );
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.match(v.message, /banned/i);
  });

  it("rejects an invented pool with no count call", () => {
    const v = validateProposal(base(), { clientTag: "parlay", lane: "it_dm_tickets", exclusions: [], countCalls: [] });
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.match(v.message, /count call/i);
  });

  it("rejects CTO against the Parlay exclusion and cites the row", () => {
    const p = base({
      segment: { ...base().segment, company_filters: { job_titles: ["CIO", "CTO"], company_size: ["11 to 50"] } },
    });
    const v = validateProposal(p, {
      clientTag: "parlay",
      lane: "it_dm_tickets",
      exclusions: [parlayCto],
      countCalls: [{ id: "getleads_count:1", kind: "getleads_count", filters: {}, total: 400 }],
    });
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.exclusion_id, "ex-cto");
    assert.match(v.message, /CTO/);
  });

  it("the Goliath C-suite exclusion is the test history cannot do", () => {
    const ceo = base({
      lane: "goliath/education_it_dm",
      segment: {
        ...base().segment,
        company_filters: { job_titles: ["CEO"], company_size: ["51 to 200"] },
      },
    });
    const open = validateProposal(ceo, {
      clientTag: "goliath",
      lane: "education_it_dm",
      exclusions: [],
      countCalls: [{ id: "getleads_count:1", kind: "getleads_count", filters: {}, total: 400 }],
      persona: "csuite",
    });
    assert.equal(open.ok, true, "without the exclusion row the reasoner may propose CEO");

    const blocked = validateProposal(ceo, {
      clientTag: "goliath",
      lane: "education_it_dm",
      exclusions: [goliathCsuite],
      countCalls: [{ id: "getleads_count:1", kind: "getleads_count", filters: {}, total: 400 }],
      persona: "csuite",
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.exclusion_id, "ex-csuite");
  });

  it("rejects IT Manager on Goliath via title_pattern", () => {
    const p = base({
      lane: "goliath/healthcare_it_dm",
      segment: { ...base().segment, company_filters: { job_titles: ["IT Manager"], company_size: ["51 to 200"] } },
    });
    assert.ok(collidingExclusion(p.segment, "goliath", "healthcare_it_dm", [goliathItManager]));
  });

  it("forces a pilot on physical and new_segment", () => {
    const r = parseProposal({
      ...base(),
      action: "new_segment",
      pilot_required: false,
      segment: { ...base().segment, icp_kind: "physical" },
    });
    assert.equal(r.ok, false);
  });
});
