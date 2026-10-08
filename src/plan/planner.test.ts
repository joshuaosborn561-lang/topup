import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GetleadsFilters } from "../clients/getleads.js";
import { Overlap } from "../lib/concurrency.js";
import { parseRecipe } from "../recipes/schema.js";
import { NO_CACHE, type PoolCacheHit, type PoolCacheReader } from "./cache.js";
import { planSize, type PlannerDeps } from "./planner.js";
import { VendorCallLog } from "./vendorLog.js";

const HEALTH = ["Hospitals and Health Care"];
const TRUCKS = ["Truck Transportation"];

function recipe() {
  return parseRecipe({
    recipe_id: "acme.it_dm.v1",
    client_tag: "acme",
    lane: "it_dm",
    smartlead_client_id: 77,
    supabase_project: "azpapwtnrbzywlnxxecz",
    source: {
      kind: "getleads",
      params: { job_titles: ["CIO", "IT Director"], company_size: ["51 to 200"], countries: ["United States"], industries: HEALTH },
    },
    suppression: { response_based: true, same_offer_any_client: true },
    email_finding: { enabled: false },
    verify: { seg_split: true },
    normalize: {},
    segments: { slot: ["11", "12", "13", "15", "4085158"] },
    routing: [
      { when: { slot: "11" }, campaign_id: 11, icp: { kind: "linkedin_native", persona: "it_dm" } },
      { when: { slot: "12" }, campaign_id: 12, icp: { kind: "linkedin_native", persona: "it_dm" } },
      {
        when: { slot: "13" },
        campaign_id: 13,
        icp: { kind: "linkedin_native", persona: "it_dm" },
        source: { kind: "getleads", params: { job_titles: ["CIO", "IT Director"], company_size: ["51 to 200"], countries: ["United States"], industries: TRUCKS } },
      },
      { when: { slot: "15" }, campaign_id: 15, icp: { kind: "linkedin_native", persona: "it_dm" } },
      { when: { slot: "4085158" }, campaign_id: 4085158, icp: { kind: "linkedin_native", persona: "it_dm" } },
    ],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
    spend: { auto_cap_usd: 5 },
  });
}

const pilotCsv = (industry: string) =>
  [
    "current_title,company_industry,company_description,employee_count_range,contact_country",
    ...Array.from({ length: 250 }, (_, i) => `${i % 2 ? "CIO" : "IT Director"},${industry},regional operator,51 to 200,United States`),
  ].join("\n");
const BAD_PILOT_CSV = [
  "current_title,company_industry,company_description,employee_count_range,contact_country",
  ...Array.from({ length: 250 }, () => `Nurse,Hospitals and Health Care,clinic,51 to 200,United States`),
].join("\n");
const SAMPLE_CSV = ["email", ...Array.from({ length: 100 }, (_, i) => `p${i}@example.test`)].join("\n");

interface Fake {
  counts: Array<{ industries: string[] | undefined; bands: string[] | undefined }>;
  exports: Array<{ pilot: boolean; industries: string[] | undefined }>;
  held: number;
  badPilotFor: string[] | null;
}

function deps(opts: { fake: Fake; aiArk?: ((f: GetleadsFilters) => number) | null; totals?: Record<string, number>; cache?: PoolCacheReader; performance?: Record<number, [number, number]> }): PlannerDeps {
  const { fake } = opts;
  const totals = opts.totals ?? { [HEALTH[0]!]: 5000, [TRUCKS[0]!]: 3000 };
  const log = new VendorCallLog(() => 1000);
  const getleads = {
    async count(f: GetleadsFilters) {
      fake.counts.push({ industries: f.industries, bands: f.company_size });
      const base = totals[f.industries?.[0] ?? ""] ?? 0;
      return { total_matching: f.company_size ? base : Math.round(base * 1.5), exportable_rows: null };
    },
    async startExport(f: GetleadsFilters, o: { columns?: string[] }) {
      const pilot = Boolean(o.columns);
      fake.exports.push({ pilot, industries: f.industries });
      const bad = pilot && fake.badPilotFor && f.industries?.[0] === fake.badPilotFor[0];
      return { export_id: pilot ? (bad ? "bad-pilot" : `pilot-${encodeURIComponent(f.industries?.[0] ?? "")}`) : "sample" };
    },
    async checkExport(id: string) {
      return { job_status: "completed", export_url: `https://x.test/${id}`, rows_exported: id === "sample" ? 100 : 250, rows_available: null, cap_reason: null, cap_message: null };
    },
  };
  const db = {
    async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
      if (text.includes("to_regclass('public.leads')")) return { rows: [{ leads: true, sends: true, staging: false, campaigns: true }] };
      if (text.includes("count(distinct e)")) return { rows: [{ n: String(fake.held) }] };
      return { rows: [] };
    },
  };
  const perf = opts.performance ?? { 11: [4000, 6], 12: [2000, 3], 13: [1000, 2], 15: [900, 0], 4085158: [100, 5] };
  return {
    db: db as never,
    getleads: getleads as never,
    aiArk: opts.aiArk === undefined || opts.aiArk === null ? null : { count: async (f) => ({ total_matching: opts.aiArk!(f) }) },
    maps: null,
    permits: null,
    rails: { gate: async () => ({ kind: "proceed", worstCaseCents: 5, reason: "under cap" }), record: async () => 0 } as never,
    loadGeo: async () => [],
    log,
    overlap: new Overlap(4, 8),
    fetchText: async (url) => (url.endsWith("/bad-pilot") ? BAD_PILOT_CSV : url.includes("/pilot-") ? pilotCsv(decodeURIComponent(url.split("/pilot-")[1]!)) : SAMPLE_CSV),
    sleep: async () => undefined,
    now: () => Date.parse("2026-10-08T12:00:00Z"),
    cache: opts.cache ?? NO_CACHE,
    campaignBuilds: async () => [
      { smartlead_campaign_id: 11, build_label: "acme_it_20260901", company_source: "getleads", company_filters: { job_titles: ["CIO"], industries: HEALTH }, interested: 4, rows_found: 1200, written_at: "2026-09-01" },
      { smartlead_campaign_id: 12, build_label: "acme_it_20260901", company_source: "getleads", company_filters: { job_titles: ["CIO"], industries: HEALTH }, interested: 2, rows_found: 1200, written_at: "2026-09-01" },
    ],
    workingOverrides: async () => new Map(),
    clientIcpKind: async () => "linkedin_native",
    snapshots: async (ids) => ids.map((id) => ({ smartlead_campaign_id: id, name: `Camp ${id}`, status: "ACTIVE", leads_total: 3000, untouched: 100, sends_window: 700, sends_last_14d: 1400, last_send_at: null, interested_window: 1, bounces_window: 0, synced_at: null })),
    performance: async (ids) => new Map(ids.map((id) => [id, { campaign_id: id, sends: perf[id]?.[0] ?? 0, positives: perf[id]?.[1] ?? 0, per_2000: 0 }])),
    owners: async (ids) => new Map(ids.map((id) => [id, 77])),
    loadsPaused: async () => true,
  };
}

const run = { run_id: "11111111-2222-3333-4444-555555555555", client_tag: "acme", lane: "it_dm" };
const ALL = [11, 12, 13, 15, 4085158];

describe("D48 — the size planner", () => {
  it("counts a shared pool once, skips ineligible campaigns without a vendor call, and splits by need", async () => {
    const fake: Fake = { counts: [], exports: [], held: 10, badPilotFor: null };
    const plan = await planSize(deps({ fake }), run, recipe(), ALL);
    const health = fake.counts.filter((c) => c.industries?.[0] === HEALTH[0]);
    assert.equal(health.length, 2, "one in-band count and one unfiltered count for the pool 11 and 12 share");
    assert.equal(fake.counts.filter((c) => c.industries?.[0] === TRUCKS[0]).length, 2);
    assert.equal(plan.pools.filter((p) => p.kind === "people" && p.campaignIds.length).length, 2);

    const excluded = plan.report.find((r) => r.campaign_id === 4085158)!;
    assert.equal(excluded.gate, "excluded");
    const dead = plan.report.find((r) => r.campaign_id === 15)!;
    assert.equal(dead.gate, "under_reply_bar");
    assert.match(dead.gate_reason ?? "", /0 interested/);
    assert.equal(plan.counts.skipped_15, 1);
    assert.equal(plan.counts.skipped_4085158, 1);

    for (const id of [11, 12, 13]) assert.equal(plan.report.find((r) => r.campaign_id === id)?.gate, "ok", `#${id}`);
    assert.deepEqual(plan.qualifying, [11, 12, 13]);
    const net = plan.pools.find((p) => p.campaignIds.includes(11))!.net_new!;
    assert.ok(net > 0);
    assert.ok((plan.counts.plan_rows_11 ?? 0) + (plan.counts.plan_rows_12 ?? 0) <= net, "shares never exceed the pool's net new");
    assert.equal(plan.counts.campaigns_ok, 3);
    assert.equal(plan.counts.campaigns_skipped, 2);
    assert.equal(plan.counts.plan_rows, plan.counts.plan_rows_11! + plan.counts.plan_rows_12! + plan.counts.plan_rows_13!);
    assert.match(plan.report.find((r) => r.campaign_id === 11)!.strategy, /Repeats acme_it_20260901 \(getleads, 6 interested\)/);
  });

  it("records why AI Ark was not called, and single_source is not a mismatch", async () => {
    const fake: Fake = { counts: [], exports: [], held: 0, badPilotFor: null };
    const plan = await planSize(deps({ fake, aiArk: null }), run, recipe(), [11, 13]);
    assert.equal(plan.counts.ai_ark_called, 0);
    assert.match(String(plan.extra.ai_ark_error), /AI_ARK_TOKEN/);
    const row = plan.report.find((r) => r.campaign_id === 11)!;
    assert.equal(row.tam_check, "single_source");
    assert.equal(row.ai_ark_count, null);
    assert.equal(row.getleads_count, 5000);
    assert.equal(row.gate, "ok");
    const calls = plan.extra.vendor_calls as Array<{ vendor: string; ok: boolean; message: string | null }>;
    assert.ok(calls.some((c) => c.vendor === "aiark" && !c.ok && /AI_ARK_TOKEN/.test(c.message ?? "")), "the vendor log keeps the AI Ark reason");
    assert.ok(calls.some((c) => c.vendor === "getleads" && c.ok));
  });

  it("agrees within 10%, and parks only the mismatched pool's campaigns", async () => {
    const fake: Fake = { counts: [], exports: [], held: 0, badPilotFor: null };
    const plan = await planSize(deps({ fake, aiArk: (f) => (f.industries?.[0] === HEALTH[0] ? 5200 : 1000) }), run, recipe(), [11, 12, 13]);
    assert.equal(plan.counts.ai_ark_called, 1);
    const ok = plan.report.find((r) => r.campaign_id === 11)!;
    assert.equal(ok.tam_check, "ok");
    assert.equal(ok.ai_ark_count, 5200);
    const bad = plan.report.find((r) => r.campaign_id === 13)!;
    assert.equal(bad.gate, "tam_mismatch");
    assert.equal(bad.getleads_count, 3000);
    assert.equal(bad.ai_ark_count, 1000);
    assert.deepEqual(plan.qualifying, [11, 12]);
  });

  it("a pool with under 1,000 net new is TAM filled per campaign; nothing to pull closes the run as sized", async () => {
    const fake: Fake = { counts: [], exports: [], held: 50, badPilotFor: null };
    const plan = await planSize(deps({ fake, totals: { [HEALTH[0]!]: 700, [TRUCKS[0]!]: 600 } }), run, recipe(), [11, 13]);
    for (const id of [11, 13]) {
      const row = plan.report.find((r) => r.campaign_id === id)!;
      assert.equal(row.gate, "tam_filled", `#${id}`);
      assert.match(row.gate_reason ?? "", /under the 1000 minimum/);
      assert.equal(row.to_add, 0);
    }
    assert.deepEqual(plan.qualifying, []);
    assert.equal(plan.counts.plan_rows, 0);
  });

  it("reuses fresh counts and the pilot from the fingerprint cache instead of calling the vendor", async () => {
    const fake: Fake = { counts: [], exports: [], held: 0, badPilotFor: null };
    const hit: PoolCacheHit = {
      run_id: "99999999-0000-0000-0000-000000000000",
      counts_fresh: true,
      pilot_fresh: true,
      entry: {
        fingerprint: "x",
        measured_at: "2026-10-08T06:00:00Z",
        getleads_count: 4800,
        ai_ark_count: 4700,
        ai_ark_error: null,
        ai_ark_called: true,
        held: 20,
        held_method: 2,
        pilot: { rows_scored: 250, title_match: 100, industry_match: 100, description_match: null, headcount_match: 100, geography_match: 100, top_titles: [], top_industries: [], gate: "ok", failed: [] },
        pilot_at: "2026-10-01T06:00:00Z",
      },
    };
    const cache: PoolCacheReader = { read: async () => hit };
    const plan = await planSize(deps({ fake, cache }), run, recipe(), [11]);
    assert.equal(fake.counts.length, 0, "no getleads count was sent");
    assert.equal(fake.exports.length, 0, "no pilot or overlap export was sent");
    assert.equal(plan.counts.pools_cached, 1);
    assert.equal(plan.counts.vendor_calls_cached, 3);
    const row = plan.report.find((r) => r.campaign_id === 11)!;
    assert.equal(row.getleads_count, 4800);
    assert.equal(row.ai_ark_count, 4700);
    assert.equal(row.gate, "ok");
  });

  it("a pilot that misses on one pool parks that pool's campaigns and the other pool still sizes", async () => {
    const fake: Fake = { counts: [], exports: [], held: 0, badPilotFor: TRUCKS };
    const plan = await planSize(deps({ fake }), run, recipe(), [11, 13]);
    assert.equal(plan.report.find((r) => r.campaign_id === 11)?.gate, "ok");
    const parked = plan.report.find((r) => r.campaign_id === 13)!;
    assert.equal(parked.gate, "pilot_mismatch");
    assert.equal(parked.pilot?.title_match, 0);
    assert.deepEqual(plan.qualifying, [11]);
    assert.equal(fake.counts.filter((c) => c.industries?.[0] === TRUCKS[0]).length, 0, "a failed pilot is never counted");
    assert.equal(plan.extra.pilot_gate, "pilot_mismatch");
  });

  it("pilot only scores and stops; the briefing has one line per campaign and no address", async () => {
    const fake: Fake = { counts: [], exports: [], held: 0, badPilotFor: null };
    const plan = await planSize(deps({ fake }), run, recipe(), [11, 13], { pilotOnly: true });
    assert.equal(fake.counts.length, 0);
    assert.equal(plan.counts.pilot_only, 1);
    assert.deepEqual(plan.qualifying, []);
    assert.ok(plan.pools.every((p) => p.pilot != null || p.campaignIds.length === 0));
    const full = await planSize(deps({ fake: { counts: [], exports: [], held: 0, badPilotFor: null } }), run, recipe(), ALL);
    const lines = full.briefing.split("\n");
    assert.equal(lines.filter((l) => l.startsWith("•")).length, ALL.length);
    assert.match(full.briefing, /Loads are paused/);
    assert.equal(full.briefing.includes("@"), false);
    assert.equal(JSON.stringify(full.extra).includes("@example.test"), false, "the overlap sample never reaches the step");
  });
});
