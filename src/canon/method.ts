import type { Queryable } from "../db/pool.js";
import { buildRecord, pathsOnRecords, type BuildRecordDeps, type BuildRecordRow } from "./buildRecord.js";

/**
 * The method a campaign was built with, read off its saved transcript (D99).
 * The transcript is the truth (D96): every tool the operator called, in
 * order, with the arguments as typed. Grokbot replays those calls with its
 * own connectors. Lead rows never come through here: parameter values are
 * trimmed, addresses and phone numbers are blanked, and anything that looks
 * like a CSV or a result dump is cut to its first line.
 */
export interface MethodStep {
  /** Position in the transcript's tool-call order, from 1. */
  n: number;
  turn: number;
  tool: string;
  /** Parameter name → value as typed, trimmed and redacted. */
  args: Record<string, string>;
}

export interface MethodPage {
  path: string;
  total_steps: number;
  from: number;
  steps: MethodStep[];
  next_from: number | null;
  /** How many times each tool was called over the whole transcript. */
  tool_counts: Record<string, number>;
  /** What the person asked for, in their words: the human turns, trimmed. */
  asked: string[];
}

export const METHOD_PAGE_DEFAULT = 40;
export const METHOD_PAGE_MAX = 120;
export const ARG_MAX_CHARS = 700;
export const ASKED_MAX = 12;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A North American phone number on its own; a run of digits inside an identifier (a stamp, a run id) is not one. */
const PHONE = /(?<![\d_A-Za-z])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?![\d_A-Za-z])/g;
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
/** Keys whose values are a person's data; blanked inside any JSON argument. */
const LEAD_KEYS = new Set(["email", "work_email", "first_name", "last_name", "full_name", "name", "phone", "mobile_phone", "phone_number", "linkedin_url", "linkedin", "address"]);

/** A recorded URL (a signed export, a storage token) is never replayed; only its host is kept. */
function blankUrls(v: string): string {
  return v.replace(URL_RE, (u) => {
    try {
      return `[url ${new URL(u).hostname}]`;
    } catch {
      return "[url]";
    }
  });
}

/** Inline rows inside a JSON argument (an INSERT payload, a pasted list) are counted, never kept; lead keys are blanked. */
function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((x) => x && typeof x === "object" && !Array.isArray(x))) return `[${value.length} rows not shown]`;
    return value.map(redactJson);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = LEAD_KEYS.has(k.toLowerCase()) ? "[redacted]" : redactJson(v);
    return out;
  }
  return value;
}

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Blank addresses and phone numbers; cut result dumps to their first line; cap the length. */
export function redactArg(value: string): string {
  let v = value.replace(/\r/g, "").trim();
  if (/^[[{]/.test(v)) {
    try {
      v = JSON.stringify(redactJson(JSON.parse(v)));
    } catch {
      /* not JSON after all; the text rules below apply */
    }
  }
  // Literal rows in SQL (insert … values (…), (…)) are counted, never kept.
  v = v.replace(/\bvalues\s*\(([\s\S]*)$/i, (_m, rest: string) => `values (… ${1 + (rest.match(/\)\s*,\s*\(/g) ?? []).length} rows not shown)`);
  const lines = v.split("\n");
  // A pasted result set (many lines that all look like delimited data) is not an argument the bot needs.
  const delimited = lines.filter((l) => (l.match(/[,\t|]/g) ?? []).length >= 4).length;
  if (lines.length > 8 && delimited > lines.length / 2) v = `${lines[0]}\n[${lines.length - 1} more delimited lines not shown]`;
  v = blankUrls(v).replace(EMAIL, "[email]").replace(PHONE, "[phone]");
  if (v.length > ARG_MAX_CHARS) v = `${v.slice(0, ARG_MAX_CHARS)}… [${v.length - ARG_MAX_CHARS} more chars]`;
  return v;
}

/** The ordered tool calls of a stored transcript. Pure. */
export function extractMethod(transcript: string): { steps: MethodStep[]; asked: string[]; tool_counts: Record<string, number> } {
  const text = unescapeHtml(transcript);
  const steps: MethodStep[] = [];
  const asked: string[] = [];
  const counts: Record<string, number> = {};
  const turnRe = /<turn n="(\d+)">\s*(Human|Assistant|User):?\s*([\s\S]*?)(?=<turn n="\d+">|$)/g;
  let n = 0;
  for (const turn of text.matchAll(turnRe)) {
    const turnNo = Number(turn[1]);
    const role = turn[2];
    const body = turn[3] ?? "";
    if (role !== "Assistant") {
      const said = body.replace(/<\/turn>\s*$/, "").replace(/\s+/g, " ").trim();
      if (said && asked.length < ASKED_MAX) asked.push(redactArg(said).slice(0, 400));
      continue;
    }
    const toolRe = /<tool name="([^"]+)">([\s\S]*?)<\/tool>/g;
    for (const call of body.matchAll(toolRe)) {
      const tool = call[1]!;
      const args: Record<string, string> = {};
      const paramRe = /<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      for (const p of (call[2] ?? "").matchAll(paramRe)) args[p[1]!] = redactArg(p[2] ?? "");
      if (Object.keys(args).length === 0) {
        const bare = (call[2] ?? "").trim();
        if (bare) args.input = redactArg(bare);
      }
      n += 1;
      counts[tool] = (counts[tool] ?? 0) + 1;
      steps.push({ n, turn: turnNo, tool, args });
    }
  }
  return { steps, asked, tool_counts: counts };
}

export function pageMethod(path: string, extracted: ReturnType<typeof extractMethod>, from = 1, limit = METHOD_PAGE_DEFAULT): MethodPage {
  const start = Math.max(1, Math.floor(from));
  const size = Math.min(METHOD_PAGE_MAX, Math.max(1, Math.floor(limit)));
  const slice = extracted.steps.slice(start - 1, start - 1 + size);
  const next = start - 1 + slice.length < extracted.steps.length ? start + slice.length : null;
  return { path, total_steps: extracted.steps.length, from: start, steps: slice, next_from: next, tool_counts: extracted.tool_counts, asked: extracted.asked };
}

export interface ProcessChange {
  id: number;
  client_tag: string | null;
  summary: string;
  created_at: string;
}

/** Process changes written after a build: what has changed about how lists are built since that record. */
export async function processChangesSince(db: Queryable, since: string | null, clientTag: string): Promise<ProcessChange[]> {
  const { rows: present } = await db.query<{ present: boolean }>(`select to_regclass('topup.process_changes') is not null as present`);
  if (!present[0]?.present) return [];
  const { rows } = await db.query<{ id: string; client_tag: string | null; summary: string; created_at: string }>(
    `select id::text, client_tag, summary, created_at::text from topup.process_changes
      where (client_tag is null or client_tag = 'all' or client_tag = $2)
        and ($1::timestamptz is null or created_at >= $1::timestamptz)
      order by created_at asc, id asc`,
    [since, clientTag],
  );
  return rows.map((r) => ({ id: Number(r.id), client_tag: r.client_tag, summary: r.summary, created_at: r.created_at }));
}

/** Postgres hands timestamps back as Date objects; the record maps them with String(), which is not a timestamptz literal. */
export function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface MethodAnswer {
  client_tag: string;
  campaign_id: number;
  /** True when no list_build_records row names this campaign: the top-up must wait for Josh to record the build. */
  no_recorded_build: boolean;
  records: Array<Pick<BuildRecordRow, "id" | "session_date" | "written_by" | "narrative" | "transcript_path" | "transcript_paths" | "lanes" | "spend_cents" | "yield_by_step" | "provenance_confidence">>;
  method: MethodPage | { error: string } | null;
  process_changes_since_build: ProcessChange[];
  how_to_read: string;
}

export const METHOD_HOW_TO_READ =
  "The transcript is the truth (D96). `method.steps` is every tool call in order with the arguments as typed; `asked` is what the person wanted in their words. Repeat the same calls with your own connectors and the same filters, titles, geography and sources. A recorded URL is shown as its host only and is never reused: re-run the search or export and use the fresh one. `process_changes_since_build` is what changed about how lists are built after this one; apply those on top. When `no_recorded_build` is true, stop: tell Josh the campaign has no recorded build and wait. Never pull a lead row into chat: every row moves through LeadPipe and this service.";

export interface MethodInput {
  client_tag: string;
  campaign_id: number;
  transcript_path?: string | null;
  from?: number | null;
  limit?: number | null;
}

/** The build record, its method page and the process changes since, in one read. */
export async function buildMethod(deps: BuildRecordDeps, input: MethodInput): Promise<MethodAnswer | { error: string }> {
  const base = await buildRecord(deps, { client_tag: input.client_tag, campaign_id: input.campaign_id });
  if ("error" in base) return base;
  const records = base.records;
  const newest = records[0] ?? null;
  const changes = await processChangesSince(deps.db, newest ? isoOrNull(newest.created_at) : null, input.client_tag);
  const answer: MethodAnswer = {
    client_tag: input.client_tag,
    campaign_id: input.campaign_id,
    no_recorded_build: records.length === 0,
    records: records.map((r) => ({ id: r.id, session_date: r.session_date, written_by: r.written_by, narrative: r.narrative, transcript_path: r.transcript_path, transcript_paths: r.transcript_paths, lanes: r.lanes, spend_cents: r.spend_cents, yield_by_step: r.yield_by_step, provenance_confidence: r.provenance_confidence })),
    method: null,
    process_changes_since_build: changes,
    how_to_read: METHOD_HOW_TO_READ,
  };
  if (records.length === 0) return answer;
  const paths = pathsOnRecords(records);
  let path = input.transcript_path ?? null;
  if (path && !paths.includes(path)) {
    answer.method = { error: `transcript_path is not on this campaign's build records (${paths.length} known).` };
    return answer;
  }
  if (!path) path = paths[0] ?? null;
  if (!path) {
    answer.method = { error: "no transcript on the build records: the narrative is the whole method." };
    return answer;
  }
  if (!deps.readTranscript) {
    answer.method = { error: "list-build-transcripts is not configured on this service. Ask Josh." };
    return answer;
  }
  try {
    const text = await deps.readTranscript(path);
    const extracted = extractMethod(text);
    if (extracted.steps.length === 0) {
      answer.method = { error: `no tool calls could be read from ${path} (transcript_format ${newest?.transcript_format ?? "unknown"}, ${text.length} chars). The narrative is the method for this campaign; ask Josh to re-save the transcript if that is not enough.` };
      return answer;
    }
    answer.method = pageMethod(path, extracted, input.from ?? 1, input.limit ?? METHOD_PAGE_DEFAULT);
    if (paths.length > 1) answer.method = { ...answer.method, path: `${path} (${paths.length} transcripts on this campaign; pass transcript_path for another)` };
  } catch (err) {
    answer.method = { error: (err as Error).message };
  }
  return answer;
}
