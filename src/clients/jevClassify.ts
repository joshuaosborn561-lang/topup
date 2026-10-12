import type { Queryable } from "../db/pool.js";
import { leftoverJevBody, parseLeftoverChoice } from "../replies/leftoverPrompt.js";
import type { NegativeClass } from "../replies/classify.js";

/**
 * D90 — Jev via OpenRouter Decisions, the same provider icp-llm / site_check
 * already uses (vault `openrouter_api_key`, model ICP_JEV_MODEL). No new vendor.
 * Key via topup.jev_openrouter_key() (D91). Never SELECT vault.
 * Returns a class or null. Never logs the body or the key.
 */

export const OPENROUTER_VAULT_SECRET = "openrouter_api_key";
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

export interface JevClassify {
  classify(body: string): Promise<{ class: NegativeClass | null }>;
}

export async function loadOpenRouterKey(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ s: string | null }>(`select topup.jev_openrouter_key() as s`);
  const s = (rows[0]?.s ?? "").trim();
  if (!s) throw new Error("topup.jev_openrouter_key() is empty; icp-llm uses the same secret. Ask Josh.");
  return s;
}

export class JevClassifyClient implements JevClassify {
  private cachedKey: string | null = null;

  constructor(
    private readonly opts: {
      loadKey: () => Promise<string>;
      model: string;
      fetchImpl?: typeof fetch;
      url?: string;
    },
  ) {}

  async classify(body: string): Promise<{ class: NegativeClass | null }> {
    const key = this.cachedKey ?? (this.cachedKey = await this.opts.loadKey());
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = this.opts.url ?? OPENROUTER_DECISIONS_URL;
    let last = "jev leftover classify failed";
    for (const wait of [0, 3000, 10_000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(leftoverJevBody(this.opts.model, body)),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 429 || res.status >= 500) {
        last = `jev ${res.status}`;
        continue;
      }
      if (!res.ok) throw new Error(`jev ${res.status}`.slice(0, 80));
      return { class: parseLeftoverChoice(json) };
    }
    throw new Error(last);
  }
}
