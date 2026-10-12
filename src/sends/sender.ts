import type { Queryable } from "../db/pool.js";

/**
 * The Smartlead inbox that sent a row of public.sends (D81).
 * Counts and ids only. Never selects a lead email or name.
 */

const INBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSender(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || !INBOX.test(s)) return null;
  return s;
}

/** Pull the sending inbox out of a Smartlead message-history payload. */
export function extractSenderFromHistory(payload: unknown): string | null {
  const root = asRecord(payload);
  const list = firstArray(root, ["history", "messages", "data", "items"]);
  for (const item of list) {
    const o = asRecord(item);
    if (!o) continue;
    const kind = String(o.type ?? o.event ?? o.direction ?? "").toLowerCase();
    if (kind && !/sent|outbound|from_me|email_sent/.test(kind)) continue;
    const hit =
      normalizeSender(o.from) ??
      normalizeSender(o.from_email) ??
      normalizeSender(o.sender) ??
      normalizeSender(o.fromEmail) ??
      normalizeSender(asRecord(o.email_account)?.from_email) ??
      normalizeSender(asRecord(o.email_account)?.email) ??
      normalizeSender(asRecord(o.from_address)?.email);
    if (hit) return hit;
  }
  return (
    normalizeSender(root?.from) ??
    normalizeSender(root?.from_email) ??
    normalizeSender(asRecord(root?.email_account)?.from_email)
  );
}

/** Pull the sending inbox off a campaign-lead row when Smartlead already stored it. */
export function extractSenderFromLead(payload: unknown): string | null {
  const o = asRecord(payload);
  if (!o) return null;
  return (
    normalizeSender(o.last_sent_from) ??
    normalizeSender(o.from_email) ??
    normalizeSender(o.sender) ??
    normalizeSender(o.sent_from) ??
    normalizeSender(asRecord(o.email_account)?.from_email) ??
    normalizeSender(asRecord(o.email_account)?.email) ??
    normalizeSender(asRecord(o.email_lead_map)?.from_email) ??
    normalizeSender(asRecord(o.lead)?.from_email)
  );
}

/** Write-forward: stamp sender on one send row. Idempotent. Never writes dl_status, sg_exclude, or skip_*. */
export async function writeSendSender(db: Queryable, sendId: string, sender: string): Promise<number> {
  const inbox = normalizeSender(sender);
  if (!inbox) return 0;
  const { rowCount } = await db.query(
    `update public.sends set sender = $2, updated_at = now()
      where id = $1::uuid and sent and (sender is null or sender = $2)`,
    [sendId, inbox],
  );
  return rowCount ?? 0;
}

/** Write-forward: stamp every sent row for one campaign/lead pair that still lacks sender. */
export async function writeSendSenderByPair(
  db: Queryable,
  input: { campaignId: string; leadId: string; sender: string },
): Promise<number> {
  const inbox = normalizeSender(input.sender);
  if (!inbox) return 0;
  const { rowCount } = await db.query(
    `update public.sends set sender = $3, updated_at = now()
      where campaign_id = $1::uuid and lead_id = $2::uuid and sent and sender is null`,
    [input.campaignId, input.leadId, inbox],
  );
  return rowCount ?? 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function firstArray(root: Record<string, unknown> | null, keys: string[]): unknown[] {
  if (!root) return [];
  for (const k of keys) {
    const v = root[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}
