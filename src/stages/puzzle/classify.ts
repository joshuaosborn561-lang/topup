/**
 * Puzzle pieces (skills domain-waterfall, people-waterfall, unresolved-name-routing,
 * leadgen-mcp-routing stages 2–3). A row is classified by what it still lacks
 * so the next call is the right MCP, not a guess.
 *
 *   name, no domain  → Domain Finder Waterfall
 *   domain, no name  → Find Named Person / people-waterfall
 *   name + domain, no email → Name to Email, then Email Finder Waterfall
 *   name + email     → ready for verify
 */

export type PuzzleNeed = "ready" | "needs_domain" | "needs_person" | "needs_email" | "empty";

export interface PuzzleRow {
  first_name?: string | null;
  last_name?: string | null;
  domain?: string | null;
  company_domain?: string | null;
  email?: string | null;
  company_name?: string | null;
}

function present(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/** Domain on the row, or the host of an address already there. Never invents one. */
export function rowDomain(row: PuzzleRow): string | null {
  const raw = row.domain ?? row.company_domain;
  if (present(raw)) return raw!.trim().toLowerCase();
  if (present(row.email) && row.email!.includes("@")) {
    const host = row.email!.split("@")[1]?.trim().toLowerCase();
    return host || null;
  }
  return null;
}

export function rowHasName(row: PuzzleRow): boolean {
  return present(row.first_name) || present(row.last_name);
}

export function classifyPuzzle(row: PuzzleRow): PuzzleNeed {
  const email = present(row.email);
  const name = rowHasName(row);
  const domain = rowDomain(row);
  if (email && name) return "ready";
  if (name && !domain) return "needs_domain";
  if (domain && !name) return "needs_person";
  if (name && domain && !email) return "needs_email";
  return "empty";
}

/** SQL expression for the domain column a LeadPipe table actually has. */
export function domainSql(cols: Set<string>): string {
  const parts: string[] = [];
  if (cols.has("company_domain")) parts.push("nullif(btrim(company_domain), '')");
  if (cols.has("domain")) parts.push("nullif(btrim(domain), '')");
  if (cols.has("website")) parts.push("nullif(btrim(website), '')");
  if (cols.has("email")) parts.push("nullif(split_part(email, '@', 2), '')");
  return parts.length ? `lower(coalesce(${parts.join(", ")}))` : "null";
}

export function nameSql(): string {
  return "(coalesce(btrim(first_name), '') <> '' or coalesce(btrim(last_name), '') <> '')";
}
