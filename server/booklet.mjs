import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The booklet's reads and its one write (D113). Every fact comes live from
 * the database (topup.bot_rules, client_map, campaign_registry,
 * list_build_records, process_changes, the Smartlead mirror) or from the
 * skills folder in this repo. Nothing about a client is written here.
 * Counts, ids, names of campaigns and plain-English text only: no lead row
 * is ever selected.
 */

export const TOOLKIT_RULE_ID = "52fe5a2f-9de6-4f29-a3b6-3ebb5843ae82";
export const FIRST_SKILL = "josh-judgment-calls";
/** Smartlead lead categories the mirror counts as a positive reply. Same as the retired service. */
export const POSITIVE_CATEGORY_IDS = [1, 2, 131482];
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
const TAG = /^[a-z][a-z0-9_]{0,60}$/;

export const START_HERE = `Start here, every session, before any top-up or list build:

1. get_canon(): the shared rules every bot follows (Josh's and Cayden's). They win over skill text where they conflict.
2. get_skill("josh-judgment-calls"): Josh's judgment calls by client and lane.
3. get_skill("grok-bot-babysitter"): how a top-up runs, step by step, with your own connectors.
4. get_toolkit(): which connectors to use for what.
5. For the client: get_client(client_tag), then find_low_campaigns(client_tag) to pick the lane.

Then read the client's pull skill (list_skills() shows them) and the build transcript the client history points at, and replay it with your own connectors.

This server is the booklet, not the engine. It never pulls, spends, verifies or loads, and never touches a Smartlead campaign. Lead rows never come back from it.

When Josh or Cayden makes a new durable decision, save it with add_rule (pass supersedes to replace an older rule; old rules are marked superseded, never deleted). What the rules, skills and transcripts do not answer is one plain-English question to Josh.`;

export function skillsDir(root) {
  return join(root, "skills");
}

/** Every skill folder with a SKILL.md, josh-judgment-calls first, with its one-line description. */
export async function listSkills(root) {
  const dir = skillsDir(root);
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!SKILL_NAME.test(name)) continue;
    const file = join(dir, name, "SKILL.md");
    try {
      if (!(await stat(file)).isFile()) continue;
    } catch {
      continue;
    }
    const text = await readFile(file, "utf8");
    out.push({ name, description: frontMatter(text).description ?? null });
  }
  out.sort((a, b) => (a.name === FIRST_SKILL ? -1 : b.name === FIRST_SKILL ? 1 : a.name.localeCompare(b.name)));
  return out;
}

export async function getSkill(root, name) {
  if (!SKILL_NAME.test(name ?? "")) return null;
  try {
    return await readFile(join(skillsDir(root), name, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
}

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export async function getCanon(db, { client, category } = {}) {
  const { rows } = await db.query(
    `select id, category, client, rule, source, supersedes, created_at
       from topup.bot_rules
      where status = 'active'
        and ($1::text is null or client is null or lower(client) in ('all', lower($1)))
        and ($2::text is null or lower(category) = lower($2))
      order by category, client nulls first, created_at`,
    [client ?? null, category ?? null],
  );
  return rows;
}

export async function getToolkit(db) {
  const { rows } = await db.query(`select id, rule, status, updated_at from topup.bot_rules where id = $1::uuid`, [TOOLKIT_RULE_ID]);
  return rows[0] ?? null;
}

/** Insert a rule; with supersedes, mark that row superseded in the same transaction. Never deletes. */
export async function addRule(db, { rule, category, client, source, supersedes }) {
  const conn = typeof db.connect === "function" ? await db.connect() : db;
  try {
    await conn.query("begin");
    if (supersedes) {
      const { rowCount } = await conn.query(`update topup.bot_rules set status = 'superseded', updated_at = now() where id = $1::uuid and status = 'active'`, [supersedes]);
      if (!rowCount) {
        await conn.query("rollback");
        return { ok: false, error: `no active rule with id ${supersedes}; nothing was changed` };
      }
    }
    const { rows } = await conn.query(
      `insert into topup.bot_rules (rule, category, client, source, status, supersedes)
       values ($1, $2, $3, $4, 'active', $5::uuid)
       returning id, category, client, created_at`,
      [rule, category, client ?? null, source, supersedes ?? null],
    );
    await conn.query("commit");
    return { ok: true, rule: rows[0], superseded: supersedes ?? null };
  } catch (err) {
    await conn.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    if (conn !== db && typeof conn.release === "function") conn.release();
  }
}

export async function listClients(db) {
  const { rows } = await db.query(
    `select m.client_tag, m.client_name, m.smartlead_client_id,
            (select count(*) from topup.list_build_records b where b.client_tag = m.client_tag)::int as build_records,
            (select max(session_date) from topup.list_build_records b where b.client_tag = m.client_tag) as last_build,
            (select count(*) from topup.bot_rules r where r.status = 'active' and lower(r.client) = lower(m.client_tag))::int as client_rules
       from topup.client_map m
      order by m.client_tag`,
  );
  return rows;
}

/** Client context: who they are, their campaigns and lanes, their build history in words, process changes, rules and skills. */
export async function getClient(db, root, tag, { history = 10 } = {}) {
  if (!TAG.test(tag ?? "")) return null;
  const { rows: who } = await db.query(`select client_tag, client_name, smartlead_client_id from topup.client_map where client_tag = $1`, [tag]);
  if (!who[0]) return null;
  const [campaigns, builds, changes, rules, skills] = await Promise.all([
    db.query(
      `select c.smartlead_campaign_id as campaign_id, c.name, c.status, r.lane
         from public.campaigns c
         left join topup.campaign_registry r on r.campaign_id = c.smartlead_campaign_id
        where c.smartlead_client_id = $1
        order by r.lane nulls last, c.smartlead_campaign_id`,
      [who[0].smartlead_client_id],
    ),
    db.query(
      `select id, session_date, campaign_ids, lanes, written_by, left(narrative, 1500) as narrative, transcript_path
         from topup.list_build_records
        where client_tag = $1
        order by session_date desc nulls last, id desc
        limit $2`,
      [tag, Math.max(1, Math.min(50, history))],
    ),
    db.query(`select id, created_at, written_by, left(summary, 1000) as summary from topup.process_changes where client_tag = $1 or client_tag is null order by created_at desc limit 20`, [tag]),
    db.query(`select id, category, rule from topup.bot_rules where status = 'active' and lower(client) = lower($1) order by category, created_at`, [tag]),
    listSkills(root),
  ]);
  const word = tag.split("_")[0];
  return {
    client: who[0],
    campaigns: campaigns.rows,
    build_history: builds.rows,
    process_changes: changes.rows,
    client_rules: rules.rows,
    skills: skills.filter((s) => s.name.startsWith(`${tag.replace(/_/g, "-")}-`) || s.name.startsWith(`${word}-`) || (s.description ?? "").toLowerCase().includes(tag.replace(/_/g, " "))).map((s) => s.name),
    next: "Read the build transcript at transcript_path for the lane you are topping up, and the client's pull skill with get_skill.",
  };
}

/**
 * Campaigns for a client with what is left to send and how they perform:
 * untouched leads, sends in the last 7 days, days of runway at that pace,
 * lifetime sends and positive replies, and the rate per 2,000 sends. Rolled
 * up by lane. Flags only; the bot applies the rules from get_canon.
 */
export async function findLowCampaigns(db, tag) {
  if (!TAG.test(tag ?? "")) return null;
  const { rows } = await db.query(
    `with cm as (select smartlead_client_id from topup.client_map where client_tag = $1),
     c as (select c.id, c.smartlead_campaign_id, c.name, c.status from public.campaigns c join cm on cm.smartlead_client_id = c.smartlead_client_id),
     l as (select c.smartlead_campaign_id, count(*) filter (where not exists (select 1 from public.sends s where s.lead_id = l.id and s.sent)) as untouched
             from c join public.leads l on l.campaign_id = c.id group by 1),
     s as (select c.smartlead_campaign_id,
                  count(*) filter (where s.sent) as sends,
                  count(*) filter (where s.sent and s.lead_category_id = any($2::int[])) as positives,
                  count(*) filter (where s.sent and s.sent_at >= now() - interval '7 days') as sends_7d,
                  max(s.sent_at) filter (where s.sent) as last_send_at
             from c join public.sends s on s.campaign_id = c.id group by 1)
     select c.smartlead_campaign_id as campaign_id, c.name, c.status, r.lane,
            coalesce(l.untouched, 0)::int as untouched, coalesce(s.sends, 0)::int as sends,
            coalesce(s.positives, 0)::int as positives, coalesce(s.sends_7d, 0)::int as sends_7d, s.last_send_at
       from c left join l using (smartlead_campaign_id) left join s using (smartlead_campaign_id)
       left join topup.campaign_registry r on r.campaign_id = c.smartlead_campaign_id
      order by r.lane nulls last, c.smartlead_campaign_id`,
    [tag, POSITIVE_CATEGORY_IDS],
  );
  const campaigns = rows.map((r) => {
    const perDay = r.sends_7d / 7;
    return {
      ...r,
      runway_days: perDay > 0 ? Math.round((r.untouched / perDay) * 10) / 10 : null,
      positives_per_2000: r.sends > 0 ? Math.round((r.positives / r.sends) * 2000 * 100) / 100 : 0,
    };
  });
  const lanes = new Map();
  for (const c of campaigns) {
    const key = c.lane ?? "(no lane)";
    const lane = lanes.get(key) ?? { lane: key, campaigns: 0, stopped: 0, untouched: 0, sends_7d: 0, sends: 0, positives: 0 };
    lane.campaigns += 1;
    if ((c.status ?? "").toUpperCase() === "STOPPED") {
      lane.stopped += 1;
    } else {
      lane.untouched += c.untouched;
      lane.sends_7d += c.sends_7d;
    }
    lane.sends += c.sends;
    lane.positives += c.positives;
    lanes.set(key, lane);
  }
  const rollup = [...lanes.values()].map((l) => ({
    ...l,
    runway_days: l.sends_7d > 0 ? Math.round((l.untouched / (l.sends_7d / 7)) * 10) / 10 : null,
    positives_per_2000: l.sends > 0 ? Math.round((l.positives / l.sends) * 2000 * 100) / 100 : 0,
  }));
  rollup.sort((a, b) => (a.runway_days ?? Infinity) - (b.runway_days ?? Infinity));
  return {
    client_tag: tag,
    lanes: rollup,
    campaigns,
    note: "Runway is untouched leads divided by the last 7 days' daily send pace; null means nothing sent in 7 days. STOPPED campaigns are left out of lane runway. Which lanes qualify for a top-up (the reply bar, cold-call and never-top-up campaigns) is in get_canon, not here.",
  };
}
