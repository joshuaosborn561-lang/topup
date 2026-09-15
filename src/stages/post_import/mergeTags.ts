/**
 * Port of skills/smartlead-campaign-settings/scripts/check_merge_tags.py.
 * Pure: tags out of the sequence copy, coverage out of our own staged rows,
 * verdicts exactly as the script gives them. The script sampled leads with
 * list_campaign_leads; this service never calls that (D6), so coverage is
 * measured on the rows this run staged, mapped to the keys the import job
 * posts (system fields, plus the custom fields Local_Sports_Team, vendor,
 * job_title — docs/servers.md §10).
 */

export const TAG = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export const SYSTEM_FIELDS: ReadonlySet<string> = new Set(["email", "first_name", "last_name", "company_name", "phone_number", "website", "location", "linkedin_profile", "company_url"]);

export const KNOWN_BAD: Readonly<Record<string, string>> = {
  company: "company_name",
  companyname: "company_name",
  firstname: "first_name",
  lastname: "last_name",
  first: "first_name",
  fname: "first_name",
  phone: "phone_number",
  city: "location",
};

/** The custom field keys the Smartlead import job posts, exactly as typed. Anything else in copy is on zero leads. */
export const CUSTOM_FIELDS_POSTED: readonly string[] = ["Local_Sports_Team", "vendor", "job_title"];

export interface SequenceLike {
  subject?: string | null;
  body?: string | null;
  variants?: Array<{ subject?: string | null; body?: string | null }> | null;
}

/** Tag name → the places it appears ("step 2", "step 1, variant B"). */
export function collectTags(steps: readonly SequenceLike[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (tag: string, where: string) => {
    const s = found.get(tag) ?? new Set<string>();
    s.add(where);
    found.set(tag, s);
  };
  steps.forEach((step, i) => {
    const variants = step.variants ?? [];
    if (variants.length) {
      variants.forEach((v, j) => {
        const label = `step ${i + 1}, variant ${String.fromCharCode(65 + j)}`;
        for (const t of tagsIn(`${v.subject ?? ""}\n${v.body ?? ""}`)) add(t, label);
      });
    } else {
      for (const t of tagsIn(`${step.subject ?? ""}\n${step.body ?? ""}`)) add(t, `step ${i + 1}`);
    }
  });
  return found;
}

export function tagsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG)) out.push(m[1]);
  return out;
}

export function normKey(s: string): string {
  return s.replace(/[\s_-]+/g, "").toLowerCase();
}

export function nearMiss(tag: string, keys: Iterable<string>): string | null {
  const target = normKey(tag);
  for (const k of keys) if (k !== tag && normKey(k) === target) return k;
  return null;
}

export interface Coverage {
  /** field key → rows with a non-empty value */
  present: Record<string, number>;
  total: number;
}

export interface MergeTagReport {
  ok: boolean;
  total: number;
  tags: number;
  fails: string[];
  warns: string[];
  oks: string[];
  unusedFields: string[];
}

/** The script's verdicts, verbatim in spirit: KNOWN_BAD fails; a system field under coverage warns; a custom field under 100% fails; zero coverage is the Goliath failure. */
export function checkMergeTags(tags: Map<string, Set<string>>, coverage: Coverage, minCoveragePct = 100): MergeTagReport {
  const fails: string[] = [];
  const warns: string[] = [];
  const oks: string[] = [];
  // As in the script, only fields actually carried by at least one lead count as "present" for near misses and unused fields.
  const carried = Object.keys(coverage.present).filter((k) => (coverage.present[k] ?? 0) > 0);
  if (coverage.total === 0) {
    return { ok: false, total: 0, tags: tags.size, fails: ["lead sample is empty. Cannot verify coverage."], warns, oks, unusedFields: [] };
  }
  for (const tag of [...tags.keys()].sort()) {
    const where = [...tags.get(tag)!].sort().join(", ");
    const low = tag.toLowerCase();
    if (low in KNOWN_BAD) {
      fails.push(`{{${tag}}} is not a Smartlead field. Use {{${KNOWN_BAD[low]}}} instead. [${where}]`);
      continue;
    }
    const present = coverage.present[tag] ?? 0;
    const pct = (100 * present) / coverage.total;
    if (SYSTEM_FIELDS.has(tag)) {
      if (pct < minCoveragePct) warns.push(`{{${tag}}} system field, only ${pct.toFixed(1)}% populated (${present}/${coverage.total})`);
      else oks.push(`{{${tag}}} system field, ${pct.toFixed(0)}%`);
      continue;
    }
    if (present === 0) {
      const near = nearMiss(tag, carried);
      fails.push(
        near
          ? `{{${tag}}} matches nothing, but the leads carry '${near}'. Custom field names are case and underscore sensitive, exactly as typed into the Smartlead UI. Use {{${near}}} or rename the field. [${where}]`
          : `{{${tag}}} appears in copy but is on ZERO staged leads. This is the Goliath failure. [${where}]`,
      );
    } else if (pct < minCoveragePct) {
      fails.push(`{{${tag}}} only ${pct.toFixed(1)}% populated (${present}/${coverage.total}). ${coverage.total - present} leads would send a blank line. [${where}]`);
    } else {
      oks.push(`{{${tag}}} custom field, ${pct.toFixed(0)}%`);
    }
  }
  const unusedFields = carried.filter((k) => !tags.has(k) && !SYSTEM_FIELDS.has(k)).sort();
  return { ok: fails.length === 0, total: coverage.total, tags: tags.size, fails, warns, oks, unusedFields };
}

/** One line for a thread or receipt. */
export function mergeTagSummary(r: MergeTagReport): string {
  if (r.ok) return `all ${r.tags} tags resolve on ${r.total} staged leads${r.warns.length ? ` (warn: ${r.warns.join("; ")})` : ""}`;
  return `FAIL — ${r.fails.join(" ")}${r.warns.length ? ` (warn: ${r.warns.join("; ")})` : ""}`;
}
