import { McpHttpClient } from "./mcpHttp.js";

/**
 * Name to Email (docs/servers.md §8). First stop on stage 3 (leadgen-mcp-routing).
 *
 * Only `verify_person` is called. `start_run` takes inline people[] and
 * `export_run` returns an unbounded CSV — both are refused (D2, D22).
 * Catch-all confirmations on this server are written status="valid" with
 * domain_is_catchall=true; a caller that filters on valid must also reject
 * that flag.
 */
export interface PersonLookup {
  first_name: string;
  last_name: string;
  domain: string;
}

export interface PersonResult {
  status: string;
  domain_is_catchall: boolean;
  /** Present when the finder produced an address. Never logged. */
  email: string | null;
}

export interface NameToEmail {
  verifyPerson(p: PersonLookup): Promise<PersonResult>;
}

export class NameToEmailClient implements NameToEmail {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  private ready(): void {
    if (!this.url) throw new Error("NAME_TO_EMAIL_MCP_URL is not configured");
  }

  async verifyPerson(p: PersonLookup): Promise<PersonResult> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("verify_person", {
      first_name: p.first_name,
      last_name: p.last_name,
      domain: p.domain,
    });
    const status = String(res.status ?? "").toLowerCase();
    const catchall = Boolean(res.domain_is_catchall ?? res.catchall ?? false);
    const email = typeof res.email === "string" && res.email.includes("@") ? res.email : null;
    return { status, domain_is_catchall: catchall, email };
  }
}

/** Catch-all is never mixed into valid (the server's own instruction; the code currently violates it). */
export function nameToEmailSendable(r: PersonResult): boolean {
  if (!r.email) return false;
  if (r.domain_is_catchall) return false;
  return r.status === "valid" || r.status === "ok" || r.status === "deliverable";
}
