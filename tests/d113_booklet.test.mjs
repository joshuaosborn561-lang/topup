import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addRule, findLowCampaigns, getCanon, getSkill, listSkills, START_HERE } from '../server/booklet.mjs';

/** D113: the booklet is read-mostly, never deletes, never returns lead rows, holds no key. Ask Josh before adding an engine. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(root, 'server/index.mjs'), 'utf8');
const booklet = readFileSync(join(root, 'server/booklet.mjs'), 'utf8');

function fakeDb(handler) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return handler(sql, params) ?? { rows: [], rowCount: 0 }; } };
}

test('josh-judgment-calls comes first and names are guarded', async () => {
  const skills = await listSkills(root);
  assert.equal(skills[0].name, 'josh-judgment-calls');
  assert.ok(skills.some((s) => s.name === 'grok-bot-babysitter'));
  assert.equal(await getSkill(root, '../AGENTS'), null);
  assert.equal(await getSkill(root, 'no-such-skill'), null);
});

test('canon counts "all" and blank as every-client rules', async () => {
  const db = fakeDb(() => ({ rows: [] }));
  await getCanon(db, { client: 'bcp' });
  assert.match(db.calls[0].sql, /client is null or lower\(client\) in \('all', lower\(\$1\)\)/);
  assert.match(db.calls[0].sql, /status = 'active'/);
});

test('add_rule supersedes by marking, never deletes, and refuses an unknown id', async () => {
  const db = fakeDb((sql) => {
    if (/^update/.test(sql)) return { rowCount: 1, rows: [] };
    if (/^\s*insert/.test(sql)) return { rows: [{ id: 'new', category: 'qa', client: null }] };
  });
  const ok = await addRule(db, { rule: 'Sample 200 rows per step.', category: 'qa', source: 'test', supersedes: '00000000-0000-0000-0000-000000000001' });
  assert.equal(ok.ok, true);
  assert.ok(db.calls.some((c) => /set status = 'superseded'/.test(c.sql)));
  assert.ok(!db.calls.some((c) => /\bdelete\b/i.test(c.sql)));
  const none = fakeDb((sql) => (/^update/.test(sql) ? { rowCount: 0, rows: [] } : undefined));
  const bad = await addRule(none, { rule: 'x'.repeat(20), category: 'qa', source: 'test', supersedes: '00000000-0000-0000-0000-000000000002' });
  assert.equal(bad.ok, false);
  assert.ok(none.calls.some((c) => c.sql === 'rollback'));
});

test('the low-campaign finder rolls up lanes, leaves STOPPED out of runway, and sorts lowest first', async () => {
  const db = fakeDb(() => ({ rows: [
    { campaign_id: 1, name: 'a', status: 'ACTIVE', lane: 'x', untouched: 70, sends: 2000, positives: 2, sends_7d: 70 },
    { campaign_id: 2, name: 'b', status: 'STOPPED', lane: 'x', untouched: 5000, sends: 1000, positives: 0, sends_7d: 0 },
    { campaign_id: 3, name: 'c', status: 'ACTIVE', lane: 'y', untouched: 700, sends: 4000, positives: 1, sends_7d: 70 },
  ] }));
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
  assert.match(server, /process\.env\.DATABASE_URL/);
  assert.match(server, /azpapwtnrbzywlnxxecz/);
  assert.match(START_HERE, /get_canon/);
  assert.match(START_HERE, /josh-judgment-calls/);
});
