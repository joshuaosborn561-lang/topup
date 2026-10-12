import type { Queryable } from "../db/pool.js";
import type { SpendRails } from "../spend/rails.js";
import { usd, worstCaseCents } from "../spend/prices.js";
import type { JevClassify } from "../clients/jevClassify.js";
import { NOT_INTERESTED_CATEGORY_ID, SMARTLEAD_DNC_CATEGORY_ID } from "./classify.js";
import { hasNegativeClassColumn, writeNegativeClass } from "./store.js";

/**
 * D90 — leftover-negative AI runner. Text/category already ran (D81).
 * Jev (same OpenRouter path as icp-llm; key via topup.jev_openrouter_key,
 * D91) classifies each leftover inbound body. Estimate first; approved_by
 * runs it; $0.05 hard cap. Idempotent.
 * No body stays unclassified. Counts only; bodies never leave this file.
 */

export const LEFTOVER_AI_HARD_CAP_CENTS = 5;
export const LEFTOVER_AI_VENDOR = "jev" as const;
export const LEFTOVER_AI_ACTION = "grade" as const;
export const LEFTOVER_AI_STEP = "icp" as const;
export const LEFTOVER_AI_LEDGER_TAG = "ops";

export interface LeftoverRow {
  id: string;
  body: string;
}

export interface LeftoverAiDeps {
  db: Queryable;
  rails: Pick<SpendRails, "gate" | "record">;
  jev: JevClassify | null;
  list?: (db: Queryable) => Promise<LeftoverRow[]>;
  write?: typeof writeNegativeClass;
}

export interface LeftoverAiResult {
  status: "waiting_approval" | "done" | "refused";
  queued: number;
  no_body: number;
  wrote_unsubscribe: number;
  wrote_not_interested: number;
  still_unclassified: number;
  errors: number;
  worst_case_cents: number;
  hard_cap_cents: number;
  cost_cents: number;
  vendor: "jev";
  last_error: string | null;
  note: string;
  next: string;
}

const EMPTY_COUNTS = { wrote_unsubscribe: 0, wrote_not_interested: 0, errors: 0 };

export function leftoverWorstCaseCents(queued: number): number {
  return worstCaseCents(LEFTOVER_AI_VENDOR, LEFTOVER_AI_ACTION, queued);
}

export async function listLeftoverNegatives(db: Queryable): Promise<LeftoverRow[]> {
  if (!(await hasNegativeClassColumn(db))) return [];
  const { rows: haveMsg } = await db.query<{ ok: boolean }>(`select to_regclass('public.messages') is not null as ok`);
  if (!haveMsg[0]?.ok) return [];
  const { rows } = await db.query<{ id: string; body: string | null }>(
    `with leftover as (
       select l.id
         from public.leads l
        where l.email is not null
          and l.negative_class is null
          and (l.category_id in (${NOT_INTERESTED_CATEGORY_ID}, ${SMARTLEAD_DNC_CATEGORY_ID})
               or lower(coalesce(l.status, '')) = 'unsubscribed')
     ),
     latest as (
       select distinct on (m.lead_id) m.lead_id, coalesce(m.body, '') as body
         from public.messages m
        where m.direction = 'inbound'
          and m.lead_id in (select id from leftover)
        order by m.lead_id, coalesce(m.received_at, m.sent_at, m.created_at) desc
     )
     select l.id::text as id, coalesce(i.body, '') as body
       from leftover l
       left join latest i on i.lead_id = l.id
      limit 2000`,
  );
  return rows.map((r) => ({ id: r.id, body: r.body ?? "" }));
}

function split(rows: LeftoverRow[]): { queued: LeftoverRow[]; no_body: number } {
  const queued: LeftoverRow[] = [];
  let no_body = 0;
  for (const r of rows) {
    if (r.body.trim().length === 0) no_body += 1;
    else queued.push({ id: r.id, body: r.body });
  }
  return { queued, no_body };
}

function result(
  status: LeftoverAiResult["status"],
  queued: number,
  no_body: number,
  worst: number,
  extra: Partial<LeftoverAiResult> & { note: string; next: string },
): LeftoverAiResult {
  return {
    status,
    queued,
    no_body,
    wrote_unsubscribe: extra.wrote_unsubscribe ?? 0,
    wrote_not_interested: extra.wrote_not_interested ?? 0,
    still_unclassified: extra.still_unclassified ?? queued + no_body,
    errors: extra.errors ?? 0,
    worst_case_cents: worst,
    hard_cap_cents: LEFTOVER_AI_HARD_CAP_CENTS,
    cost_cents: extra.cost_cents ?? 0,
    vendor: LEFTOVER_AI_VENDOR,
    last_error: extra.last_error ?? null,
    note: extra.note,
    next: extra.next,
  };
}

export async function classifyLeftover(d: LeftoverAiDeps, input: { approved_by?: string | null } = {}): Promise<LeftoverAiResult> {
  const rows = await (d.list ?? listLeftoverNegatives)(d.db);
  const { queued, no_body } = split(rows);
  const worst = leftoverWorstCaseCents(queued.length);
  const by = (input.approved_by ?? "").trim();

  if (queued.length === 0) {
    return result("done", 0, no_body, 0, {
      still_unclassified: no_body,
      cost_cents: 0,
      note: no_body
        ? `${no_body} leftover negatives have no inbound body and stay unclassified. Nothing to send to Jev.`
        : "No unclassified leftovers with a body. Already classified rows are left alone.",
      next: "Nothing to call. Unclassified-with-no-body stay that way.",
    });
  }

  if (worst > LEFTOVER_AI_HARD_CAP_CENTS) {
    return result("refused", queued.length, no_body, worst, {
      still_unclassified: queued.length + no_body,
      note: `Jev worst case ${usd(worst)} is over the ${usd(LEFTOVER_AI_HARD_CAP_CENTS)} hard cap. Not sent. Ask Josh.`,
      next: "Ask Josh. The leftover AI cap is $0.05.",
    });
  }

  if (!by) {
    return result("waiting_approval", queued.length, no_body, worst, {
      still_unclassified: queued.length + no_body,
      note:
        `${queued.length} leftover negatives need Jev (same OpenRouter path as icp-llm). ` +
        `Worst case ${usd(worst)} (hard cap ${usd(LEFTOVER_AI_HARD_CAP_CENTS)}). ` +
        `${no_body} have no inbound body and stay unclassified.`,
      next: `classify_leftover(approved_by="Name")`,
    });
  }

  if (!d.jev) {
    return result("refused", queued.length, no_body, worst, {
      still_unclassified: queued.length + no_body,
      note: "Jev is not configured (ICP_JEV_MODEL / topup.jev_openrouter_key, the same secret icp-llm uses). Ask Josh.",
      next: "Ask Josh.",
    });
  }

  const decision = await d.rails.gate({
    runId: "canon",
    clientTag: LEFTOVER_AI_LEDGER_TAG,
    step: LEFTOVER_AI_STEP,
    vendor: LEFTOVER_AI_VENDOR,
    action: LEFTOVER_AI_ACTION,
    rows: queued.length,
    recipeAuthorised: true,
    approvedCents: LEFTOVER_AI_HARD_CAP_CENTS,
    worstCaseCents: worst,
  });
  if (decision.kind !== "proceed") {
    return result(decision.kind === "blocked" ? "refused" : "waiting_approval", queued.length, no_body, decision.worstCaseCents, {
      still_unclassified: queued.length + no_body,
      note: `Not sent: ${decision.reason}`,
      next: decision.kind === "ask" ? `classify_leftover(approved_by="Name")` : "Ask Josh.",
    });
  }

  const write = d.write ?? writeNegativeClass;
  const counts = { ...EMPTY_COUNTS };
  let classified = 0;
  let last_error: string | null = null;
  for (const row of queued) {
    try {
      const hit = await d.jev.classify(row.body);
      if (!hit.class) {
        counts.errors += 1;
        last_error ??= "jev choice unparseable";
        continue;
      }
      const n = await write(d.db, row.id, hit.class, "ai");
      if (n > 0) {
        classified += 1;
        if (hit.class === "unsubscribe") counts.wrote_unsubscribe += 1;
        else counts.wrote_not_interested += 1;
      }
    } catch (err) {
      counts.errors += 1;
      last_error ??= String((err as Error).message ?? "failed").slice(0, 120);
    }
  }

  const cost = leftoverWorstCaseCents(classified);
  await d.rails
    .record({
      runId: null,
      clientTag: LEFTOVER_AI_LEDGER_TAG,
      step: LEFTOVER_AI_STEP,
      vendor: LEFTOVER_AI_VENDOR,
      action: LEFTOVER_AI_ACTION,
      rows: classified,
      credits: classified,
      worstCaseCents: worst,
      balanceBefore: null,
      balanceAfter: null,
      vendorJobId: null,
      approvedBy: by,
    })
    .catch(() => undefined);

  const still = queued.length - classified + no_body;
  return result("done", queued.length, no_body, worst, {
    ...counts,
    still_unclassified: still,
    cost_cents: cost,
    last_error,
    note:
      `Jev classified ${classified} of ${queued.length} leftovers (source=ai). ` +
      `${counts.wrote_unsubscribe} unsubscribe, ${counts.wrote_not_interested} not_interested. ` +
      `${no_body} no-body stay unclassified. ${counts.errors} unparseable or failed. Cost ${usd(cost)}.` +
      (last_error ? ` last_error=${last_error}` : ""),
    next: still > no_body ? `classify_leftover(approved_by="${by}")` : "Nothing to call.",
  });
}

export function leftoverAiPromptLock(): string {
  return ["unsubscribe", "not_interested", "explicit", "stop", "remove", "no body", "approved_by", "hard cap"].join(" ");
}
