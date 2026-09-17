import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inventoryCovers } from "./inventory.js";
import type { LanePicture } from "./picture.js";
import { proposeLane } from "./propose.js";
import { reasonTools } from "./tools.js";
import type { CountCall } from "./validate.js";

function picture(over: Partial<LanePicture> = {}): LanePicture {
  return {
    client_tag: "parlay",
    lane: "it_dm_tickets",
    receipts: [
      {
        receipt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        written_by: "claude_backfill",
        supabase_project: "azpapwtnrbzywlnxxecz",
        client_tag: "parlay",
        smartlead_client_id: 418274,
        lane: "it_dm_tickets",
        campaign_ids: [3847839, 3847846],
        icp_kind: "linkedin_native",
        persona: "it_dm",
        company_source: "getleads",
        company_filters: { job_titles: ["CIO", "IT Director"], company_size: ["11 to 50", "51 to 200"] },
        domain_source: "already",
        person_source: "getleads",
        email_source: "getleads",
        email_max_tier: "leadmagic",
        rows_found: null,
        rows_imported: null,
        tam_count: null,
        how_i_did_it: "Sept 9 getleads count then export on IT DM titles for the ticket lane.",
        notes: "BACKFILL Sept 12. Josh to confirm.",
        segment: null,
        yield_by_step: { verified_sendable: 800, imported: 800 },
        spend_cents: 0,
        suppression_scope: "response_based_v1",
        build_label: null,
        granularity: "lane",
        owner_confirmed_at: null,
        josh_confirmed: false,
        basis_receipt_ids: [],
      },
    ],
    outcomes: [
      {
        receipt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sends: 900,
        interested: 1,
        bounces: 10,
        bounce_rate: 0.011,
        interested_per_2000: 2.2,
        variant_repeat: false,
        verdict: "unknown",
        josh_confirmed: false,
      },
    ],
    runway: [{ campaign_id: 3847839, name: "tickets", status: "ACTIVE", leads_total: 100, untouched: 10, sends_7d: 70, daily_send_rate: 10, days_remaining: 1 }],
    exclusions: [
      {
        id: "ex-cto",
        client_tag: "parlay",
        lane: null,
        kind: "title",
        value: "CTO",
        reason: "Parlay IT DM list does not include CTO",
        decided_on: "2026-08-01",
        decided_by: "josh",
        active: true,
      },
    ],
    inventory: [],
    prose: { merged_list: "Parlay IT DMs. Bands 11 to 50, 51 to 200, 201 to 500.", servers: "", client_skill: "", source_skills: [] },
    ...over,
  };
}

describe("D39 dry-mode replays", () => {
  it("Parlay it_dm_tickets: fixture reasoner repeats, recounts, widens 201-500, flags backfill", async () => {
    const calls: CountCall[] = [];
    const tools = reasonTools({
      sql: async () => ({ rows: 0, note: "0" }),
      getleads: async () => ({ total_matching: 1200 }),
      calls,
    });
    const result = await proposeLane(picture(), {
      target: 200,
      tools,
      calls,
      reasoner: async () => {
        const counted = await tools.getleads_count({
          job_titles: ["CIO", "IT Director"],
          company_size: ["11 to 50", "51 to 200"],
        });
        return {
          lane: "parlay/it_dm_tickets",
          basis_receipt_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
          basis_verdicts: { "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": "unknown" },
          action: "repeat",
          segment: {
            icp_kind: "linkedin_native",
            company_source: "getleads",
            company_filters: { job_titles: ["CIO", "IT Director"], company_size: ["11 to 50", "51 to 200"] },
            domain_source: "already",
            person_source: "getleads",
            email_source: "getleads",
            email_max_tier: "leadmagic",
          },
          counts: { pool: counted.total_matching, already_in_client: 100, suppressed: 50, projected_net_new: 1050, projected_verified: 800, expected_interested_per_2000: 2.2 },
          cost: { worst_case_usd: 0, by_step: { getleads: 0 } },
          widening_options: [{ label: "201 to 500", company_filters: { company_size: ["201 to 500"] }, pool: 90, net_new: 80, cost_usd: 0 }],
          pilot_required: false,
          confidence: "medium",
          reasons: ["repeat the Sept 9 receipt after getleads recount call " + counted.call_id],
          flags: ["backfill only basis"],
          count_call_id: counted.call_id,
        };
      },
    });
    assert.equal(result.kind, "proposal");
    if (result.kind !== "proposal") return;
    assert.equal(result.proposal.action, "repeat");
    assert.equal(result.proposal.counts.pool, 1200);
    assert.ok(result.proposal.widening_options.some((w) => w.label.includes("201")));
    assert.ok(result.proposal.flags.some((f) => /backfill/i.test(f)));
    assert.equal(result.skipped_llm, false);
  });

  it("Parlay: CTO is rejected by the exclusion layer and the run holds", async () => {
    const calls: CountCall[] = [];
    const tools = reasonTools({ sql: async () => ({ rows: 0, note: "0" }), getleads: async () => ({ total_matching: 10 }), calls });
    const result = await proposeLane(picture(), {
      target: 200,
      tools,
      calls,
      reasoner: async () => ({
        lane: "parlay/it_dm_tickets",
        action: "repeat",
        segment: {
          icp_kind: "linkedin_native",
          company_source: "getleads",
          company_filters: { job_titles: ["CTO"], company_size: ["11 to 50"] },
          domain_source: "already",
          person_source: "getleads",
          email_source: "getleads",
        },
        counts: { pool: 10, already_in_client: 0, suppressed: 0, projected_net_new: 10, projected_verified: 8, expected_interested_per_2000: null },
        cost: { worst_case_usd: 0, by_step: {} },
        pilot_required: false,
        confidence: "low",
        reasons: ["CTO"],
        count_call_id: "getleads_count:1",
      }),
    });
    assert.equal(result.kind, "hold");
    if (result.kind !== "hold") return;
    assert.match(result.message, /CTO|exclusion/i);
  });

  it("Peterson C1: inventory short-circuits before the reasoner", async () => {
    const called = { n: 0 };
    const pic = picture({
      client_tag: "peterson",
      lane: "c1_general_contractors",
      inventory: [{ source_table: "gc.contacts", n: 4683, note: "verified GC contacts not in this lane's campaigns" }],
      receipts: [
        {
          ...picture().receipts[0]!,
          client_tag: "peterson",
          lane: "c1_general_contractors",
          icp_kind: "physical",
          persona: "gc_owner_pm",
          company_source: "maps_and_permits",
          campaign_ids: [3798227, 3798228],
        },
      ],
    });
    const calls: CountCall[] = [];
    const result = await proposeLane(pic, {
      target: 200,
      tools: reasonTools({ sql: async () => ({ rows: 0, note: "0" }), calls }),
      calls,
      reasoner: async () => {
        called.n += 1;
        throw new Error("reasoner must not run");
      },
    });
    assert.equal(called.n, 0);
    assert.equal(result.kind, "proposal");
    if (result.kind !== "proposal") return;
    assert.equal(result.skipped_llm, true);
    assert.equal(result.proposal.action, "repeat");
    assert.ok(result.proposal.flags.includes("basis=inventory"));
    assert.equal(result.proposal.counts.pool, 4683);
    assert.equal(result.proposal.pilot_required, true);
    assert.equal(result.proposal.cost.worst_case_usd, 0);
  });

  it("Insight it_dm_by_offer: bounce_rate is display-only; 2500 sends at 1.6/2k repeats", async () => {
    const calls: CountCall[] = [];
    const tools = reasonTools({ sql: async () => ({ rows: 0, note: "0" }), getleads: async () => ({ total_matching: 50 }), calls });
    const pic = picture({
      client_tag: "insight",
      lane: "it_dm_by_offer",
      outcomes: [
        {
          receipt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          sends: 2500,
          interested: 2,
          bounces: 600,
          bounce_rate: 0.24,
          interested_per_2000: 1.6,
          variant_repeat: false,
          verdict: "repeat",
          josh_confirmed: false,
        },
      ],
      receipts: [
        {
          ...picture().receipts[0]!,
          client_tag: "insight",
          lane: "it_dm_by_offer",
          notes: "Gateway catch alls bounced 23%.",
        },
      ],
    });
    assert.equal(pic.outcomes[0]!.bounce_rate, 0.24);
    assert.equal(pic.outcomes[0]!.verdict, "repeat");
    const result = await proposeLane(pic, {
      target: 200,
      tools,
      calls,
      reasoner: async () => ({
        lane: "insight/it_dm_by_offer",
        basis_receipt_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
        basis_verdicts: { "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": "repeat" },
        action: "repeat",
        segment: {
          icp_kind: "linkedin_native",
          company_source: "getleads",
          company_filters: { job_titles: ["IT Director"], company_size: ["201 to 500"] },
          domain_source: "already",
          person_source: "getleads",
          email_source: "getleads",
        },
        counts: { pool: 50, already_in_client: 0, suppressed: 0, projected_net_new: 50, projected_verified: 40, expected_interested_per_2000: 1.6 },
        cost: { worst_case_usd: 0, by_step: {} },
        flags: ["notes: Gateway catch alls bounced 23%."],
        pilot_required: false,
        confidence: "medium",
        reasons: ["repeat: 2500 sends, 1.6 interested per 2000; bounce_rate is not a verdict"],
        count_call_id: "getleads_count:1",
      }),
    });
    assert.equal(result.kind, "proposal");
    if (result.kind !== "proposal") return;
    assert.equal(result.proposal.action, "repeat");
    assert.equal(result.proposal.basis_verdicts["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"], "repeat");
  });

  it("avoid is 2000+ sends with zero interested, even when bounce_rate is low", async () => {
    const calls: CountCall[] = [];
    const tools = reasonTools({ sql: async () => ({ rows: 0, note: "0" }), getleads: async () => ({ total_matching: 10 }), calls });
    const pic = picture({
      client_tag: "insight",
      lane: "it_dm_by_offer",
      outcomes: [
        {
          receipt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          sends: 2200,
          interested: 0,
          bounces: 10,
          bounce_rate: 0.004,
          interested_per_2000: 0,
          variant_repeat: false,
          verdict: "avoid",
          josh_confirmed: false,
        },
      ],
    });
    const result = await proposeLane(pic, {
      target: 200,
      tools,
      calls,
      reasoner: async () => ({
        lane: "insight/it_dm_by_offer",
        basis_receipt_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
        basis_verdicts: { "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": "avoid" },
        action: "hold",
        segment: {
          icp_kind: "linkedin_native",
          company_source: "getleads",
          company_filters: { job_titles: ["IT Director"], company_size: ["201 to 500"] },
          domain_source: "already",
          person_source: "getleads",
          email_source: "getleads",
        },
        counts: { pool: 0, already_in_client: 0, suppressed: 0, projected_net_new: 0, projected_verified: 0, expected_interested_per_2000: null },
        cost: { worst_case_usd: 0, by_step: {} },
        pilot_required: false,
        confidence: "high",
        reasons: ["every basis is avoid: 2200 sends, 0 interested"],
        flags: ["avoid on zero interested"],
        count_call_id: null,
      }),
    });
    assert.equal(result.kind, "proposal");
    if (result.kind !== "proposal") return;
    assert.equal(result.proposal.action, "hold");
    assert.match(result.proposal.reasons.join(" "), /0 interested|zero interested/i);
  });

  it("inventoryCovers is the SQL path that keeps the LLM off the critical path", () => {
    const miss = inventoryCovers([{ source_table: "gc.contacts", n: 10, note: "x" }], 200);
    assert.equal(miss.enough, false);
    const hit = inventoryCovers([{ source_table: "gc.contacts", n: 4683, note: "never loaded" }], 200);
    assert.equal(hit.enough, true);
    if (hit.enough) assert.equal(hit.source_table, "gc.contacts");
  });
});
