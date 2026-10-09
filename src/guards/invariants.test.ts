import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ALLOWED_SUPABASE_PROJECT_REF, assertSupabaseProject, loadConfig } from "../config.js";
import { NEVER_SEND_STATUSES, SENDABLE_LEAD_STATUSES } from "../domain/leadStatus.js";
import { RUN_STATUSES, TERMINAL_RUN_STATUSES } from "../domain/runs.js";
import { VERB_ORDER, VERB_STEPS } from "../jobs/runner.js";
import { stepForStage } from "../spine/steps.js";
import { BANNED_ACTIONS, BANNED_VENDORS, PRICES, VENDORS } from "../spend/prices.js";

const root = new URL("../../", import.meta.url);

describe("invariants — the numbers and names the canon fixes", () => {
  it("D1 — only campaignintelligence; the other two projects are refused at boot", () => {
    assert.equal(ALLOWED_SUPABASE_PROJECT_REF, "azpapwtnrbzywlnxxecz", "D1: ask Josh before pointing this service at another Supabase project");
    assert.throws(
      () => assertSupabaseProject(loadConfig({ SUPABASE_PROJECT_REF: "kemvxzhcxvynmoutwdrh" })),
      /Refusing to boot/,
      "D1: google-maps-scraper-leads must be refused",
    );
    assert.doesNotThrow(() => assertSupabaseProject(loadConfig({})));
  });

  it("D5 — railway.toml pins exactly one replica", async () => {
    const toml = await readFile(new URL("railway.toml", root), "utf8");
    assert.match(toml, /numReplicas\s*=\s*1\b/, "D5: one replica, pinned. The card waits and poll loops assume one process. Ask Josh.");
    assert.doesNotMatch(toml, /numReplicas\s*=\s*(?!1\b)\d+/, "D5: a second replica count appears in railway.toml");
  });

  it("D51 — the shipped auto cap is $0 and the daily backstop is $25", () => {
    const cfg = loadConfig({});
    assert.equal(cfg.AUTO_SPEND_CAP_USD, 0, "D51: AUTO_SPEND_CAP_USD default is 0; every paid call waits for a named approval. Ask Josh.");
    assert.equal(cfg.DAILY_VENDOR_CAP_USD, 25, "D9: DAILY_VENDOR_CAP_USD default is 25.");
    assert.ok(!("SLACK_BOT_TOKEN" in cfg), "D53: Slack is gone; the console is the card table.");
  });

  it("D9 — every paid vendor has a non-zero price and every vendor has a price", () => {
    for (const v of VENDORS) {
      const p = PRICES[v];
      assert.ok(p, `D9: ${v} has no price row`);
      if (p.kind === "paid") assert.ok(p.unitCents > 0 && p.creditsPerRow > 0, `D9: ${v} is paid but priced at zero; worst case would be $0 and never ask`);
      assert.ok(p.source.length > 10, `D9: ${v} price has no source note`);
    }
  });

  it("D8 — PDL, BillionVerifier, Clay and the job-change detector are banned", () => {
    for (const v of ["pdl", "peopledatalabs", "billionverifier", "clay", "hunter"]) assert.ok(BANNED_VENDORS.includes(v), `D8: ${v} must stay banned`);
    assert.ok(BANNED_ACTIONS.includes("detect_job_change"), "D8: detect_job_change bills on every call and stays banned");
    for (const v of VENDORS) assert.ok(!BANNED_VENDORS.includes(v), `D8: ${v} is both priced and banned`);
  });

  it("D8 — no source file names a banned vendor as a dependency or client", async () => {
    const files = await walk(new URL("src/", root));
    const offenders: string[] = [];
    for (const f of files) {
      const p = f.pathname;
      if (p.endsWith(".test.ts") || p.endsWith("prices.ts") || p.endsWith("schema.ts")) continue;
      const src = await readFile(f, "utf8");
      if (/peopledatalabs|api\.peopledatalabs\.com|billionverifier\.com|clay\.com/i.test(src)) offenders.push(p);
    }
    assert.deepEqual(offenders, [], "D8: a banned vendor host appears in source. Ask Josh; the answer is no.");
  });

  it("D12 — the TypeScript terminal-status list matches topup.run_is_open() in SQL", async () => {
    const sql = await readFile(new URL("supabase/migrations/0001_topup_schema.sql", root), "utf8");
    const m = sql.match(/select s not in \(([^)]*)\)/);
    assert.ok(m, "D12: topup.run_is_open() not found in 0001_topup_schema.sql");
    const sqlList = m![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    assert.deepEqual([...TERMINAL_RUN_STATUSES].sort(), sqlList, "D12: TERMINAL_RUN_STATUSES and topup.run_is_open() disagree; change both in one PR");
    for (const s of TERMINAL_RUN_STATUSES) assert.ok(RUN_STATUSES.includes(s));
  });

  it("D10 — only `routed` may ever be staged; every pre-verification status is in the never-send set", () => {
    assert.deepEqual([...SENDABLE_LEAD_STATUSES], ["routed"], "D10: staging anything but routed rows is how a list bounces");
    for (const s of ["needs_verify", "verifying", "rejected", "stalled_unverified", "pulled", "ingested", "needs_domain", "needs_person", "needs_email"]) {
      assert.ok(NEVER_SEND_STATUSES.includes(s as never), `D10: ${s} must be in NEVER_SEND_STATUSES`);
    }
  });

  it("D29/D53 — the verbs walk steps 3 through 12 in order; nothing sizes, triggers or flips", () => {
    const steps = VERB_ORDER.flatMap((v) => [...VERB_STEPS[v]]);
    assert.deepEqual(steps, ["pull", "ingest", "suppress", "icp", "puzzle", "find_emails", "verify", "normalize", "qa", "route", "stage", "import", "post_import"], "D53/D58: adding or reordering a stage is a new decision; append it and update CANON.md");
    let last = 0;
    for (const s of steps) {
      const n = stepForStage(s)?.n ?? 0;
      assert.ok(n >= last && n >= 3 && n <= 12, `D28: ${s} is on step ${n}, out of order or outside 3..12`);
      last = n;
    }
    for (const gone of ["trigger", "size", "flip"]) assert.ok(!steps.includes(gone as never), `D53: ${gone} is not a stage the service runs; Grok reads, a person decides, Josh flips`);
  });
});

async function walk(dir: URL): Promise<URL[]> {
  const { readdir } = await import("node:fs/promises");
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".ts")) out.push(u);
  }
  return out;
}
