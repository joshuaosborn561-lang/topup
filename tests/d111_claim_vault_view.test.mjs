import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const icp = readFileSync(new URL('../supabase/functions/icp-llm/index.ts', import.meta.url), 'utf8');
const people = readFileSync(new URL('../supabase/functions/site-people/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20261015220000_site_dm_pick_standard_filters.sql', import.meta.url),
  'utf8',
);

const FORBIDDEN = ['dl_status', 'sg_exclude', 'skip_'];

test('icp-llm claims rows with a 10 minute in_progress lease', () => {
  assert.match(icp, /for update of t skip locked/);
  assert.match(icp, /error = 'in_progress'/);
  assert.match(icp, /interval '10 minutes'/);
  assert.match(icp, /on conflict \(domain, model\) do update/);
  assert.match(icp, /set error = 'released'/);
  assert.match(icp, /Run claims rows \(in_progress lease, SKIP LOCKED\)/);
  assert.doesNotMatch(icp, /no row claiming here/);
});

test('icp-llm remaining ignores finished rows and live leases', () => {
  const remaining = icp.split('const [left]')[1] ?? '';
  assert.match(remaining, /r\.error is null/);
  assert.match(remaining, /r\.error = 'in_progress'/);
  assert.match(remaining, /interval '10 minutes'/);
});

test('icp-llm hard-caps copies at 5', () => {
  assert.match(icp, /const MAX_COPIES = 5;/);
  assert.match(icp, /for \(let i = 1; i <= MAX_COPIES; i\+\+\)/);
  assert.match(icp, /pg_try_advisory_lock/);
  assert.match(icp, /icp-llm concurrency cap is 5/);
  assert.match(icp, /status: s, headers:/);
  assert.match(icp, /return ok\(\{ error: 'icp-llm concurrency cap is 5' \}, 429\)/);
  assert.match(icp, /max: 2, prepare: false, idle_timeout: 10/);
});

test('icp-llm HTTP gate is not a hardcoded secret', () => {
  assert.match(icp, /Deno\.env\.get\('ICP_LLM_HTTP_KEY'\)/);
  assert.doesNotMatch(icp, /const KEY = ['"][^'"]+['"]/);
});

test('site-people reads the HTTP gate from vault site_people_key', () => {
  assert.match(people, /vault\(sql, 'site_people_key'\)/);
  assert.match(people, /site_people_key missing from vault/);
  assert.doesNotMatch(people, /const KEY\s*=/);
  assert.doesNotMatch(people, /const KEY = ['"][0-9a-fA-F]{8,}['"]/);
});

test('site-people fetch extract and ask claiming is unchanged', () => {
  assert.match(people, /for update skip locked/);
  assert.match(people, /interval '10 minutes'/);
  assert.match(people, /interval '3 minutes'/);
  assert.match(people, /mode === 'fetch'/);
  assert.match(people, /mode === 'extract'/);
  assert.match(people, /mode === 'ask'/);
});

test('site_dm_pick migration keeps rank and adds the two view filters', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW topup\.site_dm_pick/);
  assert.match(migration, /row_number\(\) OVER \(PARTITION BY p\.domain ORDER BY p\.rnk, p\.person_key\)/);
  assert.match(migration, /\(former\|originally\|first pastor\|founded in\|since 19\|est\\\.\?\\s\*19\)/);
  assert.match(migration, /\(19\[0-9\]\{2\}\\s\*\[-–\]\\s\*\[0-9\]\{2,4\}\)/);
  assert.match(migration, /\(history\|our-story\|ourstory\)/);
  assert.match(migration, /\\m\(agent\|realtor\|salesperson\)\\M/);
  assert.match(migration, /\\m\(broker\|owner\|principal\|managing\)\\M/);
  assert.doesNotMatch(migration, /maps listing/i);
  assert.doesNotMatch(migration, /site_people_text\.body/);
});

test('view filter regexes drop history and plain agents, keep current DMs', () => {
  const historyWord = /(former|originally|first pastor|founded in|since 19|est\.?\s*19)/i;
  const yearRange = /(19[0-9]{2}\s*[-–]\s*[0-9]{2,4})/;
  const historyPath = /(history|our-story|ourstory)/i;
  const agent = /\b(agent|realtor|salesperson)\b/i;
  const brokerish = /\b(broker|owner|principal|managing)\b/i;
  const dropHistory = (evidence, page) =>
    historyWord.test(evidence ?? '') || yearRange.test(evidence ?? '') || historyPath.test(page ?? '');
  const dropAgent = (title) => agent.test(title ?? '') && !brokerish.test(title ?? '');

  assert.equal(dropHistory('founded in 1970', '/staff'), true);
  assert.equal(dropHistory('since 1984', '/about'), true);
  assert.equal(dropHistory('est. 1972', '/team'), true);
  assert.equal(dropHistory('est 1972', '/team'), true);
  assert.equal(dropHistory('originally the builder', '/leadership'), true);
  assert.equal(dropHistory('former pastor', '/staff'), true);
  assert.equal(dropHistory('first pastor of the chapel', '/staff'), true);
  assert.equal(dropHistory('served 1970-73', '/staff'), true);
  assert.equal(dropHistory('served 1970–1973', '/staff'), true);
  assert.equal(dropHistory('current pastor', '/history'), true);
  assert.equal(dropHistory('current pastor', '/our-story'), true);
  assert.equal(dropHistory('current pastor', 'PAGE /history'), true);
  assert.equal(dropHistory('current pastor', '/staff'), false);
  assert.equal(dropHistory('current owner', '/leadership'), false);

  assert.equal(dropAgent('Realtor'), true);
  assert.equal(dropAgent('Salesperson'), true);
  assert.equal(dropAgent('Real Estate Agent'), true);
  assert.equal(dropAgent('Managing Broker'), false);
  assert.equal(dropAgent('Owner'), false);
  assert.equal(dropAgent('Principal'), false);
  assert.equal(dropAgent('Broker / Agent'), false);
  assert.equal(dropAgent('Owner and Agent'), false);
});

test('none of the new files touch forbidden columns', () => {
  for (const [name, src] of [
    ['icp-llm', icp],
    ['site-people', people],
    ['migration', migration],
  ]) {
    for (const col of FORBIDDEN) {
      assert.equal(src.includes(col), false, `${name} mentions ${col}`);
    }
  }
});
