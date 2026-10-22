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

// ---- Big pages: chunk, extract per chunk, merge. Never drop people. ----
export const CHUNK_CHARS = 25000;
export const CHUNK_OVERLAP = 800;
export const MAX_CHUNKS = 12;
export const FAILURE_KINDS = ['fetch_failed', 'truncated', 'bad_json', 'llm_unavailable', 'other'];

export class ChunkFailure extends Error {
  constructor(kind, msg) { super(msg ?? `gemini ${kind}`); this.kind = kind; }
}

// Split on paragraph, then line, boundaries near `size`; consecutive chunks share `overlap` chars.
export function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const s = String(text ?? '');
  if (s.length <= size) return [s];
  const out = [];
  let start = 0;
  while (start < s.length) {
    let end = Math.min(s.length, start + size);
    if (end < s.length) {
      const win = s.slice(start + Math.floor(size * 0.6), end);
      const para = win.lastIndexOf('\n\n'); const line = win.lastIndexOf('\n');
      const cut = para >= 0 ? para : line;
      if (cut >= 0) end = start + Math.floor(size * 0.6) + cut + 1;
    }
    out.push(s.slice(start, end));
    if (end >= s.length) break;
    // overlap starts on a line boundary so no half lines (half names) are sent
    let ns = end - overlap; const nl = s.indexOf('\n', ns); ns = nl >= 0 && nl < end ? nl + 1 : ns;
    start = Math.max(ns, start + 1);
  }
  return out;
}

export function halve(text) {
  const mid = Math.floor(text.length / 2);
  const nl = text.lastIndexOf('\n', mid);
  const cut = nl > text.length * 0.25 ? nl + 1 : mid;
  const o = Math.min(CHUNK_OVERLAP, Math.floor(text.length / 10));
  return [text.slice(0, cut), text.slice(Math.max(0, cut - o))];
}

const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
// Same name + same title (or same email in evidence, or one side untitled) = same person.
export function mergePeople(lists) {
  const out = [];
  for (const list of lists) for (const p of list ?? []) {
    const n = norm(p.name); if (!n) continue;
    const t = norm(p.title); const em = (String(p.evidence ?? '').match(/[\w.+-]+@[\w-]+\.[\w.]+/) ?? [])[0]?.toLowerCase() ?? '';
    const hit = out.find((q) => q._n === n && (q._t === t || !q._t || !t || q._t === 'no title given' || t === 'no title given' || (em && q._em === em)));
    if (hit) { if ((!hit._t || hit._t === 'no title given') && t) { hit.title = p.title; hit._t = t; } hit.evidence = hit.evidence ?? p.evidence; hit.page = hit.page ?? p.page; if (!hit._em) hit._em = em; continue; }
    out.push({ ...p, _n: n, _t: t, _em: em });
  }
  return out.map(({ _n, _t, _em, ...p }) => p);
}

// callChunk(text) -> { people, org_name, org_type, in_tok, out_tok }; throws ChunkFailure(kind) or LlmUnavailable.
// Truncated / bad JSON chunk: split in half and retry each half once. Calls are capped at maxChunks.
export async function extractChunks(text, callChunk, { size = CHUNK_CHARS, overlap = CHUNK_OVERLAP, maxChunks = MAX_CHUNKS } = {}) {
  const queue = chunkText(text, size, overlap).map((t) => ({ t, retry: false }));
  const lists = []; let calls = 0, capped = false, failure = null, inTok = 0, outTok = 0, org_name = null, org_type = null;
  while (queue.length) {
    if (calls >= maxChunks) { capped = true; break; }
    const c = queue.shift(); calls++;
    try {
      const r = await callChunk(c.t);
      lists.push(r.people); inTok += r.in_tok ?? 0; outTok += r.out_tok ?? 0;
      org_name = org_name ?? r.org_name; if (!org_type || org_type === 'unknown') org_type = r.org_type;
    } catch (e) {
      if (e instanceof LlmUnavailable) { e.partial = { lists, calls }; throw e; }
      const kind = e instanceof ChunkFailure ? e.kind : 'other';
      if ((kind === 'truncated' || kind === 'bad_json') && !c.retry && c.t.length > 2000) { queue.unshift(...halve(c.t).map((t) => ({ t, retry: true }))); continue; }
      failure = failure ?? { kind, msg: String(e.message ?? e).slice(0, 200) };
    }
  }
  return { people: mergePeople(lists), org_name, org_type: org_type ?? 'unknown', in_tok: inTok, out_tok: outTok, chunks: calls, capped, failure };
}
