/**
 * Correct a backfilled receipt so company_filters match its build
 * transcript or narrative (D96). Dry-run first. After a person says
 * yes, --apply writes company_filters only.
 *
 * The transcript / narrative is the source of truth for how the list
 * was built. A thinner or disagreeing backfill is a fix, not widening.
 *
 * Usage:
 *   npx tsx scripts/correct-receipt-from-transcript.ts --client_tag=TAG
 *   npx tsx scripts/correct-receipt-from-transcript.ts --client_tag=TAG --lane=LANE
 *   npx tsx scripts/correct-receipt-from-transcript.ts --client_tag=TAG --campaign_id=123
 *   npx tsx scripts/correct-receipt-from-transcript.ts --client_tag=TAG --receipt_id=UUID
 *   npx tsx scripts/correct-receipt-from-transcript.ts --client_tag=TAG --apply
 *
 * Never writes dl_status, sg_exclude, or skip_*. Never prints an email,
 * a person name, or a phone.
 */
import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../src/config.js";
import {
  downloadListBuildTranscript,
  pathsOnRecords,
  type BuildRecordRow,
} from "../src/canon/buildRecord.js";
import {
  planReceiptTranscript,
  type BuildSource,
  type ReceiptSource,
  type ReceiptTranscriptPlan,
} from "../src/canon/receiptTranscript.js";

export interface CorrectReceiptArgs {
  client_tag: string;
  lane?: string;
  campaign_id?: number;
  receipt_id?: string;
  apply: boolean;
}

const IDENT = /^[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCorrectReceiptArgs(argv: string[]): CorrectReceiptArgs {
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
  const lane = flag("--lane");
  if (lane && !IDENT.test(lane)) throw new Error("--lane must be snake_case");
  const campaignRaw = flag("--campaign_id");
  const campaign_id = campaignRaw ? Number(campaignRaw) : undefined;
  if (campaignRaw && (!Number.isInteger(campaign_id) || campaign_id! <= 0)) {
    throw new Error("--campaign_id must be a positive integer");
  }
  const receipt_id = flag("--receipt_id");
  if (receipt_id && !UUID.test(receipt_id)) throw new Error("--receipt_id must be a uuid");
  return {
    client_tag,
    ...(lane ? { lane } : {}),
    ...(campaign_id ? { campaign_id } : {}),
    ...(receipt_id ? { receipt_id } : {}),
    apply: argv.includes("--apply"),
  };
}

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

function asIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

function asTextArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => String(x));
}

export async function loadReceipts(db: Db, args: Omit<CorrectReceiptArgs, "apply">): Promise<ReceiptSource[]> {
  const { rows } = await db.query(
    `select receipt_id::text, client_tag, lane, campaign_ids, company_filters, written_by
       from topup.pull_receipts
      where client_tag = $1
        and ($2::text is null or lane = $2)
        and ($3::bigint is null or $3 = any(campaign_ids))
        and ($4::uuid is null or receipt_id = $4::uuid)
      order by written_at desc`,
    [args.client_tag, args.lane ?? null, args.campaign_id ?? null, args.receipt_id ?? null],
  );
  return rows.map((r) => ({
    receipt_id: String(r.receipt_id),
    client_tag: String(r.client_tag),
    lane: String(r.lane ?? ""),
    campaign_ids: asIntArray(r.campaign_ids),
    company_filters: (r.company_filters && typeof r.company_filters === "object" ? r.company_filters : {}) as Record<string, unknown>,
    written_by: r.written_by == null ? null : String(r.written_by),
  }));
}

export async function loadBuilds(db: Db, clientTag: string): Promise<BuildRecordRow[]> {
  const { rows } = await db.query(
    `select id, client_tag, campaign_ids, receipt_ids, lanes, narrative,
            transcript_path, transcript_paths, transcript_format, spend_cents,
            yield_by_step, session_date::text as session_date, written_by, created_at,
            source_refs, provenance_confidence
       from topup.list_build_records
      where client_tag = $1
      order by session_date desc, id desc`,
    [clientTag],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    client_tag: String(r.client_tag),
    campaign_ids: asIntArray(r.campaign_ids),
    receipt_ids: asTextArray(r.receipt_ids),
    lanes: asTextArray(r.lanes),
    narrative: String(r.narrative ?? ""),
    transcript_path: typeof r.transcript_path === "string" ? r.transcript_path : null,
    transcript_paths: asTextArray(r.transcript_paths),
    transcript_format: typeof r.transcript_format === "string" ? r.transcript_format : null,
    spend_cents: r.spend_cents == null ? null : Number(r.spend_cents),
    yield_by_step: r.yield_by_step ?? null,
    session_date: String(r.session_date ?? ""),
    written_by: String(r.written_by ?? ""),
    created_at: String(r.created_at ?? ""),
    source_refs: r.source_refs ?? null,
    provenance_confidence: typeof r.provenance_confidence === "string" ? r.provenance_confidence : null,
  }));
}

export async function loadCampaignNames(db: Db, ids: number[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { rows } = await db.query(
    `select smartlead_campaign_id::text as id, name from public.campaigns where smartlead_campaign_id = any($1::bigint[])`,
    [ids],
  );
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.id && r.name) out[String(r.id)] = String(r.name);
  }
  return out;
}

export async function attachTranscripts(
  builds: BuildRecordRow[],
  readTranscript: (path: string) => Promise<string>,
): Promise<BuildSource[]> {
  const cache = new Map<string, string>();
  for (const path of pathsOnRecords(builds)) {
    try {
      cache.set(path, await readTranscript(path));
    } catch {
      // Narrative still applies. The plan notes which source was used.
    }
  }
  return builds.map((b) => {
    const texts = pathsOnRecords([b]).map((p) => cache.get(p)).filter((t): t is string => Boolean(t && t.trim()));
    return {
      id: b.id,
      narrative: b.narrative,
      transcript: texts.length ? texts.join("\n\n") : null,
      campaign_ids: b.campaign_ids,
      receipt_ids: b.receipt_ids,
    };
  });
}

const CORRECTION_NOTE = "D96: company_filters corrected from the build transcript or narrative.";

export async function applyReceiptTranscriptPlan(
  db: Db,
  args: Omit<CorrectReceiptArgs, "apply">,
  plan: ReceiptTranscriptPlan,
): Promise<{ receipts_updated: number }> {
  let receipts_updated = 0;
  for (const c of plan.corrections) {
    if (c.patches.length === 0) continue;
    const { rowCount } = await db.query(
      `update topup.pull_receipts
          set company_filters = $2::jsonb,
              notes = case
                when notes is null or notes = '' then $3
                when notes like '%' || $3 || '%' then notes
                else notes || E'\n' || $3
              end
        where receipt_id = $1
          and client_tag = $4`,
      [c.receipt_id, JSON.stringify(c.next_filters), CORRECTION_NOTE, args.client_tag],
    );
    receipts_updated += rowCount ?? 0;
  }
  return { receipts_updated };
}

export async function runCorrectReceipt(
  db: Db,
  args: CorrectReceiptArgs,
  readTranscript?: (path: string) => Promise<string>,
): Promise<{ plan: ReceiptTranscriptPlan; written?: { receipts_updated: number } }> {
  const receipts = await loadReceipts(db, args);
  const builds = await loadBuilds(db, args.client_tag);
  const ids = [...new Set(receipts.flatMap((r) => r.campaign_ids))];
  const names = await loadCampaignNames(db, ids);
  const withText = readTranscript ? await attachTranscripts(builds, readTranscript) : builds.map((b) => ({
    id: b.id,
    narrative: b.narrative,
    transcript: null,
    campaign_ids: b.campaign_ids,
    receipt_ids: b.receipt_ids,
  }));
  const plan = planReceiptTranscript(receipts, withText, names);
  if (!args.apply) return { plan };
  const written = await applyReceiptTranscriptPlan(db, args, plan);
  return { plan, written };
}

async function main(): Promise<void> {
  const args = parseCorrectReceiptArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!url.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(`DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing another project.`);
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const readTranscript =
    supabaseUrl && serviceRole
      ? (path: string) => downloadListBuildTranscript({ supabaseUrl, serviceRoleKey: serviceRole, path })
      : undefined;
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await runCorrectReceipt(client, args, readTranscript);
    console.log(JSON.stringify({ tag: "correct-receipt-from-transcript", apply: false, ...result.plan }, null, 2));
    if (!args.apply) return;
    console.log(JSON.stringify({ tag: "correct-receipt-from-transcript", apply: true, ...result.written }, null, 2));
  } finally {
    await client.end();
  }
}

const launched = process.argv[1]?.includes("correct-receipt-from-transcript");
if (launched) {
  main().catch((err) => {
    console.error(String((err as Error).message ?? err));
    process.exit(1);
  });
}
