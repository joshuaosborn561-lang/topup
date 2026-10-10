import { withBackoff } from "../lib/backoff.js";
import type { FetchResult, GradeResult } from "./icpGate.js";

/**
 * The site-people edge function on campaignintelligence (D72, D73; the
 * `people` question of site_check). Three modes over topup.site_people_text:
 * `fetch` reads the homepage plus up to six people pages (team, leadership,
 * staff, about, our story, contact) and the schema.org people on them;
 * `extract` has Gemini (Josh's key) list every person the site presents
 * into topup.site_people, one extraction row per domain; `ask` has Jev
 * pick which of them is what we are looking for, one answer row per domain
 * and question in topup.site_answers. Every call returns counts. Nothing
 * here returns a page or a person. Fetch, extract and ask all claim rows
 * (SKIP LOCKED) so the service can fan the calls out.
 */
export interface ExtractResult extends GradeResult {
  people: number;
}

export interface AskResult extends GradeResult {
  found: number;
  nobody_listed: number;
}

export interface SitePeople {
  /** One call fetches up to n sites with w parallel workers. Many calls may run side by side (rows are claimed). */
  fetchSites(batch: string, n: number, w: number): Promise<FetchResult>;
  /** One call extracts the people of up to n fetched sites. Many calls may run side by side (rows are claimed). */
  extract(batch: string, model: string, n: number, w: number): Promise<ExtractResult>;
  /** One call asks Jev, for up to n extracted sites, which person is `lookingFor`. Many calls may run side by side (rows are claimed). */
  ask(batch: string, lookingFor: string, model: string, n: number, w: number): Promise<AskResult>;
}

export function geminiModel(name: string): string {
  return `gemini:${name}`;
}

export function jevPickModel(openrouterId: string): string {
  return `jev:${openrouterId}`;
}

export class SitePeopleClient implements SitePeople {
  constructor(
    private readonly functionsUrl: string,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 130_000,
    private readonly hostCap = 2,
  ) {}

  private async call<T>(params: Record<string, string | number>): Promise<T> {
    if (!this.functionsUrl || !this.key) throw new Error("missing credentials for site-people");
    const u = new URL(`${this.functionsUrl.replace(/\/$/, "")}/site-people`);
    u.searchParams.set("k", this.key);
    u.searchParams.set("host", String(this.hostCap));
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(u.toString(), { method: "POST", signal: c.signal });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.ok === false) throw new Error(`site-people ${res.status}: ${String(body.error ?? "")}`.slice(0, 200));
      return body as T;
    } finally {
      clearTimeout(t);
    }
  }

  private once<T>(params: Record<string, string | number>): Promise<T> {
    return withBackoff(() => this.call<T>(params));
  }

  async fetchSites(batch: string, n: number, w: number): Promise<FetchResult> {
    const r = await this.once<Partial<FetchResult>>({ mode: "fetch", batch, n, w });
    return { processed: Number(r.processed ?? 0), ok: Number(r.ok ?? 0), released: Number(r.released ?? 0), remaining: Number(r.remaining ?? 0) };
  }

  async extract(batch: string, model: string, n: number, w: number): Promise<ExtractResult> {
    const r = await this.once<Partial<ExtractResult>>({ mode: "extract", batch, model, n, w });
    return { processed: Number(r.processed ?? 0), errors: Number(r.errors ?? 0), last_error: r.last_error == null ? null : String(r.last_error), remaining: Number(r.remaining ?? 0), people: Number(r.people ?? 0) };
  }

  async ask(batch: string, lookingFor: string, model: string, n: number, w: number): Promise<AskResult> {
    const r = await this.once<Partial<AskResult>>({ mode: "ask", batch, looking_for: lookingFor, model, n, w });
    return { processed: Number(r.processed ?? 0), errors: Number(r.errors ?? 0), last_error: r.last_error == null ? null : String(r.last_error), remaining: Number(r.remaining ?? 0), found: Number(r.found ?? 0), nobody_listed: Number(r.nobody_listed ?? 0) };
  }
}
