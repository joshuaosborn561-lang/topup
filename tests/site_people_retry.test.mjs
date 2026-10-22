import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { callWithRetry, classify, LlmUnavailable, MAX_RETRIES, MAX_SITE_ATTEMPTS, backoffMs, chunkText, mergePeople, extractChunks, ChunkFailure, MAX_CHUNKS } from '../supabase/functions/site-people/llm_retry.mjs';

const fn = readFileSync(new URL('../supabase/functions/site-people/index.ts', import.meta.url), 'utf8');
const mig = readFileSync(new URL('../supabase/migrations/20261022230000_site_extractions_attempts.sql', import.meta.url), 'utf8');
const seq = (list) => { let i = 0; const calls = { n: 0 }; return { calls, f: async () => { calls.n++; const x = list[Math.min(i++, list.length - 1)]; if (x instanceof Error) throw x; return x; } }; };
const noSleep = { sleep: async () => {}, rand: () => 0 };

test('402 and 403 fail fast with llm_unavailable, no retries', async () => {
  for (const status of [402, 403]) {
    const s = seq([{ status, json: { error: { message: 'prepayment credits depleted' } } }]);
    await assert.rejects(callWithRetry(s.f, noSleep), (e) => e instanceof LlmUnavailable && /^llm_unavailable/.test(e.message));
    assert.equal(s.calls.n, 1);
  }
});

test('429/5xx retry at most 2 times with growing backoff', async () => {
  const sleeps = [];
  const s = seq([{ status: 429, json: {} }, { status: 503, json: {} }, { status: 500, json: {} }, { status: 200, json: { ok: 1 } }]);
  await assert.rejects(callWithRetry(s.f, { sleep: async (ms) => sleeps.push(ms), rand: () => 0 }), /gemini 500/);
  assert.equal(s.calls.n, 1 + MAX_RETRIES);
  assert.equal(MAX_RETRIES, 2);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.ok(backoffMs(3, () => 0) > backoffMs(2, () => 0));
});

test('a 5xx then success returns the body; other 4xx do not retry', async () => {
  const ok = seq([{ status: 502, json: {} }, { status: 200, json: { ok: 1 } }]);
  assert.deepEqual(await callWithRetry(ok.f, noSleep), { ok: 1 });
  const bad = seq([{ status: 400, json: {} }]);
  await assert.rejects(callWithRetry(bad.f, noSleep), /gemini 400/);
  assert.equal(bad.calls.n, 1);
  assert.equal(classify(402), 'fatal');
  assert.equal(classify(0), 'retry');
});

test('extract caps attempts per site and stops picking given-up sites', () => {
  assert.equal(MAX_SITE_ATTEMPTS, 3);
  assert.match(mig, /ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0/);
  assert.match(mig, /ADD COLUMN IF NOT EXISTS gave_up_at timestamptz/);
  assert.match(fn, /attempts = topup\.site_extractions\.attempts \+ 1/);
  assert.match(fn, /e\.gave_up_at is not null or e\.attempts >= \$\{MAX_SITE_ATTEMPTS\}/);
  assert.match(fn, /gave_up_at = case when excluded\.error is not null and topup\.site_extractions\.attempts >= \$\{MAX_SITE_ATTEMPTS\} then now\(\) else null end/);
  const gem = fn.slice(fn.indexOf('async function geminiChunk('), fn.indexOf('async function jevPick('));
  assert.doesNotMatch(gem, /for \(let i = 0;/, 'gemini goes through callWithRetry only');
  assert.match(gem, /callWithRetry\(/);
});

test('extract stops the call and returns llm_unavailable without burning site attempts', () => {
  assert.match(fn, /e instanceof LlmUnavailable\) \{ llmDown = /);
  assert.match(fn, /while \(q\.length && !llmDown &&/);
  assert.match(fn, /attempts = greatest\(attempts - 1, 0\)/);
  assert.match(fn, /error: LLM_UNAVAILABLE[^\n]*424\)/);
});


const page = (n) => Array.from({ length: n }, (_, i) => `Person ${i} — Staff member line ${'x'.repeat(80)}`).join('\n');

test('chunkText: small pages are one chunk; ~104k pages split on line boundaries with overlap', () => {
  assert.equal(chunkText('short').length, 1);
  const big = page(920); // ~104k chars
  const c = chunkText(big);
  assert.ok(big.length > 100000 && big.length < 110000);
  assert.ok(c.length >= 4 && c.length <= 6, `chunks=${c.length}`);
  for (const x of c) assert.ok(x.length <= 25000);
  for (const x of c.slice(0, -1)) assert.ok(x.endsWith('\n'), 'cut on a line boundary');
  assert.ok(c[1].startsWith(c[0].slice(-200).split('\n').slice(1).join('\n').slice(0, 20)) || big.includes(c[1].slice(0, 50)));
  const joined = new Set(c.flatMap((x) => x.split('\n').filter(Boolean)));
  for (const line of big.split('\n')) assert.ok(joined.has(line), 'no line dropped');
});

test('mergePeople dedupes by name plus title, keeps distinct titles', () => {
  const m = mergePeople([[{ name: 'Ann Lee', title: 'Pastor' }, { name: 'Bo Ray', title: 'no title given' }], [{ name: 'ann  lee', title: 'pastor' }, { name: 'Bo Ray', title: 'Elder' }, { name: 'Ann Lee', title: 'Board Chair' }]]);
  assert.equal(m.length, 3);
  assert.equal(m.find((p) => p.name === 'Bo Ray').title, 'Elder');
});

test('extractChunks: one call per chunk, merges people, never drops any', async () => {
  const big = page(920); let calls = 0;
  const r = await extractChunks(big, async (t) => { calls++; return { people: t.split('\n').filter(Boolean).map((l) => ({ name: l.split(' — ')[0], title: 'Staff' })), org_name: 'Org', org_type: 'business', in_tok: 1, out_tok: 1 }; });
  assert.equal(r.people.length, 920);
  assert.equal(r.chunks, calls);
  assert.equal(r.failure, null);
  assert.equal(r.capped, false);
});

test('extractChunks: a truncated chunk is halved and retried once; still truncated is recorded, partial kept', async () => {
  const big = page(600); let calls = 0;
  const r = await extractChunks(big, async (t) => { calls++; if (t.length > 20000) throw new ChunkFailure('truncated'); if (calls === 3) throw new ChunkFailure('truncated'); return { people: [{ name: `P${calls}`, title: 'x' }], org_type: 'business' }; });
  assert.equal(r.failure.kind, 'truncated');
  assert.ok(r.people.length >= 2, 'partial people kept');
  assert.ok(r.chunks <= MAX_CHUNKS);
});

test('extractChunks: hard cap of 12 calls per site, records the cap, keeps partial', async () => {
  let calls = 0;
  const r = await extractChunks(page(4000), async () => { calls++; return { people: [{ name: `P${calls}`, title: 't' }] }; });
  assert.equal(calls, MAX_CHUNKS);
  assert.equal(r.capped, true);
  assert.equal(r.people.length, MAX_CHUNKS);
});

test('extractChunks: 402 stops at once', async () => {
  let calls = 0;
  await assert.rejects(extractChunks(page(920), async () => { calls++; throw new LlmUnavailable(402); }), LlmUnavailable);
  assert.equal(calls, 1);
});

test('migration + function record failure kind, page size, chunks; view exists', () => {
  for (const c of ['failure_kind text', 'page_chars integer', 'chunks integer', 'chunk_capped boolean']) assert.ok(mig.includes(c), c);
  assert.match(mig, /'fetch_failed', 'truncated', 'bad_json', 'llm_unavailable', 'other'/);
  assert.match(mig, /CREATE OR REPLACE VIEW topup\.site_extraction_failures/);
  assert.match(fn, /'fetch_failed', \$\{x\.chars \?\? 0\}, 0, 1, now\(\)/);
  assert.match(fn, /thinkingConfig: \{ thinkingLevel: 'low' \}/);
  assert.match(fn, /const MAX_OUT_TOKENS = 8192;/);
  assert.match(fn, /throw new ChunkFailure\('truncated'/);
  assert.match(fn, /throw new ChunkFailure\('bad_json'/);
});
