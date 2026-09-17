import { GETLEADS_BANDS } from "../recipes/schema.js";
import type { SegmentPlan } from "./proposal.js";

/** One row of topup.lane_exclusions. client_tag `all` matches every client. */
export type Exclusion = {
  id: string;
  client_tag: string;
  lane: string | null;
  kind: "title" | "title_pattern" | "band" | "industry" | "company" | "brand" | "geo" | "source" | "persona" | "lane";
  value: string;
  reason: string;
  decided_on: string;
  decided_by: string;
  active: boolean;
};

export function exclusionsFor(rows: readonly Exclusion[], clientTag: string, lane: string): Exclusion[] {
  return rows.filter((e) => e.active && (e.client_tag === "all" || e.client_tag === clientTag) && (e.lane == null || e.lane === lane));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function titlesOf(segment: SegmentPlan): string[] {
  const f = segment.company_filters;
  return [...stringList(f.job_titles), ...stringList(f.titles), ...stringList(segment.band).filter(() => false)];
}

function bandsOf(segment: SegmentPlan): string[] {
  return [...stringList((segment.company_filters as { company_size?: unknown }).company_size), ...segment.band];
}

function rank(band: string): number | null {
  const i = (GETLEADS_BANDS as readonly string[]).indexOf(band);
  return i >= 0 ? i : null;
}

function bandHits(value: string, bands: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (bands.some((b) => b.toLowerCase() === v)) return true;
  if (v === "over 1000" || v === "over 1,000" || v === "past 1000") {
    return bands.some((b) => {
      const r = rank(b);
      return r !== null && r >= (GETLEADS_BANDS as readonly string[]).indexOf("1001 to 5000");
    });
  }
  if (v === "under 11" || v === "under 11 employees") {
    return bands.some((b) => b === "1 to 10");
  }
  return false;
}

function patternHits(pattern: string, values: string[]): boolean {
  try {
    const re = new RegExp(pattern, "i");
    return values.some((v) => re.test(v));
  } catch {
    const needle = pattern.toLowerCase();
    return values.some((v) => v.toLowerCase().includes(needle));
  }
}

function sourcesOf(segment: SegmentPlan): string[] {
  return [segment.company_source, segment.domain_source, segment.person_source, segment.email_source, segment.email_max_tier ?? ""]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/** Which exclusion row, if any, the plan collides with. */
export function collidingExclusion(segment: SegmentPlan, clientTag: string, lane: string, rows: readonly Exclusion[]): Exclusion | null {
  for (const e of exclusionsFor(rows, clientTag, lane)) {
    if (hits(e, segment, lane)) return e;
  }
  return null;
}

function hits(e: Exclusion, segment: SegmentPlan, lane: string): boolean {
  switch (e.kind) {
    case "title":
      return titlesOf(segment).some((t) => t.toLowerCase() === e.value.toLowerCase());
    case "title_pattern":
      return patternHits(e.value, titlesOf(segment));
    case "band":
      return bandHits(e.value, bandsOf(segment));
    case "industry":
      return patternHits(e.value, stringList((segment.company_filters as { industries?: unknown }).industries));
    case "company":
    case "brand":
      return patternHits(
        e.value,
        [
          ...stringList((segment.company_filters as { brands?: unknown }).brands),
          ...stringList((segment.company_filters as { categories?: unknown }).categories),
          ...stringList((segment.company_filters as { company_name?: unknown }).company_name),
        ],
      );
    case "geo":
      return patternHits(e.value, [
        ...stringList((segment.company_filters as { states?: unknown }).states),
        ...stringList((segment.company_filters as { cities?: unknown }).cities),
        ...stringList((segment.company_filters as { countries?: unknown }).countries),
      ]);
    case "source":
      return sourcesOf(segment).includes(e.value.toLowerCase()) || patternHits(e.value, sourcesOf(segment));
    case "persona":
      return false; /* persona lives on the receipt, not the segment plan; checked in validate */
    case "lane":
      return e.value.toLowerCase() === "dead";
    default:
      return false;
  }
}

export function personaBlocked(persona: string | undefined, clientTag: string, lane: string, rows: readonly Exclusion[]): Exclusion | null {
  if (!persona) return null;
  return (
    exclusionsFor(rows, clientTag, lane).find((e) => e.kind === "persona" && e.value.toLowerCase() === persona.toLowerCase()) ??
    null
  );
}

export function laneBlocked(clientTag: string, lane: string, rows: readonly Exclusion[]): Exclusion | null {
  return exclusionsFor(rows, clientTag, lane).find((e) => e.kind === "lane" && e.value.toLowerCase() === "dead") ?? null;
}
