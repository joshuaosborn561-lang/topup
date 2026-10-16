// booklet-data (D113): the database half of the Lead Topup MCP booklet.
// Runs inside Supabase project azpapwtnrbzywlnxxecz and uses the connection
// Supabase gives every function (SUPABASE_DB_URL), so no key is handed to
// anyone. Fixed queries only, chosen by `action`; no SQL comes in. Counts,
// ids, campaign names and plain-English text: no lead row is ever selected.
// It never deletes; add_rule supersedes by marking the old row.
import postgres from 'npm:postgres@3.4.4';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 2, prepare: false, idle_timeout: 10 });

const TOOLKIT_RULE_ID = '52fe5a2f-9de6-4f29-a3b6-3ebb5843ae82';
const POSITIVE_CATEGORY_IDS = [1, 2, 131482];
const TAG = /^[a-z][a-z0-9_]{0,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKS_PRIVATE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|(sk-|eyJ)[A-Za-z0-9_-]{16,}/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function canon(a: Args) {
  const client = str(a.client);
  const category = str(a.category);
  return await sql`
    select id, category, client, rule, source, supersedes, created_at
      from topup.bot_rules
     where status = 'active'
       and (${client}::text is null or client is null or lower(client) in ('all', lower(${client}::text)))
       and (${category}::text is null or lower(category) = lower(${category}::text))
     order by category, client nulls first, created_at`;
}

async function toolkit() {
  const rows = await sql`select id, rule, status, updated_at from topup.bot_rules where id = ${TOOLKIT_RULE_ID}::uuid`;
  return rows[0] ?? null;
}

async function addRule(a: Args) {
  const rule = str(a.rule);
  const category = str(a.category);
  const source = str(a.source);
  const client = str(a.client);
  const supersedes = str(a.supersedes);
  if (!rule || rule.length < 10 || rule.length > 4000) return { ok: false, error: 'rule must be 10 to 4000 characters' };
  if (!category || category.length > 40) return { ok: false, error: 'category is required (up to 40 characters)' };
  if (!source || source.length > 200) return { ok: false, error: 'source is required: who decided it and where' };
  if (client && !TAG.test(client) && client !== 'all') return { ok: false, error: 'client must be a client_tag' };
  if (supersedes && !UUID.test(supersedes)) return { ok: false, error: 'supersedes must be a rule id' };
  if (LOOKS_PRIVATE.test(rule)) return { ok: false, error: 'That rule contains an email address or something that looks like a key. Rules never carry either. Nothing was saved.' };
  return await sql.begin(async (tx) => {
    if (supersedes) {
      const hit = await tx`update topup.bot_rules set status = 'superseded', updated_at = now() where id = ${supersedes}::uuid and status = 'active' returning id`;
      if (!hit.length) throw new Error(`no active rule with id ${supersedes}; nothing was changed`);
    }
    const rows = await tx`
      insert into topup.bot_rules (rule, category, client, source, status, supersedes)
      values (${rule}, ${category}, ${client}, ${source}, 'active', ${supersedes}::uuid)
      returning id, category, client, created_at`;
    return { ok: true, rule: rows[0], superseded: supersedes };
  });
}

async function clients() {
  return await sql`
    select m.client_tag, m.client_name, m.smartlead_client_id,
           (select count(*) from topup.list_build_records b where b.client_tag = m.client_tag)::int as build_records,
           (select max(session_date) from topup.list_build_records b where b.client_tag = m.client_tag) as last_build,
           (select count(*) from topup.bot_rules r where r.status = 'active' and lower(r.client) = lower(m.client_tag))::int as client_rules
      from topup.client_map m
     order by m.client_tag`;
}

async function client(a: Args) {
  const tag = str(a.client_tag);
  if (!tag || !TAG.test(tag)) return null;
  const history = Math.max(1, Math.min(50, Number(a.history ?? 10) || 10));
  const who = await sql`select client_tag, client_name, smartlead_client_id from topup.client_map where client_tag = ${tag}`;
  if (!who[0]) return null;
  const [campaigns, builds, changes, rules] = await Promise.all([
    sql`select c.smartlead_campaign_id as campaign_id, c.name, c.status, r.lane
          from public.campaigns c
          left join topup.campaign_registry r on r.campaign_id = c.smartlead_campaign_id
         where c.smartlead_client_id = ${who[0].smartlead_client_id}
         order by r.lane nulls last, c.smartlead_campaign_id`,
    sql`select id, session_date, campaign_ids, lanes, written_by, left(narrative, 1500) as narrative, transcript_path
          from topup.list_build_records
         where client_tag = ${tag}
         order by session_date desc nulls last, id desc
         limit ${history}`,
    sql`select id, created_at, written_by, left(summary, 1000) as summary
          from topup.process_changes
         where client_tag = ${tag} or client_tag is null
         order by created_at desc limit 20`,
    sql`select id, category, rule from topup.bot_rules where status = 'active' and lower(client) = lower(${tag}) order by category, created_at`,
  ]);
  return { client: who[0], campaigns, build_history: builds, process_changes: changes, client_rules: rules };
}

async function lowCampaigns(a: Args) {
  const tag = str(a.client_tag);
  if (!tag || !TAG.test(tag)) return null;
  return await sql`
    with cm as (select smartlead_client_id from topup.client_map where client_tag = ${tag}),
    c as (select c.id, c.smartlead_campaign_id, c.name, c.status from public.campaigns c join cm on cm.smartlead_client_id = c.smartlead_client_id),
    l as (select c.smartlead_campaign_id, count(*) filter (where not exists (select 1 from public.sends s where s.lead_id = l.id and s.sent)) as untouched
            from c join public.leads l on l.campaign_id = c.id group by 1),
    s as (select c.smartlead_campaign_id,
                 count(*) filter (where s.sent) as sends,
                 count(*) filter (where s.sent and s.lead_category_id = any(${POSITIVE_CATEGORY_IDS}::int[])) as positives,
                 count(*) filter (where s.sent and s.sent_at >= now() - interval '7 days') as sends_7d,
                 max(s.sent_at) filter (where s.sent) as last_send_at
            from c join public.sends s on s.campaign_id = c.id group by 1)
    select c.smartlead_campaign_id as campaign_id, c.name, c.status, r.lane,
           coalesce(l.untouched, 0)::int as untouched, coalesce(s.sends, 0)::int as sends,
           coalesce(s.positives, 0)::int as positives, coalesce(s.sends_7d, 0)::int as sends_7d, s.last_send_at
      from c left join l using (smartlead_campaign_id) left join s using (smartlead_campaign_id)
      left join topup.campaign_registry r on r.campaign_id = c.smartlead_campaign_id
     order by r.lane nulls last, c.smartlead_campaign_id`;
}

async function health() {
  const rows = await sql`select count(*)::int as n from topup.bot_rules where status = 'active'`;
  return { ok: true, active_rules: rows[0].n };
}

const ACTIONS: Record<string, (a: Args) => Promise<unknown>> = {
  health,
  canon,
  toolkit,
  add_rule: addRule,
  clients,
  client,
  low_campaigns: lowCampaigns,
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST {action, args}' }, 405);
  let body: { action?: string; args?: Args };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON {action, args}' }, 400);
  }
  const fn = ACTIONS[body.action ?? ''];
  if (!fn) return json({ error: `unknown action; one of ${Object.keys(ACTIONS).join(', ')}` }, 400);
  try {
    return json({ ok: true, data: await fn(body.args ?? {}) });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err).replace(/postgres(ql)?:\/\/\S+/gi, '[database url]').slice(0, 300) }, 200);
  }
});
