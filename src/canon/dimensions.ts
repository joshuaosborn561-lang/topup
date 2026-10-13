import { createHash } from "node:crypto";

/**
 * D106 — derived routing dimensions, as data. A lane's list_build_record
 * may name dimensions the route step computes from a row's own columns,
 * using a small general vocabulary. The client facts (which title words
 * are junior, which industries are senior living, which bands get the
 * gift) live in the record, never in code.
 *
 *   match        first case whose pattern (case-insensitive regex) matches
 *                the column wins; else the default
 *   set          first case whose values contain the column (trimmed,
 *                case-insensitive) wins; else the default
 *   present      one value when the column is non-empty, another when not
 *   hash_parity  even or odd by the md5 of the lower-cased column, so a
 *                company lands on the same side every time
 *
 * A dimension may read only a lane column from the list below. Lead data
 * never leaves the database: the route step computes the value and keeps
 * only the campaign it points at.
 */
export const DIMENSION_COLUMNS = [
  "title",
  "industry",
  "vertical",
  "company_size",
  "employee_range",
  "company_name",
  "company_n",
  "company_domain",
  "first_name",
  "first_name_n",
  "city",
  "state",
  "mail_class",
  "source_label",
] as const;
export type DimensionColumn = (typeof DIMENSION_COLUMNS)[number];

/**
 * Computed by the route step itself; a record may not redefine them.
 *   band         the getleads band as a segment ("11_50", "10001_plus")
 *   mail_class   SEG or OTHER, from the verifier
 *   gift         team when the sports-team ladder found a local team, else airpods
 *   team_source  where that team came from: MLB, NFL, College, CityOverride; none when there is no team
 */
export const BUILT_IN_DIMENSIONS = ["band", "mail_class", "gift", "team_source"] as const;

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const VALUE = /^[A-Za-z0-9][A-Za-z0-9 _+.|-]{0,59}$/;

export type Dimension =
  | { name: string; kind: "match"; column: DimensionColumn; cases: Array<{ value: string; pattern: string }>; else: string }
  | { name: string; kind: "set"; column: DimensionColumn; cases: Array<{ value: string; values: string[] }>; else: string }
  | { name: string; kind: "present"; column: DimensionColumn; present: string; absent: string }
  | { name: string; kind: "hash_parity"; column: DimensionColumn; even: string; odd: string };

function isColumn(v: unknown): v is DimensionColumn {
  return typeof v === "string" && (DIMENSION_COLUMNS as readonly string[]).includes(v);
}

function isValue(v: unknown): v is string {
  return typeof v === "string" && VALUE.test(v);
}

function safePattern(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > 300) return false;
  try {
    new RegExp(p, "i");
  } catch {
    return false;
  }
  // No lookbehind, backreferences or nested quantifiers that could run away on a long title.
  return !/\(\?<|\\[1-9]|[+*}][+*?]|\)[+*{]/.test(p);
}

/** One dimension definition off a record; null when it is not well-formed. Malformed is not a guess: it is "not there". */
export function parseDimension(value: unknown): Dimension | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const name = o.name;
  if (typeof name !== "string" || !NAME.test(name) || (BUILT_IN_DIMENSIONS as readonly string[]).includes(name)) return null;
  if (!isColumn(o.column)) return null;
  const column = o.column;
  switch (o.kind) {
    case "match": {
      if (!Array.isArray(o.cases) || o.cases.length === 0 || !isValue(o.else)) return null;
      const cases: Array<{ value: string; pattern: string }> = [];
      for (const c of o.cases) {
        const cc = c as Record<string, unknown>;
        if (!cc || typeof cc !== "object" || !isValue(cc.value) || !safePattern(cc.pattern)) return null;
        cases.push({ value: cc.value, pattern: cc.pattern });
      }
      return { name, kind: "match", column, cases, else: o.else };
    }
    case "set": {
      if (!Array.isArray(o.cases) || o.cases.length === 0 || !isValue(o.else)) return null;
      const cases: Array<{ value: string; values: string[] }> = [];
      for (const c of o.cases) {
        const cc = c as Record<string, unknown>;
        if (!cc || typeof cc !== "object" || !isValue(cc.value) || !Array.isArray(cc.values) || cc.values.length === 0 || !cc.values.every((v) => typeof v === "string" && v.length <= 60)) return null;
        cases.push({ value: cc.value, values: cc.values.map((v) => String(v)) });
      }
      return { name, kind: "set", column, cases, else: o.else };
    }
    case "present":
      if (!isValue(o.present) || !isValue(o.absent)) return null;
      return { name, kind: "present", column, present: o.present, absent: o.absent };
    case "hash_parity":
      if (!isValue(o.even) || !isValue(o.odd)) return null;
      return { name, kind: "hash_parity", column, even: o.even, odd: o.odd };
    default:
      return null;
  }
}

/** The `dimensions` array off a record. null when absent; an empty array means "present but not usable". */
export function parseDimensions(value: unknown): Dimension[] | null {
  if (value == null) return null;
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const raw = obj && "dimensions" in obj ? obj.dimensions : Array.isArray(value) ? value : null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Dimension[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const d = parseDimension(item);
    if (!d || seen.has(d.name)) return [];
    seen.add(d.name);
    out.push(d);
  }
  return out;
}

/** md5 parity the way the recorded build did it: ('x' || left(md5(lower(domain)), 8))::bit(32)::int % 2. */
export function md5Parity(value: string): "even" | "odd" {
  const hex = createHash("md5").update(value.trim().toLowerCase()).digest("hex").slice(0, 8);
  return (parseInt(hex, 16) & 1) === 0 ? "even" : "odd";
}

/** The value of one dimension for one row. Null when the column is empty and the kind cannot decide without it. */
export function computeDimension(def: Dimension, row: Record<string, string | null | undefined>): string | null {
  const raw = row[def.column];
  const v = raw == null ? "" : String(raw).trim();
  switch (def.kind) {
    case "match": {
      if (!v) return def.else;
      for (const c of def.cases) if (new RegExp(c.pattern, "i").test(v)) return c.value;
      return def.else;
    }
    case "set": {
      if (!v) return def.else;
      const low = v.toLowerCase();
      for (const c of def.cases) if (c.values.some((x) => x.trim().toLowerCase() === low)) return c.value;
      return def.else;
    }
    case "present":
      return v ? def.present : def.absent;
    case "hash_parity":
      return v ? (md5Parity(v) === "even" ? def.even : def.odd) : null;
  }
}

export function computeDimensions(defs: readonly Dimension[], row: Record<string, string | null | undefined>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const d of defs) out[d.name] = computeDimension(d, row);
  return out;
}

/** The value vocabulary each dimension can take, for the segments map and the pending-campaign card. */
export function dimensionSegments(defs: readonly Dimension[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of defs) {
    switch (d.kind) {
      case "match":
      case "set":
        out[d.name] = [...new Set([...d.cases.map((c) => c.value), d.else])];
        break;
      case "present":
        out[d.name] = [d.present, d.absent];
        break;
      case "hash_parity":
        out[d.name] = [d.even, d.odd];
        break;
    }
  }
  return out;
}
