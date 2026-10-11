import type { Queryable } from "../db/pool.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import { isColdCall } from "../policy/rules.js";

/**
 * The operator write-up of how a list was built (D75). Rows live in
 * `topup.list_build_records`; the long transcript is an object in the
 * private `list-build-transcripts` bucket. Read-only. No DDL, no write,
 * no spend. Receipts stay the at-a-glance source of record.
 */
export const LIST_BUILD_RECORDS = "topup.list_build_records";
export const LIST_BUILD_TRANSCRIPTS_BUCKET = "list-build-transcripts";
export const TRANSCRIPT_PAGE_DEFAULT = 12_000;
export const TRANSCRIPT_PAGE_MAX = 24_000;

export const HOW_TO_READ =
  "Read the narrative first. Receipts (campaign_record) stay the at-a-glance source of record. Fetch the transcript only for an edge case: pass fetch_transcript=true (or offset/limit) and page with offset/limit. The path is a storage object name, never a file URL.";

const RECORD_SELECT = `id, client_tag, campaign_ids, receipt_ids, lanes, narrative,
       transcript_path, transcript_paths, transcript_format, spend_cents,
       yield_by_step, session_date::text as session_date, written_by, created_at,
       source_refs, provenance_confidence`;

export interface BuildRecordRow {
  id: number;
  client_tag: string;
  campaign_ids: number[];
  receipt_ids: string[] | null;
  lanes: string[] | null;
  narrative: string;
  transcript_path: string | null;
  transcript_paths: string[] | null;
  transcript_format: string | null;
  spend_cents: number | null;
  yield_by_step: unknown;
  session_date: string;
  written_by: string;
  created_at: string;
  source_refs: unknown;
  provenance_confidence: string | null;
}

export interface TranscriptPage {
  path: string;
  offset: number;
  limit: number;
  total_chars: number;
  text: string;
  next_offset: number | null;
}

export interface BuildRecordAnswer {
  client_tag: string;
  campaign_id: number;
  records: BuildRecordRow[];
  how_to_read: string;
  note: string;
  transcript?: TranscriptPage | { error: string };
}

export interface BuildRecordInput {
  client_tag: string;
  campaign_id: number;
  fetch_transcript?: boolean | null;
  transcript_path?: string | null;
  offset?: number | null;
  limit?: number | null;
}

export interface BuildRecordDeps {
  db: Queryable;
  readTranscript?: (path: string) => Promise<string>;
}

/** A storage object name inside the bucket — never a URL, never a traversal. */
export function sanitizeTranscriptPath(path: string): string | null {
  const p = path.trim();
  if (!p) return null;
  if (p.includes("..") || p.startsWith("/") || p.startsWith("\\")) return null;
  if (/[:\\]/.test(p) || p.includes("//")) return null;
  return p;
}

export function pageTranscript(text: string, path: string, offset: number, limit: number): TranscriptPage {
  const start = Math.max(0, Math.floor(offset));
  const size = Math.min(TRANSCRIPT_PAGE_MAX, Math.max(1, Math.floor(limit)));
  const slice = text.slice(start, start + size);
  const next = start + slice.length < text.length ? start + slice.length : null;
  return { path, offset: start, limit: size, total_chars: text.length, text: slice, next_offset: next };
}

export function pathsOnRecords(rows: readonly BuildRecordRow[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.transcript_path) out.add(row.transcript_path);
    for (const p of row.transcript_paths ?? []) if (p) out.add(p);
  }
  return [...out];
}

function asIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isInteger(n));
}

function asTextArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => String(x));
}

function mapRow(r: Record<string, unknown>): BuildRecordRow {
  return {
    id: Number(r.id),
    client_tag: String(r.client_tag ?? ""),
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
  };
}

/** GET the object. Service role only; the path must already be on a matching row. */
export async function downloadListBuildTranscript(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  path: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const safe = sanitizeTranscriptPath(opts.path);
  if (!safe) throw new Error("transcript_path is not a storage object name. Ask Josh.");
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const url = `${base}/storage/v1/object/${encodeURIComponent(LIST_BUILD_TRANSCRIPTS_BUCKET)}/${safe
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.serviceRoleKey}`,
      apikey: opts.serviceRoleKey,
    },
  });
  if (!res.ok) throw new Error(`list-build-transcripts object could not be read: HTTP ${res.status}`);
  return res.text();
}

export async function buildRecord(deps: BuildRecordDeps, input: BuildRecordInput): Promise<BuildRecordAnswer | { error: string }> {
  const name = await campaignNameBySmartleadId(deps.db, input.campaign_id).catch(() => null);
  if (isColdCall(name)) return { error: `#${input.campaign_id} ${name} is marked as cold call; the service ignores it (D54). Ask Josh.` };

  const { rows: present } = await deps.db.query<{ present: boolean }>(
    `select to_regclass('topup.list_build_records') is not null as present`,
  );
  if (!present[0]?.present) {
    return { error: "topup.list_build_records is missing. Ask Josh (D75)." };
  }

  const { rows } = await deps.db.query<Record<string, unknown>>(
    `select ${RECORD_SELECT}
       from topup.list_build_records
      where client_tag = $1
        and $2::int = any(campaign_ids)
      order by session_date desc, id desc`,
    [input.client_tag, input.campaign_id],
  );
  const records = rows.map(mapRow);
  const note =
    records.length === 0
      ? "No list_build_records row matches this campaign. Receipts stay the at-a-glance source of record."
      : `${records.length} list_build_records row${records.length === 1 ? "" : "s"}. Read the narrative first; fetch the transcript only for an edge case.`;

  const answer: BuildRecordAnswer = {
    client_tag: input.client_tag,
    campaign_id: input.campaign_id,
    records,
    how_to_read: HOW_TO_READ,
    note,
  };

  const wantTranscript = input.fetch_transcript === true || input.offset != null || input.limit != null;
  if (!wantTranscript) return answer;

  const allowed = pathsOnRecords(records);
  let path = input.transcript_path ? sanitizeTranscriptPath(input.transcript_path) : null;
  if (input.transcript_path && !path) {
    answer.transcript = { error: "transcript_path is not a storage object name. Ask Josh." };
    return answer;
  }
  if (path && !allowed.includes(path)) {
    answer.transcript = { error: "transcript_path is not on a matching list_build_records row. The service does not fetch an arbitrary object." };
    return answer;
  }
  if (!path) {
    if (allowed.length === 0) {
      answer.transcript = { error: "no transcript_path on the matching build records." };
      return answer;
    }
    if (allowed.length > 1) {
      answer.transcript = { error: `this campaign has ${allowed.length} transcript paths; pass transcript_path to page one.` };
      return answer;
    }
    path = allowed[0] ?? null;
  }
  if (!path) {
    answer.transcript = { error: "no transcript_path on the matching build records." };
    return answer;
  }
  if (!deps.readTranscript) {
    answer.transcript = { error: "list-build-transcripts is not configured. Ask Josh." };
    return answer;
  }
  try {
    const text = await deps.readTranscript(path);
    const offset = input.offset ?? 0;
    const limit = input.limit ?? TRANSCRIPT_PAGE_DEFAULT;
    answer.transcript = pageTranscript(text, path, offset, limit);
  } catch (err) {
    answer.transcript = { error: (err as Error).message };
  }
  return answer;
}
