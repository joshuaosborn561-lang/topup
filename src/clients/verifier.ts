import { McpHttpClient } from "./mcpHttp.js";

/**
 * Email Verifier Progression (MillionVerifier -> No2Bounce). Wrapped here so
 * the stall runbook in stages/verify has one narrow interface to drive and
 * tests can drive it with a fake. Summaries only — never per-email data.
 */

export type VerifierRunStatus =
  | "queued"
  | "classifying_mx"
  | "verifying_mv"
  | "verifying_n2b"
  | "merging"
  | "completed"
  | "failed"
  | "paused"
  | string;

export interface VerifierStatus {
  run_id: string;
  status: VerifierRunStatus;
  total_emails: number;
  stage_completed: "none" | "mx" | "mv" | "n2b" | "merge" | string;
  retry_count: number;
  last_error: string | null;
  mv_ok_count: number;
  mv_catch_all_count: number;
  mv_unknown_count: number;
  mv_invalid_count: number;
  mv_credits_used: number;
  n2b_credits_used: number;
  final_sendable_count: number;
  final_rejected_count: number;
  useful_output_count: number;
  mail_class_seg_count: number;
  /** Latest MillionVerifier progress seen in logs or last_error, if any. */
  progress: { percent: number; verified: number } | null;
}

export interface VerifierResults {
  partial: boolean;
  resolved_counts: Record<string, number> | null;
  salvage_decision: { action: "fresh_ok" | "resume" | "salvage" | "done"; reason: string; do_not_resume?: boolean } | null;
  sendable_url: string | null;
  rejected_url: string | null;
  unresolved_url: string | null;
}

export interface Verifier {
  start(fileUrl: string, segmentName: string, priorRunId?: string | null): Promise<{ run_id: string }>;
  status(runId: string): Promise<VerifierStatus>;
  results(runId: string): Promise<VerifierResults>;
  /** Free: reloads the existing MV file. The server refuses a third resume on an unmoving stall. */
  resume(runId: string): Promise<{ status: string }>;
}

const PROGRESS_RE = /percent=(\d+)[^\n]*?verified=(\d+)/i;

export function parseProgress(text: string | null | undefined): { percent: number; verified: number } | null {
  if (!text) return null;
  const m = text.match(PROGRESS_RE);
  return m ? { percent: Number(m[1]), verified: Number(m[2]) } : null;
}

export class VerifierClient implements Verifier {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(`${baseUrl.replace(/\/$/, "")}/mcp`, "", fetchImpl);
  }

  async start(fileUrl: string, segmentName: string, priorRunId?: string | null): Promise<{ run_id: string }> {
    if (!this.baseUrl) throw new Error("VERIFIER_BASE_URL is not configured; cannot submit a verification");
    const res = await this.mcp.call<{ run_id?: string; error?: string }>("start_verification", {
      file_url: fileUrl,
      segment_name: segmentName,
      ...(priorRunId ? { prior_run_id: priorRunId } : {}),
    });
    if (!res.run_id) throw new Error(`start_verification: ${res.error ?? "no run_id"}`);
    return { run_id: res.run_id };
  }

  async status(runId: string): Promise<VerifierStatus> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/runs/${runId}`);
    if (!res.ok) throw new Error(`verifier status HTTP ${res.status}`);
    const body = (await res.json()) as { run: Record<string, unknown>; logs?: Array<{ message?: string }> };
    const r = body.run;
    const logs = body.logs ?? [];
    let progress: { percent: number; verified: number } | null = null;
    for (let i = logs.length - 1; i >= 0 && !progress; i--) progress = parseProgress(logs[i]?.message);
    if (!progress) progress = parseProgress((r.last_error as string) ?? (r.error_message as string));
    const n = (k: string) => Number(r[k] ?? 0) || 0;
    const sendable = n("final_sendable_count");
    return {
      run_id: String(r.id ?? runId),
      status: String(r.status),
      total_emails: n("total_emails"),
      stage_completed: String(r.stage_completed ?? "none"),
      retry_count: n("retry_count"),
      last_error: (r.last_error as string) ?? (r.error_message as string) ?? null,
      mv_ok_count: n("mv_ok_count"),
      mv_catch_all_count: n("mv_catch_all_count"),
      mv_unknown_count: n("mv_unknown_count"),
      mv_invalid_count: n("mv_invalid_count"),
      mv_credits_used: n("mv_credits_used"),
      n2b_credits_used: n("n2b_credits_used"),
      final_sendable_count: sendable,
      final_rejected_count: n("final_rejected_count"),
      useful_output_count: sendable,
      mail_class_seg_count: n("mail_class_seg_count"),
      progress,
    };
  }

  async results(runId: string): Promise<VerifierResults> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/runs/${runId}/results`);
    if (!res.ok) throw new Error(`verifier results HTTP ${res.status}`);
    const b = (await res.json()) as Record<string, unknown>;
    return {
      partial: Boolean(b.partial),
      resolved_counts: (b.resolved_counts as Record<string, number>) ?? null,
      salvage_decision: (b.salvage_decision as VerifierResults["salvage_decision"]) ?? null,
      sendable_url: (b.sendable_url as string) ?? null,
      rejected_url: (b.rejected_url as string) ?? null,
      unresolved_url: (b.unresolved_url as string) ?? null,
    };
  }

  async resume(runId: string): Promise<{ status: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/runs/${runId}/resume`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!res.ok) throw new Error(`resume refused: ${body.error ?? res.status}`);
    return { status: body.status ?? "unknown" };
  }
}
