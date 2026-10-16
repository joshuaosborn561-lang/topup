import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dataClient, findLowCampaigns, getSkill, listSkills, START_HERE } from '../server/booklet.mjs';

/** D113: the booklet is read-mostly, never deletes, never returns lead rows, holds no key. Ask Josh before adding an engine. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(root, 'server/index.mjs'), 'utf8');
const booklet = readFileSync(join(root, 'server/booklet.mjs'), 'utf8');
const fn = readFileSync(join(root, 'supabase/functions/booklet-data/index.ts'), 'utf8');

test('josh-judgment-calls comes first and names are guarded', async () => {
  const skills = await listSkills(root);
  assert.equal(skills[0].name, 'josh-judgment-calls');
  assert.ok(skills.some((s) => s.name === 'grok-bot-babysitter'));
  assert.equal(await getSkill(root, '../AGENTS'), null);
  assert.equal(await getSkill(root, 'no-such-skill'), null);
});

test('the data function counts "all" and blank as every-client rules, supersedes by marking, never deletes', () => {
  assert.match(fn, /client is null or lower\(client\) in \('all', lower\(/);
  assert.match(fn, /set status = 'superseded'/);
  assert.match(fn, /sql\.begin/);
  assert.doesNotMatch(fn, /\bdelete\s+from\b/i);
  assert.match(fn, /SUPABASE_DB_URL/);
  assert.match(fn, /LOOKS_PRIVATE\.test\(rule\)/);
  assert.doesNotMatch(fn, /select[^`]*\b(email|first_name|last_name|phone)\b[^`]*from\s+(public\.leads|lp\.)/i, 'D113: no lead rows');
});

test('the data client posts an action and surfaces the function\'s error', async () => {
  const calls = [];
  const ok = dataClient('https://x', async (url, init) => { calls.push(JSON.parse(init.body)); return { status: 200, json: async () => ({ ok: true, data: [1] }) }; });
  assert.deepEqual(await ok('canon', { client: 'bcp' }), [1]);
  assert.deepEqual(calls[0], { action: 'canon', args: { client: 'bcp' } });
  const bad = dataClient('https://x', async () => ({ status: 200, json: async () => ({ ok: false, error: 'no active rule' }) }));
  await assert.rejects(bad('add_rule', {}), /no active rule/);
});

test('the low-campaign finder rolls up lanes, leaves STOPPED out of runway, and sorts lowest first', async () => {
  const db = async () => [
    { campaign_id: 1, name: 'a', status: 'ACTIVE', lane: 'x', untouched: 70, sends: 2000, positives: 2, sends_7d: 70 },
    { campaign_id: 2, name: 'b', status: 'STOPPED', lane: 'x', untouched: 5000, sends: 1000, positives: 0, sends_7d: 0 },
    { campaign_id: 3, name: 'c', status: 'ACTIVE', lane: 'y', untouched: 700, sends: 4000, positives: 1, sends_7d: 70 },
  ];
  const out = await findLowCampaigns(db, 'bcp');
  assert.deepEqual(out.lanes.map((l) => l.lane), ['x', 'y']);
  assert.equal(out.lanes[0].runway_days, 7);
  assert.equal(out.lanes[0].untouched, 70, 'STOPPED is not runway');
  assert.equal(out.campaigns[0].positives_per_2000, 2);
  assert.equal(await findLowCampaigns(db, 'Bad Tag;'), null);
});

test('no engine, no lead rows, no keys, no login', () => {
  for (const src of [server, booklet]) {
    assert.doesNotMatch(src, /\bdelete\s+from\b/i, 'D113: never deletes');
    assert.doesNotMatch(src, /select[^;]*\b(email|first_name|last_name|phone)\b[^;]*from\s+(public\.leads|lp\.)/i, 'D113: no lead rows');
    assert.doesNotMatch(src, /(sk-|eyJ)[A-Za-z0-9_-]{16,}/, 'D113: no key in code');
  }
  assert.doesNotMatch(server, /registerTool\(\s*"(topup|load|pull|verify|import|abort|spend)"/, 'D113: no engine tools');
  assert.doesNotMatch(server, /authorization/i, 'D113: no login, as before (D41)');
  assert.doesNotMatch(server + booklet, /DATABASE_URL/, 'D113: no database secret');
  assert.match(server, /azpapwtnrbzywlnxxecz/);
  assert.match(START_HERE, /get_canon/);
  assert.match(START_HERE, /josh-judgment-calls/);
});
