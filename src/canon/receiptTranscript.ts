import { GETLEADS_INDUSTRIES, GETLEADS_INDUSTRY_ALIASES, mapGetleadsIndustry } from "../jobs/getleadsIndustries.js";
import { GETLEADS_BANDS } from "../recipes/schema.js";
import { ASK } from "../policy/rules.js";

/**
 * Diff a pull receipt's company_filters against its matching build
 * narrative or transcript (D96). The transcript / narrative is the
 * source of truth for how the list was built. A thinner or disagreeing
 * backfill is corrected to match. That is a backfill fix, not widening.
 *
 * Generic: official getleads industries and size bands, explicit title
 * lists, and title phrases the source names. No client constants.
 */

export interface ReceiptSource {
  receipt_id: string;
  client_tag: string;
  lane: string;
  campaign_ids: number[];
  company_filters: Record<string, unknown>;
  written_by: string | null;
}

export interface BuildSource {
  id: number;
  narrative: string;
  transcript?: string | null;
  campaign_ids: number[];
  receipt_ids: string[] | null;
  lanes?: string[] | null;
}

export interface FilterPatch {
  key: string;
  before: unknown;
  after: unknown;
  reason: "thinner" | "disagrees" | "placed";
}

export interface ReceiptCorrection {
  receipt_id: string;
  lane: string;
  campaign_ids: number[];
  source: "transcript" | "narrative";
  build_id: number | null;
  patches: FilterPatch[];
  next_filters: Record<string, unknown>;
  unplaced_industries: string[];
  note: string;
}

export interface ReceiptTranscriptPlan {
  client_tag: string;
  receipts_scanned: number;
  corrections: ReceiptCorrection[];
  skipped: Array<{ receipt_id: string; reason: string }>;
  note: string;
}

const BANDS = [...GETLEADS_BANDS];
const BAND_SET = new Set<string>(BANDS);
const INDUSTRIES_BY_LEN = [...GETLEADS_INDUSTRIES].sort((a, b) => b.length - a.length);

const INCLUDE_HEAD = /(?:job[_\s-]?titles?|(?<!purged_)titles?|personas?|looking[_\s-]?for)\s*[:\-]/gi;
const PURGE_HEAD = /(?:purged?[_\s-]?titles?|exclude[_\s-]?(?:job[_\s-]?)?titles?)\s*[:\-]/gi;
const TITLE_PHRASE =
  /\b(?:Chief [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)* Officer|Director of [A-Z][A-Za-z0-9]+(?: (?:and|&) [A-Z][A-Za-z0-9]+)*|Head of [A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)*|Small Business Owner|Vice President|Managing Director|Managing Partner|Operating Partner|Founder|Investor)\b/g;
const C_LEVEL = /\bC[A-Z]{1,3}O\b/g;

export function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a.map((s) => s.toLowerCase()));
  return b.every((s) => left.has(s.toLowerCase()));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractOfficialIndustries(text: string): string[] {
  const hay = text;
  const hits: Array<{ start: number; end: number; value: string }> = [];
  const names = new Set<string>([...INDUSTRIES_BY_LEN, ...Object.keys(GETLEADS_INDUSTRY_ALIASES)]);
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(escapeRe(name), "ig");
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay))) {
      const mapped = mapGetleadsIndustry(name);
      if (!mapped.ok) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, value: mapped.value });
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
  return uniq(kept.map((h) => h.value));
}

export function extractOfficialBands(text: string): { bands: string[]; over_1k: boolean } {
  const found = new Set<string>();
  let over = false;
  for (const band of BANDS) {
    const dashed = band.replace(/ to /g, "-");
    const re = new RegExp(`\\b${escapeRe(band)}\\b|\\b${escapeRe(dashed)}\\b`, "ig");
    if (re.test(text)) found.add(band);
  }
  const andUp = [...text.matchAll(/(\d+)\s+to\s+(\d+)\s+and\s+up/gi)];
  for (const m of andUp) {
    const start = `${m[1]} to ${m[2]}`;
    const idx = BANDS.indexOf(start as (typeof BANDS)[number]);
    if (idx < 0) continue;
    for (const band of BANDS.slice(idx)) found.add(band);
    if (BANDS.slice(idx).some((b) => b.startsWith("1001") || b === "10001+")) over = true;
  }
  if ([...found].some((b) => b.startsWith("1001") || b === "10001+" || b === "5001 to 10000")) over = true;
  return { bands: BANDS.filter((b) => found.has(b)), over_1k: over };
}

function splitList(block: string): string[] {
  return block
    .split(/\n/)
    .flatMap((line) => line.replace(/^[\s>*\-•]+/, "").split(/\s*(?:,|;|\band\b)\s*/i))
    .map((s) => s.replace(/^["'`]+|["'`]+$/g, "").replace(/\.$/, "").trim())
    .filter(Boolean);
}

function cleanTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 80) return null;
  if (BAND_SET.has(t)) return null;
  const asIndustry = mapGetleadsIndustry(t);
  if (asIndustry.ok) return null;
  if (/^(titles?|personas?|job_titles?|include|also)$/i.test(t)) return null;
  return t;
}

function blockAfter(text: string, from: number): string {
  const slice = text.slice(from, from + 800);
  const stop = slice.search(
    /\n\s*(?:purged?[_\s-]?titles?|exclude[_\s-]?(?:job[_\s-]?)?titles?|job[_\s-]?titles?|titles?|personas?|industries|company_size|looking[_\s-]?for)\s*[:\-]/i,
  );
  const cut = stop >= 0 ? slice.slice(0, stop) : (slice.split(/\n\s*\n/)[0] ?? slice);
  return cut;
}

export function extractExplicitTitles(text: string, head: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(head.source, "gi");
  for (const m of text.matchAll(re)) {
    const block = blockAfter(text, (m.index ?? 0) + m[0].length);
    for (const raw of splitList(block)) {
      const t = cleanTitle(raw);
      if (t) out.push(t);
    }
  }
  return uniq(out);
}

export function extractMentionedTitles(text: string, hintTitles: string[]): string[] {
  // Receipt titles stay; the source only needs to name the ones it adds.
  const out: string[] = [...hintTitles];
  for (const p of text.matchAll(new RegExp(TITLE_PHRASE.source, "g"))) {
    const t = cleanTitle(p[0] ?? "");
    if (t) out.push(t);
  }
  for (const p of text.matchAll(new RegExp(C_LEVEL.source, "g"))) out.push(p[0] ?? "");
  return uniq(out);
}

export interface ExtractedFilters {
  job_titles: string[];
  purged_titles: string[];
  industries: string[];
  company_size: string[];
  over_1k_campaign: boolean;
  explicit_titles: boolean;
  explicit_purge: boolean;
}

const LANE_STOP = new Set(["lane", "the", "and", "for", "with", "from"]);

function laneTokens(lane: string, campaignNames: string[]): string[] {
  return uniq([
    lane,
    ...lane.split(/[_-]+/).filter((w) => w.length >= 2 && !LANE_STOP.has(w.toLowerCase())),
    ...campaignNames.flatMap((n) => n.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3 && !LANE_STOP.has(w.toLowerCase()))),
  ]);
}

/**
 * A multi-lane write-up names titles per lane. Keep clauses that mention
 * this receipt's lane or campaign, drop clauses that only mention another
 * stored lane, and keep shared clauses only when they overlap the
 * receipt's current titles (D96).
 */
export function scopeTitleSource(
  text: string,
  lane: string,
  campaignNames: string[],
  otherLanes: string[],
  hintTitles: string[],
): string {
  const mine = laneTokens(lane, campaignNames);
  const others = uniq(
    otherLanes.filter((l) => l.trim().toLowerCase() !== lane.trim().toLowerCase()).flatMap((l) => laneTokens(l, [])),
  );
  const namedLanes = [...text.matchAll(/for the\s+([A-Za-z0-9_-]+)\s+lane/gi)].map((m) => m[1]!);
  const multi = uniq(otherLanes.map((l) => l.trim().toLowerCase()).filter(Boolean)).length > 1 || namedLanes.length > 0;
  const parts = text.split(/(?<=[.;])\s+|\s+and for the\s+/i).map((p) => p.trim()).filter(Boolean);
  if (!multi || parts.length <= 1) return text;
  const hint = new Set(hintTitles.map((t) => t.toLowerCase()));
  const kept = parts.filter((part) => {
    const hasMine = mine.some((t) => new RegExp(`\\b${escapeRe(t)}\\b`, "i").test(part));
    const hasOther = others.some((t) => new RegExp(`\\b${escapeRe(t)}\\b`, "i").test(part));
    if (hasMine) return true;
    if (hasOther) return false;
    const words = part.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3);
    return words.some((w) => hint.has(w.toLowerCase()));
  });
  return kept.length ? kept.join(" ") : text;
}

export function extractFiltersFromSource(text: string, hintTitles: string[] = []): ExtractedFilters {
  const explicit = extractExplicitTitles(text, INCLUDE_HEAD);
  const purged = extractExplicitTitles(text, PURGE_HEAD);
  const mentioned = extractMentionedTitles(text, hintTitles);
  const industries = extractOfficialIndustries(text);
  const { bands, over_1k } = extractOfficialBands(text);
  return {
    job_titles: uniq(explicit.length ? explicit : mentioned),
    purged_titles: purged,
    industries,
    company_size: bands,
    over_1k_campaign: over_1k,
    explicit_titles: explicit.length > 0,
    explicit_purge: purged.length > 0,
  };
}

function sentenceAround(text: string, index: number): { start: number; text: string } {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  const endDot = text.indexOf(".", index);
  const end = endDot < 0 ? text.length : endDot;
  return { start, text: text.slice(start, end) };
}

/** Attach a campaign name to each industries_by_campaign key (id or bucket word). */
export function namesForBuckets(bucketKeys: string[], idToName: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...idToName };
  for (const key of bucketKeys) {
    if (out[key]) continue;
    if (/^\d+$/.test(key) && idToName[key]) {
      out[key] = idToName[key]!;
      continue;
    }
    const token = key.toLowerCase().replace(/[_-]+/g, " ").trim();
    if (!token) continue;
    const hits = Object.entries(idToName).filter(([, name]) => new RegExp(`\\b${escapeRe(token)}\\b`, "i").test(name));
    if (hits.length === 1) out[key] = hits[0]![1]!;
  }
  return out;
}

function mentionForms(official: string): string[] {
  const aliases = Object.entries(GETLEADS_INDUSTRY_ALIASES)
    .filter(([, mapped]) => mapped === official)
    .map(([alias]) => alias);
  return uniq([official, ...aliases]);
}

function bucketTokens(key: string, campaignNames: Record<string, string>): string[] {
  return uniq([
    key,
    ...key.split(/[_-]+/).filter((w) => w.length >= 3),
    ...(campaignNames[key] ?? "").split(/\s+/).filter((w) => w.length >= 3),
  ]);
}

function nearestBucket(
  text: string,
  industry: string,
  keys: string[],
  campaignNames: Record<string, string>,
): string | null {
  const mentions = mentionForms(industry).flatMap((form) => [...text.matchAll(new RegExp(escapeRe(form), "ig"))]);
  const hits = new Set<string>();
  for (const mention of mentions) {
    const pos = mention.index ?? 0;
    const sentence = sentenceAround(text, pos).text;
    for (const key of keys) {
      if (bucketTokens(key, campaignNames).some((token) => new RegExp(`\\b${escapeRe(token)}\\b`, "i").test(sentence))) {
        hits.add(key);
      }
    }
  }
  if (hits.size === 1) return [...hits][0]!;
  return null;
}

function parentheticalBucket(
  text: string,
  industry: string,
  keys: string[],
  campaignNames: Record<string, string>,
): string | null {
  const hits = new Set<string>();
  const forms = mentionForms(industry);
  for (const key of keys) {
    for (const token of bucketTokens(key, campaignNames)) {
      const re = new RegExp(`${escapeRe(token)}\\s*\\(([^)]*)\\)`, "ig");
      for (const m of text.matchAll(re)) {
        const inner = m[1] ?? "";
        if (forms.some((form) => new RegExp(escapeRe(form), "i").test(inner))) hits.add(key);
      }
    }
  }
  if (hits.size === 1) return [...hits][0]!;
  return null;
}

export function placeIndustries(
  extracted: string[],
  existing: Record<string, string[]>,
  sourceText: string,
  campaignNames: Record<string, string> = {},
): { buckets: Record<string, string[]>; unplaced: string[] } {
  const buckets: Record<string, string[]> = {};
  for (const [k, vs] of Object.entries(existing)) buckets[k] = uniq(strings(vs));
  const keys = Object.keys(buckets);
  const unplaced: string[] = [];
  for (const industry of extracted) {
    const already = keys.filter((k) => buckets[k]!.some((v) => v.toLowerCase() === industry.toLowerCase()));
    if (already.length) continue;
    const hit =
      parentheticalBucket(sourceText, industry, keys, campaignNames) ??
      nearestBucket(sourceText, industry, keys, campaignNames);
    const mapped = mapGetleadsIndustry(industry);
    const official = mapped.ok ? mapped.value : industry;
    const normalize = (v: string) => {
      const m = mapGetleadsIndustry(v);
      return m.ok ? m.value : v;
    };
    if (hit) buckets[hit] = uniq([...buckets[hit]!.map(normalize), official]);
    else if (keys.length === 1) buckets[keys[0]!] = uniq([...buckets[keys[0]!]!.map(normalize), official]);
    else unplaced.push(industry);
  }
  return { buckets, unplaced: uniq(unplaced) };
}

function asRecord(v: unknown): Record<string, string[]> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const xs = strings(val);
    if (xs.length) out[k] = xs;
  }
  return Object.keys(out).length ? out : null;
}

export function diffReceiptFilters(
  filters: Record<string, unknown>,
  extracted: ExtractedFilters,
  sourceText: string,
  campaignNames: Record<string, string> = {},
): { next: Record<string, unknown>; patches: FilterPatch[]; unplaced: string[] } {
  const next: Record<string, unknown> = { ...filters };
  const patches: FilterPatch[] = [];
  const hint = strings(filters.job_titles ?? filters.titles);
  const currentTitles = hint;
  if (extracted.job_titles.length) {
    const after = extracted.explicit_titles ? extracted.job_titles : uniq([...currentTitles, ...extracted.job_titles]);
    if (!sameSet(currentTitles, after)) {
      patches.push({
        key: "job_titles",
        before: currentTitles,
        after,
        reason: extracted.explicit_titles && currentTitles.some((t) => !after.some((x) => x.toLowerCase() === t.toLowerCase()))
          ? "disagrees"
          : "thinner",
      });
      next.job_titles = after;
    }
  }
  const currentPurge = strings(filters.purged_titles ?? filters.exclude_job_titles);
  if (extracted.explicit_purge && extracted.purged_titles.length && !sameSet(currentPurge, extracted.purged_titles)) {
    patches.push({ key: "purged_titles", before: currentPurge, after: extracted.purged_titles, reason: "disagrees" });
    next.purged_titles = extracted.purged_titles;
    delete next.exclude_job_titles;
  }
  const byCampaign = asRecord(filters.industries_by_campaign);
  let unplaced: string[] = [];
  if (byCampaign && extracted.industries.length) {
    const placed = placeIndustries(extracted.industries, byCampaign, sourceText, campaignNames);
    unplaced = placed.unplaced;
    const changed = Object.keys(placed.buckets).some((k) => !sameSet(byCampaign[k] ?? [], placed.buckets[k] ?? []));
    if (changed) {
      patches.push({
        key: "industries_by_campaign",
        before: byCampaign,
        after: placed.buckets,
        reason: "thinner",
      });
      next.industries_by_campaign = placed.buckets;
    }
  } else if (extracted.industries.length && strings(filters.industries).length) {
    const current = strings(filters.industries);
    const after = uniq([...current, ...extracted.industries]);
    if (!sameSet(current, after)) {
      patches.push({ key: "industries", before: current, after, reason: "thinner" });
      next.industries = after;
    }
  }
  const currentSize = strings(filters.company_size);
  if (extracted.company_size.length && currentSize.length) {
    const after = uniq([...currentSize, ...extracted.company_size]);
    const ordered = BANDS.filter((b) => after.some((x) => x.toLowerCase() === b.toLowerCase()));
    if (!sameSet(currentSize, ordered)) {
      patches.push({ key: "company_size", before: currentSize, after: ordered, reason: "thinner" });
      next.company_size = ordered;
    }
  }
  // over_1k_campaign tells count to keep only 1001+ bands (D84). Do not
  // set it when the receipt already stores (or we just wrote) under-1k
  // sizes — the full company_size list is then the source of truth.
  const nextSize = strings(next.company_size);
  const hasUnder1k = nextSize.some((b) => !b.startsWith("1001") && b !== "10001+" && b !== "5001 to 10000");
  if (extracted.over_1k_campaign && currentSize.length && filters.over_1k_campaign !== true && !hasUnder1k) {
    patches.push({ key: "over_1k_campaign", before: filters.over_1k_campaign ?? null, after: true, reason: "thinner" });
    next.over_1k_campaign = true;
  }
  return { next, patches, unplaced };
}

export function matchBuild(receipt: ReceiptSource, builds: BuildSource[]): BuildSource | null {
  const rid = receipt.receipt_id;
  const byReceipt = builds.find((b) => (b.receipt_ids ?? []).includes(rid));
  if (byReceipt) return byReceipt;
  const ids = new Set(receipt.campaign_ids);
  return builds.find((b) => b.campaign_ids.some((id) => ids.has(id))) ?? null;
}

export function planReceiptCorrection(
  receipt: ReceiptSource,
  build: BuildSource | null,
  campaignNames: Record<string, string> = {},
): ReceiptCorrection | { skip: string } {
  if (!build) return { skip: "no matching list_build_records row" };
  const text = (build.transcript && build.transcript.trim()) || build.narrative;
  if (!text.trim()) return { skip: "matching build has an empty narrative and transcript" };
  const hint = strings(receipt.company_filters.job_titles ?? receipt.company_filters.titles);
  const otherLanes = [...new Set([build.lanes ?? [], receipt.lane].flat().filter(Boolean))];
  const titleText = scopeTitleSource(text, receipt.lane, Object.values(campaignNames), otherLanes, hint);
  const extracted = extractFiltersFromSource(titleText, hint);
  const industries = extractFiltersFromSource(text, hint);
  extracted.industries = industries.industries;
  extracted.company_size = industries.company_size;
  extracted.over_1k_campaign = industries.over_1k_campaign;
  const byCampaign = asRecord(receipt.company_filters.industries_by_campaign);
  const names = namesForBuckets(byCampaign ? Object.keys(byCampaign) : [], campaignNames);
  const { next, patches, unplaced } = diffReceiptFilters(receipt.company_filters, extracted, text, names);
  if (patches.length === 0 && unplaced.length === 0) return { skip: "receipt already matches the build source" };
  return {
    receipt_id: receipt.receipt_id,
    lane: receipt.lane,
    campaign_ids: receipt.campaign_ids,
    source: build.transcript && build.transcript.trim() ? "transcript" : "narrative",
    build_id: build.id,
    patches,
    next_filters: next,
    unplaced_industries: unplaced,
    note: unplaced.length
      ? `Unplaced industries were named in the source but no bucket key or campaign name sat next to them. ${ASK}`
      : "Transcript / narrative is the source of truth (D96). This is a backfill fix, not widening.",
  };
}

export function planReceiptTranscript(
  receipts: ReceiptSource[],
  builds: BuildSource[],
  campaignNames: Record<string, string> = {},
): ReceiptTranscriptPlan {
  const corrections: ReceiptCorrection[] = [];
  const skipped: Array<{ receipt_id: string; reason: string }> = [];
  for (const receipt of receipts) {
    const build = matchBuild(receipt, builds);
    const planned = planReceiptCorrection(receipt, build, campaignNames);
    if ("skip" in planned) skipped.push({ receipt_id: receipt.receipt_id, reason: planned.skip });
    else corrections.push(planned);
  }
  return {
    client_tag: receipts[0]?.client_tag ?? "",
    receipts_scanned: receipts.length,
    corrections,
    skipped,
    note: "Dry-run. Pass --apply to write company_filters. Counts and filter keys only. Never writes dl_status, sg_exclude, or skip_*.",
  };
}
