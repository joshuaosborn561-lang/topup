import { ALLOWED_SUPABASE_PROJECT_REF, configReadiness, type Config } from "./config.js";
import type { Repo } from "./db/repo.js";
import type { SpendRails } from "./spend/rails.js";
import { usd } from "./spend/prices.js";

const startedAt = Date.now();

/** Tables a run needs. /health is ok: false until they exist (D34). */
export const REQUIRED_TOPUP_TABLES = [
  "topup.qa_rules",
  "topup.ref_cities",
  "topup.ref_acronyms",
  "topup.campaign_registry",
  "topup.client_domain_blocklist",
  "topup.client_domain_list_state",
  "topup.mx_class",
  "topup.lane_state",
  "topup.runs",
  "topup.spend_ledger",
  "topup.pull_receipts",
  "topup.company_size_cache",
  "topup.lane_exclusions",
  "topup.run_reasoning",
] as const;

/**
 * The first run report (design section 7): counts by lead_status, spend by
 * vendor, stall events, open cards. Counts and ids only. Always answers, and
 * says `ok: false` rather than crashing when the database is unreachable, so
 * a Supabase blip does not put Railway into a restart loop.
 */
export async function buildHealth(d: { cfg: Config; repo: Repo | null; rails: SpendRails | null; recipes: string[] }): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    service: "leadtopup",
    version: process.env.npm_package_version ?? "0.1.0",
    phase: "1 (verify + normalize; nothing is staged or imported)",
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    replicas: 1,
    supabase_project: ALLOWED_SUPABASE_PROJECT_REF,
    readiness: configReadiness(d.cfg),
    recipes: d.recipes,
    caps: { auto_spend_usd: d.cfg.AUTO_SPEND_CAP_USD, daily_vendor_usd: d.cfg.DAILY_VENDOR_CAP_USD },
  };
  if (!d.repo) return { ok: false, ...base, db: false, note: "DATABASE_URL not set; nothing else can be reported" };

  const db = await d.repo.raw().ping();
  if (!db) return { ok: false, ...base, db: false };

  const missing = await d.repo.missingTopupTables(REQUIRED_TOPUP_TABLES);
  if (missing.length) {
    return { ok: false, ...base, db: true, missing_tables: missing, note: `apply migrations 0001–0016 and npm run seed:cities; missing ${missing.join(", ")}` };
  }

  const [leads, spend30, spendToday, stalls, cards, openRuns, mtd] = await Promise.all([
    d.repo.leadStatusCounts(),
    d.repo.spendByVendor(30),
    d.repo.spentTodayCents(),
    d.repo.stallEventCounts(7),
    d.repo.openCards(),
    d.repo.openRuns(),
    d.repo.spendMonthToDate(),
  ]);

  return {
    ok: true,
    ...base,
    db: true,
    leads_by_status: leads,
    spend: {
      today: usd(spendToday),
      daily_cap: usd(d.rails?.cfg.dailyCapCents ?? Math.round(d.cfg.DAILY_VENDOR_CAP_USD * 100)),
      by_vendor_30d: Object.fromEntries(Object.entries(spend30).map(([v, c]) => [v, usd(c)])),
      month_to_date: mtd.map((r) => ({ client_tag: r.client_tag, vendor: r.vendor, usd: usd(r.cents) })),
      balance_readers: d.rails ? ["millionverifier", "no2bounce"].filter((v) => d.rails!.hasBalanceReader(v)) : [],
    },
    stall_events_7d: stalls,
    open_cards: cards.map((c) => ({
      card_id: c.card_id,
      kind: c.kind,
      audience: c.audience,
      run_id: c.run_id,
      age_minutes: Math.round((Date.now() - Date.parse(c.created_at)) / 60000),
    })),
    open_runs: openRuns.map((r) => ({ run_id: r.run_id, client_tag: r.client_tag, lane: r.lane, status: r.status, current_step: r.current_step, opened_at: r.opened_at })),
  };
}
