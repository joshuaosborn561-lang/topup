/**
 * D81 — backfill public.sends.sender from Smartlead.
 * Dry-run by default. Pass --apply only after Josh applies 0024_sends_sender.sql.
 * Server to server. Rate limited. Resumable. Counts and ids only.
 */
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";
import { DEFAULT_BACKFILL_RPS, estimateBackfill, runBackfill } from "../src/sends/backfill.js";

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.slice(name.length + 1));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const apply = flag("--apply");
  const rps = num("--rps", DEFAULT_BACKFILL_RPS);
  const limit = num("--limit", 0);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!url.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(`DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing another project.`);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const estimate = await estimateBackfill(client, rps);
    console.log(JSON.stringify({ tag: "backfill-send-sender", ...estimate }));
    if (!apply) return;
    const key = process.env.SMARTLEAD_API_KEY;
    if (!key) throw new Error("SMARTLEAD_API_KEY is required for --apply. Dry-run needs none.");
    const result = await runBackfill(client, fetch, key, { apply: true, rps, limit, resume: !flag("--no-resume") });
    console.log(JSON.stringify({ tag: "backfill-send-sender", ...result }));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ tag: "backfill-send-sender", error: (err as Error).message }));
  process.exit(1);
});
