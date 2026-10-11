/**
 * EMCOR lane E owner-name pilot — 2026-10-10. ZERO spend.
 *
 * Free website fetch (our HTTP) + rule-based name extract. Review replies
 * are read only from already-stored columns; this script never calls
 * Apify, Maps scrape, or an LLM.
 *
 * Usage:
 *   npx tsx scripts/emcor-owner-pilot-20261010.ts --sample path.json --out dir
 *
 * Sample JSON is an array of { place_id, domain, website, has_review_count }.
 * Output is counts.json (safe) + rows.jsonl (names; do not commit).
 * Never writes dl_status, sg_exclude, or skip_*.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractOwnerFromHtml, extractOwnerFromReviewsPayload, namesAgree, type OwnerHit } from "../src/pilot/ownerName.js";
import { fetchSitePages } from "../src/pilot/siteFetch.js";

const CONCURRENCY = 4;

interface SampleRow {
  place_id: string;
  domain: string;
  website: string | null;
  has_review_count: number | boolean;
  reviews_raw?: unknown;
}

interface ResultRow {
  place_id: string;
  domain: string;
  website: string | null;
  pages_fetched: number;
  pages_ok: number;
  website_status: string;
  website_name: string | null;
  website_title: string | null;
  website_pattern: string | null;
  website_source_url: string | null;
  review_name: string | null;
  review_title: string | null;
  review_pattern: string | null;
  review_has_count: boolean;
  review_has_reply_text: boolean;
  names_agree: boolean | null;
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function runOne(row: SampleRow): Promise<ResultRow> {
  const base: ResultRow = {
    place_id: row.place_id,
    domain: row.domain,
    website: row.website,
    pages_fetched: 0,
    pages_ok: 0,
    website_status: "skipped_no_website",
    website_name: null,
    website_title: null,
    website_pattern: null,
    website_source_url: null,
    review_name: null,
    review_title: null,
    review_pattern: null,
    review_has_count: Boolean(row.has_review_count),
    review_has_reply_text: false,
    names_agree: null,
  };
  if (row.reviews_raw != null && row.reviews_raw !== "" && !(typeof row.reviews_raw === "string" && /^\s*\d+\s*$/.test(row.reviews_raw))) {
    base.review_has_reply_text = true;
    const hit = extractOwnerFromReviewsPayload(row.reviews_raw);
    if (hit) {
      base.review_name = hit.name;
      base.review_title = hit.title;
      base.review_pattern = hit.pattern;
    }
  }
  if (!row.website) return base;
  const pages = await fetchSitePages(row.website);
  base.pages_fetched = pages.length;
  base.pages_ok = pages.filter((p) => p.html).length;
  if (pages[0]?.error === "robots_disallow_all") base.website_status = "robots_disallow_all";
  else if (base.pages_ok === 0) base.website_status = pages[0]?.error ?? "fetch_failed";
  else base.website_status = "fetched";
  let best: { hit: OwnerHit; url: string } | null = null;
  for (const p of pages) {
    if (!p.html) continue;
    const hit = extractOwnerFromHtml(p.html);
    if (hit) {
      best = { hit, url: p.url };
      if (hit.pattern.startsWith("jsonld")) break;
    }
  }
  if (best) {
    base.website_name = best.hit.name;
    base.website_title = best.hit.title;
    base.website_pattern = best.hit.pattern;
    base.website_source_url = best.url;
  }
  base.names_agree = namesAgree(base.website_name, base.review_name);
  return base;
}

function summarize(rows: ResultRow[]) {
  const n = rows.length;
  const web = rows.filter((r) => r.website_name);
  const rev = rows.filter((r) => r.review_name);
  const either = rows.filter((r) => r.website_name || r.review_name);
  const both = rows.filter((r) => r.website_name && r.review_name);
  const agree = both.filter((r) => r.names_agree === true);
  const conflict = both.filter((r) => r.names_agree === false);
  const titled = either.filter((r) => r.website_title || r.review_title);
  const fetched = rows.filter((r) => r.website_status === "fetched");
  const reviewCount = rows.filter((r) => r.review_has_count);
  const reviewText = rows.filter((r) => r.review_has_reply_text);
  const byPattern: Record<string, number> = {};
  for (const r of rows) {
    if (r.website_pattern) byPattern[r.website_pattern] = (byPattern[r.website_pattern] ?? 0) + 1;
  }
  return {
    sampled: n,
    website_fetched_ok: fetched.length,
    website_names: web.length,
    website_hit_rate: n ? Number((web.length / n).toFixed(4)) : 0,
    review_names: rev.length,
    review_hit_rate: n ? Number((rev.length / n).toFixed(4)) : 0,
    review_has_count: reviewCount.length,
    review_has_reply_text: reviewText.length,
    overlap_both: both.length,
    agree: agree.length,
    conflict: conflict.length,
    combined_names: either.length,
    combined_hit_rate: n ? Number((either.length / n).toFixed(4)) : 0,
    with_usable_title: titled.length,
    website_pages_ok: rows.reduce((a, r) => a + r.pages_ok, 0),
    website_status: Object.fromEntries(
      [...new Set(rows.map((r) => r.website_status))].map((s) => [s, rows.filter((r) => r.website_status === s).length]),
    ),
    website_patterns: byPattern,
    spend_cents: 0,
    note: "Review replies are not in maps_raw (reviews is a count). Fetching them would cost a Maps scrape — not done.",
  };
}

async function main(): Promise<void> {
  const samplePath = resolve(arg("--sample", "artifacts/emcor-owner-pilot-sample.json"));
  const outDir = resolve(arg("--out", "artifacts/emcor-owner-pilot-20261010"));
  const raw = JSON.parse(await readFile(samplePath, "utf8")) as SampleRow[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("sample is empty");
  if (raw.length > 200) throw new Error("sample is over 200; refuse to widen");
  await mkdir(outDir, { recursive: true });
  const rows = await pool(raw, CONCURRENCY, (row, i) => {
    if ((i + 1) % 25 === 0) process.stderr.write(`pilot ${i + 1}/${raw.length}\n`);
    return runOne(row);
  });
  const summary = summarize(rows);
  await writeFile(resolve(outDir, "counts.json"), JSON.stringify(summary, null, 2));
  await writeFile(resolve(outDir, "rows.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
