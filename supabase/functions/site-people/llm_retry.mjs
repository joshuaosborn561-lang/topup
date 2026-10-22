// site-people LLM call policy (pure, no Deno APIs, so node tests can import it).
// 402/403 = key out of credit or not allowed: never retry, stop the whole call.
// 429/5xx/network: at most MAX_RETRIES retries with exponential backoff.
export const MAX_RETRIES = 2;
export const MAX_SITE_ATTEMPTS = 3;
export const LLM_UNAVAILABLE = 'llm_unavailable';

export class LlmUnavailable extends Error {
  constructor(status, detail = '') {
    super(`${LLM_UNAVAILABLE}: gemini ${status}${detail ? ' ' + detail : ''}`);
    this.name = 'LlmUnavailable';
    this.status = status;
  }
}

export function classify(status) {
  if (status === 402 || status === 403) return 'fatal';
  if (status === 429 || status >= 500 || status === 0) return 'retry';
  if (status >= 200 && status < 300) return 'ok';
  return 'error';
}

export function backoffMs(retry, rand = Math.random) {
  const exp = Math.min(16000, 1000 * 2 ** retry);
  return exp + Math.floor(rand() * exp * 0.25);
}

// doFetch() -> { status, json }. Throws LlmUnavailable on 402/403, Error otherwise.
export async function callWithRetry(doFetch, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), rand = Math.random, maxRetries = MAX_RETRIES } = {}) {
  let last = 'gemini failed';
  for (let i = 0; i <= maxRetries; i++) {
    let res;
    try { res = await doFetch(); } catch (e) { res = { status: 0, json: {}, err: String(e).slice(0, 120) }; }
    const kind = classify(res.status);
    if (kind === 'ok') return res.json;
    if (kind === 'fatal') throw new LlmUnavailable(res.status, JSON.stringify(res.json ?? {}).slice(0, 160));
    if (kind === 'error') throw new Error(`gemini ${res.status} ${JSON.stringify(res.json ?? {}).slice(0, 200)}`);
    last = res.status ? `gemini ${res.status}` : `gemini network ${res.err ?? ''}`;
    if (i < maxRetries) await sleep(backoffMs(i, rand));
  }
  throw new Error(last);
}
