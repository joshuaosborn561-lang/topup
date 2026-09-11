/**
 * Load the free US cities file the skill scripts geocode with into
 * topup.ref_cities (D25). Run once per database, by hand:
 *
 *   DATABASE_URL=... npm run seed:cities            # downloads the pinned file
 *   DATABASE_URL=... npm run seed:cities -- ./us_cities.csv   # or a local copy
 *
 * Source: kelvins/US-Cities-Database (MIT), the same file the skills fetch to
 * /home/claude/uscities.csv. Pinned to a commit so the answer never drifts
 * under a run. Not a vendor, not a cost; this script is never called by the
 * service and never by a test. Idempotent: rows already present are kept
 * (manual rows from the migration win over the file).
 */
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";

const PINNED_URL = "https://raw.githubusercontent.com/kelvins/US-Cities-Database/ab0961970d41f43f731314ef6f91e36606aafaac/csv/us_cities.csv";
const FALLBACK_URL = "https://raw.githubusercontent.com/kelvins/US-Cities-Database/main/csv/us_cities.csv";

/** Minimal CSV: the file has no embedded newlines; quoted fields may contain commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

async function fetchCsv(arg: string | undefined): Promise<string> {
  if (arg) return (await import("node:fs/promises")).readFile(arg, "utf8");
  for (const url of [PINNED_URL, FALLBACK_URL]) {
    const res = await fetch(url);
    if (res.ok) {
      console.log(JSON.stringify({ tag: "seed_cities", source: url }));
      return res.text();
    }
    console.log(JSON.stringify({ tag: "seed_cities", source: url, status: res.status }));
  }
  throw new Error("could not download the US cities file; pass a local path");
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!url.includes(ALLOWED_SUPABASE_PROJECT_REF)) throw new Error(`DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing.`);

  const rows = parseCsv(await fetchCsv(process.argv[2]));
  const header = rows.shift()?.map((h) => h.trim().toUpperCase()) ?? [];
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    throw new Error(`no column ${names.join("/")} in ${header.join(",")}`);
  };
  const iCity = col("CITY", "CITY_ASCII", "NAME");
  const iState = col("STATE_CODE", "STATE_ID", "STATE");
  const iLat = col("LATITUDE", "LAT");
  const iLon = col("LONGITUDE", "LNG", "LON");

  const seen = new Set<string>();
  const cities: string[] = [];
  const states: string[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  for (const r of rows) {
    const city = (r[iCity] ?? "").trim().toLowerCase();
    const state = (r[iState] ?? "").trim().toUpperCase();
    const lat = Number(r[iLat]);
    const lon = Number(r[iLon]);
    if (!city || state.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const k = `${city}|${state}`;
    if (seen.has(k)) continue; // first row wins, as in the scripts
    seen.add(k);
    cities.push(city);
    states.push(state);
    lats.push(lat);
    lons.push(lon);
  }

  const client = new pg.Client({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const CHUNK = 5000;
    let inserted = 0;
    for (let i = 0; i < cities.length; i += CHUNK) {
      const res = await client.query(
        `insert into topup.ref_cities (city, state, lat, lon, source)
         select v.city, v.state, v.lat, v.lon, 'uscities'
         from unnest($1::text[], $2::char(2)[], $3::float8[], $4::float8[]) as v(city, state, lat, lon)
         on conflict (city, state) do nothing`,
        [cities.slice(i, i + CHUNK), states.slice(i, i + CHUNK), lats.slice(i, i + CHUNK), lons.slice(i, i + CHUNK)],
      );
      inserted += res.rowCount ?? 0;
    }
    const total = await client.query<{ n: string }>(`select count(*)::text as n from topup.ref_cities`);
    console.log(JSON.stringify({ tag: "seed_cities", file_rows: rows.length, distinct: cities.length, inserted, table_rows: Number(total.rows[0].n) }));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ tag: "seed_cities", error: (err as Error).message }));
  process.exit(1);
});
