/**
 * The ICP gate's three edge functions on campaignintelligence (D60; skill
 * icp-website-gate): icp-site-fetch reads the homepage and two subpages
 * into client_salesglider.icp_site_text; icp-llm has Jev pick a category
 * per site and writes icp_llm_results; icp-disco-fallback asks DiscoLike
 * about the sites our fetch could not read. icp-llm's `people` mode (D71)
 * answers the owners question for the people queued in
 * topup.site_check_people. Every call returns counts. Nothing here returns
 * a row, a page, a person or a verdict for one domain.
 */
export interface FetchResult {
  processed: number;
  ok: number;
  released: number;
  remaining: number;
}

export interface GradeResult {
  processed: number;
  errors: number;
  last_error: string | null;
  remaining: number;
}

export interface IcpGate {
  /** One call fetches up to n sites with w parallel workers and returns how many of the batch are still unfetched. Up to three calls side by side. */
  fetchSites(batch: string, n: number, w: number): Promise<FetchResult>;
  /** One call grades up to n fetched sites. ONE call at a time per batch: it does not claim rows. */
  grade(batch: string, model: string, n: number, w: number): Promise<GradeResult>;
  /** One call answers the owners question for up to n queued people in topup.site_check_people whose site was fetched (D71). One call at a time per batch. */
  gradePeople(batch: string, model: string, n: number, w: number): Promise<GradeResult>;
  /** Submit the unreadable sites of the batch to DiscoLike. task_id null when there are none. */
  discoSubmit(batch: string, icp: string): Promise<{ task_id: string | null; domains: number }>;
  /** Poll a DiscoLike task; the verdicts land in icp_llm_results as model discolike:website when completed. */
  discoCollect(task: string, batch: string): Promise<{ status: string; tally?: Record<string, number> }>;
}

export const JEV_MODEL_PREFIX = "jev:";

/** The `model` string icp-llm expects and writes: jev:<openrouter id>|<variant>. */
export function jevModel(openrouterId: string, variant: string): string {
  return `${JEV_MODEL_PREFIX}${openrouterId}|${variant}`;
}

export class IcpGateClient implements IcpGate {
  constructor(
    private readonly functionsUrl: string,
    private readonly keys: { fetch: string; llm: string; disco: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 130_000,
  ) {}

  private async call<T>(fn: string, key: string, params: Record<string, string | number>): Promise<T> {
    if (!this.functionsUrl || !key) throw new Error(`missing credentials for ${fn}`);
    const u = new URL(`${this.functionsUrl.replace(/\/$/, "")}/${fn}`);
    u.searchParams.set("k", key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(u.toString(), { method: "POST", signal: c.signal });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.ok === false) throw new Error(`${fn} ${res.status}: ${String(body.error ?? body.body ?? "")}`.slice(0, 200));
      return body as T;
    } finally {
      clearTimeout(t);
    }
  }

  async fetchSites(batch: string, n: number, w: number): Promise<FetchResult> {
    const r = await this.call<Partial<FetchResult>>("icp-site-fetch", this.keys.fetch, { batch, n, w });
    return { processed: Number(r.processed ?? 0), ok: Number(r.ok ?? 0), released: Number(r.released ?? 0), remaining: Number(r.remaining ?? 0) };
  }

  async grade(batch: string, model: string, n: number, w: number): Promise<GradeResult> {
    const r = await this.call<Partial<GradeResult>>("icp-llm", this.keys.llm, { mode: "run", batch, model, n, w });
    return { processed: Number(r.processed ?? 0), errors: Number(r.errors ?? 0), last_error: r.last_error == null ? null : String(r.last_error), remaining: Number(r.remaining ?? 0) };
  }

  async gradePeople(batch: string, model: string, n: number, w: number): Promise<GradeResult> {
    const r = await this.call<Partial<GradeResult>>("icp-llm", this.keys.llm, { mode: "people", batch, model, n, w });
    return { processed: Number(r.processed ?? 0), errors: Number(r.errors ?? 0), last_error: r.last_error == null ? null : String(r.last_error), remaining: Number(r.remaining ?? 0) };
  }

  async discoSubmit(batch: string, icp: string): Promise<{ task_id: string | null; domains: number }> {
    const r = await this.call<{ task_id?: string; domains?: number; submitted?: number }>("icp-disco-fallback", this.keys.disco, { mode: "submit", batch, icp });
    return { task_id: r.task_id ?? null, domains: Number(r.domains ?? r.submitted ?? 0) };
  }

  async discoCollect(task: string, batch: string): Promise<{ status: string; tally?: Record<string, number> }> {
    const r = await this.call<{ status?: string; tally?: Record<string, number> }>("icp-disco-fallback", this.keys.disco, { mode: "collect", task, batch });
    return { status: String(r.status ?? "unknown"), ...(r.tally ? { tally: r.tally } : {}) };
  }
}
