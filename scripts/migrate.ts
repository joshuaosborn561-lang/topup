/**
 * Apply supabase/migrations/*.sql in order against DATABASE_URL.
 *
 * Refuses to run unless DATABASE_URL points at the campaignintelligence
 * project (azpapwtnrbzywlnxxecz). Every file is idempotent, so re-running is
 * safe; applied files are recorded in topup.schema_migrations anyway so the
 * boot log can say what version the database is at.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../supabase/migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!url.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(
      `DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing to migrate another project.`,
    );
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("create schema if not exists topup");
    await client.query(
      "create table if not exists topup.schema_migrations (filename text primary key, applied_at timestamptz not null default now())",
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into topup.schema_migrations (filename) values ($1) on conflict (filename) do update set applied_at = now()",
          [f],
        );
        await client.query("commit");
        console.log(JSON.stringify({ tag: "migrate", applied: f }));
      } catch (err) {
        await client.query("rollback");
        throw new Error(`${f}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ tag: "migrate", error: (err as Error).message }));
  process.exit(1);
});
