/**
 * D81 — dry-run audit of past Smartlead negatives.
 * Text and category first. Estimates the Jev cost for the leftover.
 * Does not call AI. Counts only. Pass --apply only after Josh applies
 * 0025 and says to write the text/category classes (still no AI).
 */
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";
import { estimateAudit, type AuditCounts } from "../src/replies/audit.js";
import {
  NOT_INTERESTED_CATEGORY_ID,
  NOT_INTERESTED_TEXT_SQL,
  SMARTLEAD_DNC_CATEGORY_ID,
  UNSUB_CATEGORY_SQL,
  UNSUB_TEXT_SQL,
} from "../src/replies/classify.js";
import { classifyArrivingNegatives } from "../src/replies/arrive.js";

function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const apply = flag("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!url.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(`DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing another project.`);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const counts = await loadCounts(client);
    const estimate = estimateAudit(counts);
    console.log(JSON.stringify({ tag: "audit-negative-class", ...estimate }));
    if (!apply) return;
    const result = await classifyArrivingNegatives(client, { apply: true });
    console.log(JSON.stringify({ tag: "audit-negative-class", apply: true, ai_run: false, ...result }));
  } finally {
    await client.end();
  }
}

async function loadCounts(db: pg.Client): Promise<AuditCounts> {
  const { rows } = await db.query<{ how: string; n: string }>(
    `with negatives as (
       select l.id, l.category_id, lower(coalesce(l.category, '')) as category, lower(coalesce(l.status, '')) as status
         from public.leads l
        where l.email is not null
          and (l.category_id in (${NOT_INTERESTED_CATEGORY_ID}, ${SMARTLEAD_DNC_CATEGORY_ID})
               or lower(coalesce(l.status, '')) = 'unsubscribed')
     ),
     latest_in as (
       select distinct on (m.lead_id) m.lead_id, lower(coalesce(m.body, '')) as body
         from public.messages m
        where m.direction = 'inbound'
        order by m.lead_id, coalesce(m.received_at, m.sent_at, m.created_at) desc
     ),
     scored as (
       select case
                when n.status = 'unsubscribed' then 'status_unsubscribe'
                when coalesce(i.body, '') ~ '${UNSUB_TEXT_SQL}' then 'text_unsubscribe'
                when coalesce(i.body, '') ~ '${NOT_INTERESTED_TEXT_SQL}' then 'text_not_interested'
                when n.category ~ '${UNSUB_CATEGORY_SQL}' then 'category_unsubscribe'
                when n.category_id = ${NOT_INTERESTED_CATEGORY_ID} then 'category_not_interested'
                else 'needs_ai'
              end as how
         from negatives n
         left join latest_in i on i.lead_id = n.id
     )
     select how, count(*)::text as n from scored group by 1`,
  );
  const out: AuditCounts = {
    negatives: 0,
    text_unsubscribe: 0,
    text_not_interested: 0,
    category_unsubscribe: 0,
    category_not_interested: 0,
    status_unsubscribe: 0,
    needs_ai: 0,
  };
  for (const r of rows) {
    const n = Number(r.n);
    out.negatives += n;
    if (r.how in out) (out as Record<string, number>)[r.how] = n;
  }
  return out;
}

main().catch((err) => {
  console.error(JSON.stringify({ tag: "audit-negative-class", error: (err as Error).message }));
  process.exit(1);
});
