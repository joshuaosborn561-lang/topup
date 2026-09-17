import type { PullReceipt } from "../recipes/receipt.js";
import type { Exclusion } from "./exclusions.js";
import type { InventoryRow } from "./inventory.js";
import type { Verdict } from "./proposal.js";

/** Outcome view row. Counts only. */
export type ReceiptOutcome = {
  receipt_id: string;
  sends: number;
  interested: number;
  bounces: number;
  bounce_rate: number;
  interested_per_2000: number;
  variant_repeat: boolean;
  verdict: Verdict;
  josh_confirmed: boolean;
};

export type LaneRunway = {
  campaign_id: number;
  name: string | null;
  status: string | null;
  leads_total: number;
  untouched: number;
  sends_7d: number;
  daily_send_rate: number | null;
  days_remaining: number | null;
};

export type ReceiptPicture = PullReceipt & { receipt_id: string; written_by: string };

/**
 * Everything Supabase knows about a lane, counts and tags only.
 * This is the user turn of the reasoner. Never emails, never lead rows.
 */
export type LanePicture = {
  client_tag: string;
  lane: string;
  receipts: ReceiptPicture[];
  outcomes: ReceiptOutcome[];
  runway: LaneRunway[];
  exclusions: Exclusion[];
  inventory: InventoryRow[];
  prose: {
    merged_list: string;
    servers: string;
    client_skill: string;
    source_skills: string[];
  };
};

export function pictureJson(p: LanePicture): unknown {
  return {
    client_tag: p.client_tag,
    lane: p.lane,
    receipts: p.receipts.map((r) => ({
      receipt_id: r.receipt_id,
      written_by: r.written_by,
      granularity: r.granularity,
      build_label: r.build_label,
      campaign_ids: r.campaign_ids,
      icp_kind: r.icp_kind,
      persona: r.persona,
      company_source: r.company_source,
      company_filters: r.company_filters,
      domain_source: r.domain_source,
      person_source: r.person_source,
      email_source: r.email_source,
      email_max_tier: r.email_max_tier,
      rows_found: r.rows_found,
      rows_imported: r.rows_imported,
      tam_count: r.tam_count,
      spend_cents: r.spend_cents,
      yield_by_step: r.yield_by_step,
      segment: r.segment,
      notes: r.notes,
      how_i_did_it: r.how_i_did_it,
      owner_confirmed_at: r.owner_confirmed_at,
    })),
    outcomes: p.outcomes,
    runway: p.runway,
    exclusions: p.exclusions.map((e) => ({
      id: e.id,
      client_tag: e.client_tag,
      lane: e.lane,
      kind: e.kind,
      value: e.value,
      reason: e.reason,
    })),
    inventory: p.inventory,
    hygiene: {
      backfill_lane: "written_by=claude_backfill: filters are a reconstruction; confidence medium until josh_confirmed; flag every card",
      backfill_build: "written_by=claude_backfill_build: use for outcome joins and yield, not as runnable filters",
      tam: "tam_count is null on every backfill row; rows_found is ingest size, not the pool; recount before proposing",
      empty_campaigns: "build rows with empty campaign_ids were pulled and never loaded — inventory, free first option",
      notes: "read notes on every basis receipt; repeat cautionary lines in flags",
    },
  };
}

export async function loadLanePicture(
  query: <T extends Record<string, unknown>>(sql: string, params: unknown[]) => Promise<T[]>,
  clientTag: string,
  lane: string,
  prose: LanePicture["prose"],
  inventory: InventoryRow[],
): Promise<LanePicture> {
  const receipts = await query<Record<string, unknown>>(
    `select receipt_id::text, written_at::text, written_by, client_tag, smartlead_client_id, lane,
            campaign_ids, icp_kind, persona, company_source, company_filters, domain_source,
            person_source, email_source, email_max_tier, rows_found, rows_imported, tam_count,
            how_i_did_it, notes, segment, yield_by_step, spend_cents, suppression_scope,
            build_label, granularity, owner_confirmed_at, josh_confirmed, basis_receipt_ids
       from topup.pull_receipts
      where client_tag = $1 and lane = $2
      order by (granularity = 'lane') desc, written_at desc`,
    [clientTag, lane],
  );
  const outcomes = await query<Record<string, unknown>>(
    `select o.receipt_id::text, o.sends, o.interested, o.bounces, o.bounce_rate,
            o.interested_per_2000, o.variant_repeat, o.verdict, o.josh_confirmed
       from topup.v_receipt_outcome o
       join topup.pull_receipts r on r.receipt_id = o.receipt_id
      where r.client_tag = $1 and r.lane = $2`,
    [clientTag, lane],
  );
  const runway = await query<Record<string, unknown>>(
    `select campaign_id, name, status, leads_total, untouched, sends_7d, daily_send_rate, days_remaining
       from topup.v_lane_runway where client_tag = $1 and lane = $2`,
    [clientTag, lane],
  );
  const exclusions = await query<Record<string, unknown>>(
    `select id::text, client_tag, lane, kind, value, reason, decided_on::text, decided_by, active
       from topup.lane_exclusions
      where active and (client_tag = $1 or client_tag = 'all') and (lane is null or lane = $2)`,
    [clientTag, lane],
  );

  return {
    client_tag: clientTag,
    lane,
    receipts: receipts.map(receiptFromRow),
    outcomes: outcomes.map((o) => ({
      receipt_id: String(o.receipt_id),
      sends: Number(o.sends),
      interested: Number(o.interested),
      bounces: Number(o.bounces),
      bounce_rate: Number(o.bounce_rate),
      interested_per_2000: Number(o.interested_per_2000),
      variant_repeat: Boolean(o.variant_repeat),
      verdict: o.verdict as ReceiptOutcome["verdict"],
      josh_confirmed: Boolean(o.josh_confirmed),
    })),
    runway: runway.map((r) => ({
      campaign_id: Number(r.campaign_id),
      name: (r.name as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      leads_total: Number(r.leads_total),
      untouched: Number(r.untouched),
      sends_7d: Number(r.sends_7d),
      daily_send_rate: r.daily_send_rate == null ? null : Number(r.daily_send_rate),
      days_remaining: r.days_remaining == null ? null : Number(r.days_remaining),
    })),
    exclusions: exclusions.map((e) => ({
      id: String(e.id),
      client_tag: String(e.client_tag),
      lane: (e.lane as string | null) ?? null,
      kind: e.kind as Exclusion["kind"],
      value: String(e.value),
      reason: String(e.reason),
      decided_on: String(e.decided_on),
      decided_by: String(e.decided_by ?? "josh"),
      active: Boolean(e.active),
    })),
    inventory,
    prose,
  };
}

function receiptFromRow(row: Record<string, unknown>): ReceiptPicture {
  const ids = Array.isArray(row.campaign_ids) ? row.campaign_ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : [];
  return {
    receipt_id: String(row.receipt_id),
    written_by: String(row.written_by ?? "claude"),
    supabase_project: "azpapwtnrbzywlnxxecz",
    client_tag: String(row.client_tag),
    smartlead_client_id: row.smartlead_client_id == null ? null : Number(row.smartlead_client_id),
    lane: String(row.lane),
    campaign_ids: ids,
    icp_kind: row.icp_kind as ReceiptPicture["icp_kind"],
    persona: String(row.persona),
    company_source: row.company_source as ReceiptPicture["company_source"],
    company_filters: (row.company_filters as Record<string, unknown>) ?? {},
    domain_source: row.domain_source as ReceiptPicture["domain_source"],
    person_source: row.person_source as ReceiptPicture["person_source"],
    email_source: row.email_source as ReceiptPicture["email_source"],
    email_max_tier: (row.email_max_tier as ReceiptPicture["email_max_tier"]) ?? null,
    rows_found: row.rows_found == null ? null : Number(row.rows_found),
    rows_imported: row.rows_imported == null ? null : Number(row.rows_imported),
    tam_count: row.tam_count == null ? null : Number(row.tam_count),
    how_i_did_it: String(row.how_i_did_it ?? "reconstructed receipt; recount before proposing."),
    notes: (row.notes as string | null) ?? null,
    segment: (row.segment as ReceiptPicture["segment"]) ?? null,
    yield_by_step: (row.yield_by_step as ReceiptPicture["yield_by_step"]) ?? null,
    spend_cents: row.spend_cents == null ? null : Number(row.spend_cents),
    suppression_scope: (row.suppression_scope as string | null) ?? "response_based_v1",
    build_label: (row.build_label as string | null) ?? null,
    granularity: (row.granularity as "build" | "lane") ?? "build",
    owner_confirmed_at: row.owner_confirmed_at ? String(row.owner_confirmed_at) : null,
    josh_confirmed: Boolean(row.josh_confirmed),
    basis_receipt_ids: Array.isArray(row.basis_receipt_ids) ? row.basis_receipt_ids.filter((x): x is string => typeof x === "string") : [],
  };
}
