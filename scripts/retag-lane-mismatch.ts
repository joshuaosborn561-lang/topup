/**
 * Lane-mismatch fixer. Dry-run first. After a person says yes, --apply.
 *
 * A receipt whose campaign_ids include a campaign registered on a
 * different lane than the receipt's lane: those ids are dropped.
 * A provenance row whose email appears only on campaigns of another
 * lane: its lane is set to that registry lane. build_label stays
 * historical. campaign_builds is a view; this script never writes it.
 *
 * Optional --from_lane / --to_lane / --build_label narrow the scan.
 * Registry lane `unassigned` is a parking lot (D96): this script never
 * retags stamps onto it or off it, and refuses --from_lane/--to_lane=unassigned.
 * Never writes dl_status, sg_exclude, or skip_*. Does not lift a
 * suppression. Never prints an email, a name, or a phone.
 *
 * Usage:
 *   npx tsx scripts/retag-lane-mismatch.ts --client_tag=TAG
 *   npx tsx scripts/retag-lane-mismatch.ts --client_tag=TAG --from_lane=A --to_lane=B
 *   npx tsx scripts/retag-lane-mismatch.ts --client_tag=TAG --apply
 */
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";
import { isUnassignedLane, UNASSIGNED_LANE, UNASSIGNED_SKIP_NOTE } from "../src/canon/lanes.js";

export interface LaneMismatchArgs {
  client_tag: string;
  from_lane?: string;
  to_lane?: string;
  build_label?: string;
  apply: boolean;
}

const IDENT = /^[a-z][a-z0-9_]*$/;

export function parseLaneMismatchArgs(argv: string[]): LaneMismatchArgs {
  const flag = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`${name}=`));
    if (hit) return hit.slice(name.length + 1).trim() || undefined;
    const i = argv.indexOf(name);
    if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1]!.trim();
    return undefined;
  };
  const client_tag = flag("--client_tag");
  if (!client_tag || !IDENT.test(client_tag)) {
    throw new Error("pass --client_tag=snake_case. Ask Josh or Cayden.");
  }
  const from_lane = flag("--from_lane");
  const to_lane = flag("--to_lane");
  const build_label = flag("--build_label");
  if (from_lane && !IDENT.test(from_lane)) throw new Error("--from_lane must be snake_case");
  if (to_lane && !IDENT.test(to_lane)) throw new Error("--to_lane must be snake_case");
  if (isUnassignedLane(from_lane) || isUnassignedLane(to_lane)) {
    throw new Error(UNASSIGNED_SKIP_NOTE);
  }
  if ((from_lane && !to_lane) || (!from_lane && to_lane)) {
    throw new Error("pass both --from_lane and --to_lane, or neither. Ask Josh or Cayden.");
  }
  return {
    client_tag,
    ...(from_lane ? { from_lane } : {}),
    ...(to_lane ? { to_lane } : {}),
    ...(build_label ? { build_label } : {}),
    apply: argv.includes("--apply"),
  };
}

export interface ReceiptTrim {
  receipt_id: string;
  receipt_lane: string;
  before: number;
  drop: number[];
  after: number[];
}

export interface StampGroup {
  stamped_by: string;
  from_lane: string;
  to_lane: string;
  build_label: string | null;
  campaign_id: number;
  n: number;
}

export interface LaneMismatchPlan {
  client_tag: string;
  from_lane: string | null;
  to_lane: string | null;
  build_label: string | null;
  receipt_trims: ReceiptTrim[];
  stamp_groups: StampGroup[];
  stamp_total: number;
  note: string;
}

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

export async function loadLaneMismatchPlan(db: Db, args: Omit<LaneMismatchArgs, "apply">): Promise<LaneMismatchPlan> {
  const { rows: registry } = await db.query(
    `select campaign_id::text, lane from topup.campaign_registry where client_tag = $1`,
    [args.client_tag],
  );
  const laneOf = new Map<number, string>();
  for (const r of registry) {
    const id = Number(r.campaign_id);
    const lane = String(r.lane ?? "");
    if (isUnassignedLane(lane)) continue;
    if (Number.isInteger(id) && id > 0 && IDENT.test(lane)) laneOf.set(id, lane);
  }
  const { rows: receipts } = await db.query(
    `select receipt_id::text, lane, campaign_ids
       from topup.pull_receipts
      where client_tag = $1
        and ($2::text is null or lane = $2)`,
    [args.client_tag, args.from_lane ?? null],
  );
  const receipt_trims: ReceiptTrim[] = [];
  for (const r of receipts) {
    const receipt_lane = String(r.lane ?? "");
    if (isUnassignedLane(receipt_lane)) continue;
    const before = ((r.campaign_ids as Array<string | number> | null) ?? [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);
    const drop = before.filter((id) => {
      const lane = laneOf.get(id);
      if (!lane || lane === receipt_lane) return false;
      if (args.to_lane && lane !== args.to_lane) return false;
      return true;
    });
    if (drop.length === 0) continue;
    receipt_trims.push({
      receipt_id: String(r.receipt_id),
      receipt_lane,
      before: before.length,
      drop,
      after: before.filter((id) => !drop.includes(id)),
    });
  }

  const { rows: groups } = await db.query(
    `with reg as (
       select campaign_id, lane
         from topup.campaign_registry
        where client_tag = $1
     ),
     live as (
       select c.smartlead_campaign_id, r.lane, lower(l.email) as e
         from public.leads l
         join public.campaigns c on c.id = l.campaign_id
         join reg r on r.campaign_id = c.smartlead_campaign_id
        where l.email is not null
          and r.lane is distinct from '${UNASSIGNED_LANE}'
     ),
     only_lane as (
       select e, min(lane) as lane
         from live
        group by e
       having count(distinct lane) = 1
     )
     select p.stamped_by, p.lane as from_lane, o.lane as to_lane, p.build_label,
            lv.smartlead_campaign_id::text as campaign_id, count(*)::text as n
       from topup.lead_provenance p
       join only_lane o on o.e = lower(p.email)
       join live lv on lv.e = o.e and lv.lane = o.lane
      where p.client_tag = $1
        and p.lane is distinct from o.lane
        and p.lane is distinct from '${UNASSIGNED_LANE}'
        and o.lane is distinct from '${UNASSIGNED_LANE}'
        and ($2::text is null or p.lane = $2)
        and ($3::text is null or o.lane = $3)
        and ($4::text is null or p.build_label = $4)
      group by 1, 2, 3, 4, 5
      order by count(*) desc`,
    [args.client_tag, args.from_lane ?? null, args.to_lane ?? null, args.build_label ?? null],
  );
  const stamp_groups: StampGroup[] = groups.map((g) => ({
    stamped_by: String(g.stamped_by),
    from_lane: String(g.from_lane),
    to_lane: String(g.to_lane),
    build_label: g.build_label == null ? null : String(g.build_label),
    campaign_id: Number(g.campaign_id),
    n: Number(g.n),
  }));
  return {
    client_tag: args.client_tag,
    from_lane: args.from_lane ?? null,
    to_lane: args.to_lane ?? null,
    build_label: args.build_label ?? null,
    receipt_trims,
    stamp_groups: stamp_groups.slice(0, 10),
    stamp_total: stamp_groups.reduce((a, g) => a + g.n, 0),
    note: `campaign_builds is a view; this script never writes it. build_label stays historical. ${UNASSIGNED_SKIP_NOTE} Counts and ids only.`,
  };
}

export async function applyLaneMismatchPlan(
  db: Db,
  args: Omit<LaneMismatchArgs, "apply">,
  plan: LaneMismatchPlan,
): Promise<{ receipts_updated: number; stamps_updated: number }> {
  let receipts_updated = 0;
  for (const trim of plan.receipt_trims) {
    const { rowCount } = await db.query(
      `update topup.pull_receipts
          set campaign_ids = $2::bigint[]
        where receipt_id = $1
          and client_tag = $3
          and lane = $4`,
      [trim.receipt_id, trim.after, args.client_tag, trim.receipt_lane],
    );
    receipts_updated += rowCount ?? 0;
  }
  const { rowCount } = await db.query(
    `with reg as (
       select campaign_id, lane
         from topup.campaign_registry
        where client_tag = $1
     ),
     live as (
       select c.smartlead_campaign_id, r.lane, lower(l.email) as e
         from public.leads l
         join public.campaigns c on c.id = l.campaign_id
         join reg r on r.campaign_id = c.smartlead_campaign_id
        where l.email is not null
          and r.lane is distinct from '${UNASSIGNED_LANE}'
     ),
     only_lane as (
       select e, min(lane) as lane
         from live
        group by e
       having count(distinct lane) = 1
     )
     update topup.lead_provenance p
        set lane = o.lane
       from only_lane o
      where p.client_tag = $1
        and lower(p.email) = o.e
        and p.lane is distinct from o.lane
        and p.lane is distinct from '${UNASSIGNED_LANE}'
        and o.lane is distinct from '${UNASSIGNED_LANE}'
        and ($2::text is null or p.lane = $2)
        and ($3::text is null or o.lane = $3)
        and ($4::text is null or p.build_label = $4)`,
    [args.client_tag, args.from_lane ?? null, args.to_lane ?? null, args.build_label ?? null],
  );
  return { receipts_updated, stamps_updated: rowCount ?? 0 };
}

async function main(): Promise<void> {
  const args = parseLaneMismatchArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!url.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(`DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing another project.`);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const plan = await loadLaneMismatchPlan(client, args);
    console.log(JSON.stringify({ tag: "retag-lane-mismatch", apply: false, ...plan }, null, 2));
    if (!args.apply) return;
    const written = await applyLaneMismatchPlan(client, args, plan);
    console.log(JSON.stringify({ tag: "retag-lane-mismatch", apply: true, ...written }, null, 2));
  } finally {
    await client.end();
  }
}

const launched = process.argv[1]?.includes("retag-lane-mismatch");
if (launched) {
  main().catch((err) => {
    console.error(String((err as Error).message ?? err));
    process.exit(1);
  });
}
