import type { Queryable } from "../db/pool.js";
import { LIST_BUILD_TRANSCRIPTS_BUCKET, sanitizeTranscriptPath } from "./buildRecord.js";

/**
 * The living per-client playbook (D100). Reads `topup.client_playbook` when
 * that view exists; otherwise the same gather from `list_build_records` and
 * `process_changes`. Chronological. Read-only. No spend, no write.
 */
export const CLIENT_PLAYBOOK = "topup.client_playbook";

export const PLAYBOOK_HOW_TO_READ =
  "This is how lists are built for this client, across every campaign. Read the whole timeline before a top-up. kind=list_build is a recorded list build (disqualifications live in the narrative). kind=process_change is a method change (client_tag all/null applies to every client). transcript_links are storage object names in list-build-transcripts, never a file URL. Then call build_record for the campaign you are topping up. Counts and ids, never rows.";

export type PlaybookKind = "list_build" | "process_change";

export interface PlaybookEvent {
  kind: PlaybookKind;
  scope: "client" | "all";
  source_id: number;
  at: string;
  session_date: string | null;
  campaign_ids: number[];
  lanes: string[] | null;
  body: string;
  written_by: string;
  transcript_bucket: typeof LIST_BUILD_TRANSCRIPTS_BUCKET;
  transcript_path: string | null;
  transcript_paths: string[];
  transcript_links: string[];
  transcript_format: string | null;
  spend_cents: number | null;
  yield_by_step: unknown;
  provenance_confidence: string | null;
  receipt_ids: string[] | null;
}

export interface PlaybookAnswer {
  client_tag: string;
  list_build_count: number;
  process_change_count: number;
  event_count: number;
  first_at: string | null;
  last_at: string | null;
  events: PlaybookEvent[];
  how_to_read: string;
  note: string;
}

function asIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isInteger(n));
}

function asTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.length > 0);
}

function asTextArrayOrNull(v: unknown): string[] | null {
  if (v == null) return null;
  return asTextArray(v);
}

function linksFor(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const safe = sanitizeTranscriptPath(raw);
    if (!safe) continue;
    out.push(`${LIST_BUILD_TRANSCRIPTS_BUCKET}/${safe}`);
  }
  return out;
}

function iso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

function mapEvent(raw: Record<string, unknown>): PlaybookEvent | null {
  const kind = raw.kind === "process_change" ? "process_change" : raw.kind === "list_build" ? "list_build" : null;
  if (!kind) return null;
  const path = typeof raw.transcript_path === "string" ? sanitizeTranscriptPath(raw.transcript_path) : null;
  const paths = [...new Set([...(path ? [path] : []), ...asTextArray(raw.transcript_paths).map(sanitizeTranscriptPath).filter((p): p is string => !!p)])];
  const storedLinks = asTextArray(raw.transcript_links)
    .map((l) => {
      const name = l.startsWith(`${LIST_BUILD_TRANSCRIPTS_BUCKET}/`) ? l.slice(LIST_BUILD_TRANSCRIPTS_BUCKET.length + 1) : l;
      const safe = sanitizeTranscriptPath(name);
      return safe ? `${LIST_BUILD_TRANSCRIPTS_BUCKET}/${safe}` : null;
    })
    .filter((l): l is string => !!l);
  return {
    kind,
    scope: raw.scope === "all" ? "all" : "client",
    source_id: Number(raw.source_id),
    at: iso(raw.at) ?? "",
    session_date: raw.session_date == null ? null : String(raw.session_date).slice(0, 10),
    campaign_ids: asIntArray(raw.campaign_ids),
    lanes: asTextArrayOrNull(raw.lanes),
    body: String(raw.body ?? ""),
    written_by: String(raw.written_by ?? ""),
    transcript_bucket: LIST_BUILD_TRANSCRIPTS_BUCKET,
    transcript_path: path,
    transcript_paths: paths,
    transcript_links: storedLinks.length ? storedLinks : linksFor(paths),
    transcript_format: typeof raw.transcript_format === "string" ? raw.transcript_format : null,
    spend_cents: raw.spend_cents == null ? null : Number(raw.spend_cents),
    yield_by_step: raw.yield_by_step ?? null,
    provenance_confidence: typeof raw.provenance_confidence === "string" ? raw.provenance_confidence : null,
    receipt_ids: asTextArrayOrNull(raw.receipt_ids),
  };
}

function answerFor(clientTag: string, events: PlaybookEvent[]): PlaybookAnswer {
  const builds = events.filter((e) => e.kind === "list_build").length;
  const changes = events.filter((e) => e.kind === "process_change").length;
  const times = events.map((e) => e.at).filter((t) => t.length > 0);
  return {
    client_tag: clientTag,
    list_build_count: builds,
    process_change_count: changes,
    event_count: events.length,
    first_at: times[0] ?? null,
    last_at: times[times.length - 1] ?? null,
    events,
    how_to_read: PLAYBOOK_HOW_TO_READ,
    note:
      events.length === 0
        ? "No list_build_records or process_changes for this client."
        : `${builds} list build${builds === 1 ? "" : "s"}, ${changes} method change${changes === 1 ? "" : "s"}. Read the timeline before a top-up; then build_record for the campaign.`,
  };
}

function sortEvents(events: PlaybookEvent[]): PlaybookEvent[] {
  return [...events].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.source_id - b.source_id;
  });
}

async function fromView(db: Queryable, clientTag: string): Promise<PlaybookAnswer | { error: string }> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select client_tag, list_build_count, process_change_count, event_count,
            first_at::text as first_at, last_at::text as last_at, timeline
       from topup.client_playbook
      where client_tag = $1`,
    [clientTag],
  );
  const row = rows[0];
  if (!row) return answerFor(clientTag, []);
  const timeline = Array.isArray(row.timeline) ? row.timeline : typeof row.timeline === "string" ? JSON.parse(row.timeline) : [];
  const events = sortEvents(
    (Array.isArray(timeline) ? timeline : []).map((e) => mapEvent((e ?? {}) as Record<string, unknown>)).filter((e): e is PlaybookEvent => !!e),
  );
  return answerFor(clientTag, events);
}

async function fromTables(db: Queryable, clientTag: string): Promise<PlaybookAnswer | { error: string }> {
  const { rows: present } = await db.query<{ builds: boolean; changes: boolean }>(
    `select to_regclass('topup.list_build_records') is not null as builds,
            to_regclass('topup.process_changes') is not null as changes`,
  );
  if (!present[0]?.builds) return { error: "topup.list_build_records is missing. Ask Josh (D100)." };

  const { rows: builds } = await db.query<Record<string, unknown>>(
    `select id, client_tag, campaign_ids, lanes, narrative as body, transcript_path, transcript_paths,
            transcript_format, spend_cents, yield_by_step, session_date::text as session_date,
            written_by, created_at, receipt_ids, provenance_confidence
       from topup.list_build_records
      where client_tag = $1
      order by created_at asc, id asc`,
    [clientTag],
  );

  let changes: Record<string, unknown>[] = [];
  if (present[0].changes) {
    const r = await db.query<Record<string, unknown>>(
      `select id, client_tag, summary as body, transcript_path, transcript_format, written_by, created_at
         from topup.process_changes
        where client_tag is null or client_tag = 'all' or client_tag = $1
        order by created_at asc, id asc`,
      [clientTag],
    );
    changes = r.rows;
  }

  const events = sortEvents([
    ...builds.map((r) =>
      mapEvent({
        kind: "list_build",
        scope: "client",
        source_id: r.id,
        at: r.created_at,
        session_date: r.session_date,
        campaign_ids: r.campaign_ids,
        lanes: r.lanes,
        body: r.body,
        written_by: r.written_by,
        transcript_path: r.transcript_path,
        transcript_paths: r.transcript_paths,
        transcript_format: r.transcript_format,
        spend_cents: r.spend_cents,
        yield_by_step: r.yield_by_step,
        provenance_confidence: r.provenance_confidence,
        receipt_ids: r.receipt_ids,
      }),
    ),
    ...changes.map((r) =>
      mapEvent({
        kind: "process_change",
        scope: r.client_tag == null || r.client_tag === "all" ? "all" : "client",
        source_id: r.id,
        at: r.created_at,
        session_date: r.created_at,
        campaign_ids: [],
        lanes: null,
        body: r.body,
        written_by: r.written_by,
        transcript_path: r.transcript_path,
        transcript_paths: r.transcript_path ? [r.transcript_path] : [],
        transcript_format: r.transcript_format,
      }),
    ),
  ].filter((e): e is PlaybookEvent => !!e));
  return answerFor(clientTag, events);
}

export async function clientPlaybook(db: Queryable, clientTag: string): Promise<PlaybookAnswer | { error: string }> {
  const { rows: present } = await db.query<{ present: boolean }>(
    `select to_regclass('topup.client_playbook') is not null as present`,
  );
  if (present[0]?.present) return fromView(db, clientTag);
  return fromTables(db, clientTag);
}
