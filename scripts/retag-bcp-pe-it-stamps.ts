/**
 * D92 — dry-run first. After merge, pass --apply.
 *
 * The BCP PE SEG campaign (3897344) showed 576 leads stamped
 * getleads_bcp_u50_expansion_20260903 / it_dm_airpods. stamp_provenance
 * plus a bloated IT receipt campaign_ids list attached an IT build to
 * PE campaigns. campaign_builds is a view; this script never writes it.
 *
 * Dry-run prints counts and ids. --apply:
 *   1. Drops PE campaign ids from IT receipts that carry them.
 *   2. Sets lead_provenance.lane to pe_firms for PE-only emails that
 *      still carry the IT u50 stamp. build_label stays historical.
 *
 * Never writes dl_status, sg_exclude, or skip_*. Does not lift a
 * suppression. Never prints an email, a name, or a phone.
 *
 * Usage:
 *   npx tsx scripts/retag-bcp-pe-it-stamps.ts
 *   npx tsx scripts/retag-bcp-pe-it-stamps.ts --apply
 */
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";

const CLIENT_TAG = "bcp";
const PE_LANE = "pe_firms";
const IT_LANE = "it_dm_airpods";
const IT_BUILD = "getleads_bcp_u50_expansion_20260903";

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
    const plan = await loadPlan(client);
    console.log(JSON.stringify({ tag: "retag-bcp-pe-it-stamps", apply: false, ...plan }, null, 2));
    if (!apply) return;
    const written = await applyPlan(client, plan);
    console.log(JSON.stringify({ tag: "retag-bcp-pe-it-stamps", apply: true, ...written }, null, 2));
  } finally {
    await client.end();
  }
}

interface ReceiptTrim {
  receipt_id: string;
  before: number;
  drop: number[];
  after: number[];
}

interface StampGroup {
  stamped_by: string;
  lane: string;
  build_label: string | null;
  campaign_id: number;
  n: number;
}

interface Plan {
  pe_campaign_ids: number[];
  it_campaign_ids: number[];
  receipt_trims: ReceiptTrim[];
  stamp_groups: StampGroup[];
  stamp_total: number;
  note: string;
}

async function loadPlan(db: pg.Client): Promise<Plan> {
  const pe = await ids(db, PE_LANE);
  const it = await ids(db, IT_LANE);
  const { rows: receipts } = await db.query<{ receipt_id: string; campaign_ids: Array<string | number> }>(
    `select receipt_id::text, campaign_ids
       from topup.pull_receipts
      where client_tag = $1
        and lane = $2
        and campaign_ids && $3::bigint[]`,
    [CLIENT_TAG, IT_LANE, pe],
  );
  const receipt_trims: ReceiptTrim[] = receipts.map((r) => {
    const before = (r.campaign_ids ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
    const drop = before.filter((id) => pe.includes(id));
    const after = before.filter((id) => !pe.includes(id));
    return { receipt_id: r.receipt_id, before: before.length, drop, after };
  });
  const { rows: groups } = await db.query<{
    stamped_by: string;
    lane: string;
    build_label: string | null;
    campaign_id: string;
    n: string;
  }>(
    `with pe as (select unnest($2::bigint[]) as campaign_id),
          it as (select unnest($3::bigint[]) as campaign_id),
          pe_leads as (
            select c.smartlead_campaign_id, lower(l.email) as e
              from public.leads l
              join public.campaigns c on c.id = l.campaign_id
             where c.smartlead_campaign_id in (select campaign_id from pe)
               and l.email is not null
          ),
          it_leads as (
            select distinct lower(l.email) as e
              from public.leads l
              join public.campaigns c on c.id = l.campaign_id
             where c.smartlead_campaign_id in (select campaign_id from it)
               and l.email is not null
          )
     select p.stamped_by, p.lane, p.build_label, pl.smartlead_campaign_id::text as campaign_id, count(*)::text as n
       from topup.lead_provenance p
       join pe_leads pl on pl.e = lower(p.email)
       left join it_leads il on il.e = lower(p.email)
      where p.client_tag = $1
        and p.lane = $4
        and p.build_label = $5
        and il.e is null
      group by 1, 2, 3, 4
      order by count(*) desc`,
    [CLIENT_TAG, pe, it, IT_LANE, IT_BUILD],
  );
  const stamp_groups: StampGroup[] = groups.map((g) => ({
    stamped_by: g.stamped_by,
    lane: g.lane,
    build_label: g.build_label,
    campaign_id: Number(g.campaign_id),
    n: Number(g.n),
  }));
  return {
    pe_campaign_ids: pe,
    it_campaign_ids: it,
    receipt_trims,
    stamp_groups: stamp_groups.slice(0, 10),
    stamp_total: stamp_groups.reduce((a, g) => a + g.n, 0),
    note:
      "campaign_builds is a view; this script never writes it. build_label stays historical. Counts and ids only.",
  };
}

async function applyPlan(db: pg.Client, plan: Plan): Promise<{ receipts_updated: number; stamps_updated: number }> {
  let receipts_updated = 0;
  for (const trim of plan.receipt_trims) {
    const { rowCount } = await db.query(
      `update topup.pull_receipts
          set campaign_ids = $2::bigint[]
        where receipt_id = $1
          and client_tag = $3
          and lane = $4
          and campaign_ids && $5::bigint[]`,
      [trim.receipt_id, trim.after, CLIENT_TAG, IT_LANE, plan.pe_campaign_ids],
    );
    receipts_updated += rowCount ?? 0;
  }
  const { rowCount } = await db.query(
    `with pe as (select unnest($2::bigint[]) as campaign_id),
          it as (select unnest($3::bigint[]) as campaign_id),
          pe_only as (
            select lower(l.email) as e
              from public.leads l
              join public.campaigns c on c.id = l.campaign_id
             where c.smartlead_campaign_id in (select campaign_id from pe)
               and l.email is not null
               and not exists (
                 select 1
                   from public.leads l2
                   join public.campaigns c2 on c2.id = l2.campaign_id
                  where lower(l2.email) = lower(l.email)
                    and c2.smartlead_campaign_id in (select campaign_id from it)
               )
          )
     update topup.lead_provenance p
        set lane = $4
      where p.client_tag = $1
        and p.lane = $5
        and p.build_label = $6
        and lower(p.email) in (select e from pe_only)`,
    [CLIENT_TAG, plan.pe_campaign_ids, plan.it_campaign_ids, PE_LANE, IT_LANE, IT_BUILD],
  );
  return { receipts_updated, stamps_updated: rowCount ?? 0 };
}

async function ids(db: pg.Client, lane: string): Promise<number[]> {
  const { rows } = await db.query<{ campaign_id: string }>(
    `select campaign_id::text
       from topup.campaign_registry
      where client_tag = $1 and lane = $2
      order by 1`,
    [CLIENT_TAG, lane],
  );
  return rows.map((r) => Number(r.campaign_id)).filter((n) => Number.isInteger(n) && n > 0);
}

main().catch((err) => {
  console.error(String((err as Error).message ?? err));
  process.exit(1);
});
