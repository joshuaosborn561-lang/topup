import { headerKey, HEADER_ALIASES } from "../../jobs/preflight.js";
import { parseCsvRows } from "../../lib/parseCsv.js";

/**
 * D103 — people a vendor export names without an email. LeadPipe drops a
 * row with no address; the email finder needs exactly those rows. The
 * service reads the same file server to server and keeps each person who
 * has a first name, a last name and a company (domain or name). Nothing
 * here is logged or returned to chat; callers get rows to insert and counts.
 */
export interface NoEmailPerson {
  first_name: string;
  last_name: string;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  employee_range: string | null;
}

export interface NoEmailScan {
  rows: number;
  with_email: number;
  without_email: number;
  kept: NoEmailPerson[];
  no_name: number;
  no_company: number;
  duplicates: number;
}

/** Extra file names for the columns the finder needs, beyond LeadPipe's aliases. */
const EXTRA: Readonly<Record<string, readonly string[]>> = {
  company_domain: ["current_employer_website", "employer_website", "organization_website"],
  company_name: ["current_employer"],
  city: ["contact_city"],
  state: ["contact_state"],
  industry: ["main_industry"],
};

/** A bare host from a domain or a URL: lower case, no scheme, no www., no path. Null when it is not a host. */
export function hostOf(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#\s]/)[0] ?? "";
  s = s.replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/** Which column index holds each lane field, by the file's own header. */
export function headerIndex(header: string[]): Record<string, number> {
  const keys = header.map(headerKey);
  const at = (names: readonly string[]): number => {
    for (const n of names) {
      const i = keys.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const out: Record<string, number> = {};
  for (const field of ["email", "first_name", "last_name", "title", "company_name", "company_domain", "city", "state", "industry", "employee_range"]) {
    out[field] = at([field, ...(HEADER_ALIASES[field] ?? []), ...(EXTRA[field] ?? [])]);
  }
  return out;
}

/** Read a CSV's text and keep the people with no email the finder can look up. One per name and company. */
export function peopleWithoutEmail(text: string): NoEmailScan {
  const table = parseCsvRows(text);
  const header = table[0] ?? [];
  const idx = headerIndex(header);
  // A blank company_domain falls back to the employer's website column, in the order the aliases name them.
  const keys = header.map(headerKey);
  const domainCols = ["company_domain", ...(HEADER_ALIASES.company_domain ?? []), ...(EXTRA.company_domain ?? [])].map((n) => keys.indexOf(n)).filter((i) => i >= 0);
  const get = (row: string[], field: string): string | null => {
    const i = idx[field] ?? -1;
    if (i < 0) return null;
    const v = (row[i] ?? "").trim();
    return v ? v : null;
  };
  const scan: NoEmailScan = { rows: 0, with_email: 0, without_email: 0, kept: [], no_name: 0, no_company: 0, duplicates: 0 };
  const seen = new Set<string>();
  for (const row of table.slice(1)) {
    scan.rows += 1;
    const email = get(row, "email");
    if (email && email.includes("@")) {
      scan.with_email += 1;
      continue;
    }
    scan.without_email += 1;
    const first = get(row, "first_name");
    const last = get(row, "last_name");
    if (!first || !last) {
      scan.no_name += 1;
      continue;
    }
    let domain: string | null = null;
    for (const i of domainCols) {
      domain = hostOf(row[i]);
      if (domain) break;
    }
    const company = get(row, "company_name");
    if (!domain && !company) {
      scan.no_company += 1;
      continue;
    }
    const key = `${first.toLowerCase()}|${last.toLowerCase()}|${domain ?? (company ?? "").toLowerCase()}`;
    if (seen.has(key)) {
      scan.duplicates += 1;
      continue;
    }
    seen.add(key);
    scan.kept.push({
      first_name: first,
      last_name: last,
      title: get(row, "title"),
      company_name: company,
      company_domain: domain,
      city: get(row, "city"),
      state: get(row, "state"),
      industry: get(row, "industry"),
      employee_range: get(row, "employee_range"),
    });
  }
  return scan;
}
