import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { callWithRetry, classify, LlmUnavailable, MAX_RETRIES, MAX_SITE_ATTEMPTS, backoffMs } from '../supabase/functions/site-people/llm_retry.mjs';

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
  const gem = fn.slice(fn.indexOf('async function gemini('), fn.indexOf('async function jevPick('));
  assert.doesNotMatch(gem, /for \(let i = 0;/, 'gemini goes through callWithRetry only');
  assert.match(gem, /callWithRetry\(/);
});

test('extract stops the call and returns llm_unavailable without burning site attempts', () => {
  assert.match(fn, /e instanceof LlmUnavailable\) \{ llmDown = /);
  assert.match(fn, /while \(q\.length && !llmDown &&/);
  assert.match(fn, /attempts = greatest\(attempts - 1, 0\)/);
  assert.match(fn, /error: LLM_UNAVAILABLE[^\n]*424\)/);
});
