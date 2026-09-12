import { z } from "zod";

/**
 * A pull receipt (D31, D32). Claude writes one after a first list; this
 * service inserts another after every import (never updates in place).
 * Lane rows hold the filter set. Build rows hold one source_label and its
 * measured yield. Counts, ids, filters, method names. Never emails.
 */

export const COMPANY_SOURCES = [
  "getleads",
  "maps",
  "permits",
  "maps_and_permits",
  "parcels",
  "ai_ark",
  "table",
  "other",
] as const;

export const DOMAIN_SOURCES = ["already", "getleads", "maps", "domain_waterfall", "none", "other"] as const;
export const PERSON_SOURCES = ["already", "getleads", "ai_ark", "people_waterfall", "serp", "hard_to_find", "none", "other"] as const;
export const EMAIL_SOURCES = ["already", "getleads", "name_to_email", "email_waterfall", "none", "other"] as const;
export const EMAIL_TIERS = ["getleads", "smartlead", "aiark", "leadmagic", "prospeo", "fullenrich"] as const;

const snake = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const yieldByStepSchema = z
  .object({
    companies: z.number().int().nonnegative().optional(),
    with_domain: z.number().int().nonnegative().optional(),
    with_person: z.number().int().nonnegative().optional(),
    with_email: z.number().int().nonnegative().optional(),
    verified_sendable: z.number().int().nonnegative().optional(),
    imported: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const segmentSchema = z
  .object({
    band: z.array(z.string()).optional(),
    mail_class: z.array(z.string()).optional(),
    gift: z.union([z.string(), z.array(z.string())]).optional(),
    offer_key: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();

export const pullReceiptSchema = z
  .object({
    written_by: z.string().min(1).default("claude"),
    supabase_project: z.literal("azpapwtnrbzywlnxxecz").default("azpapwtnrbzywlnxxecz"),
    client_tag: snake,
    smartlead_client_id: z.number().int().positive().nullable().default(null),
    lane: snake,
    campaign_ids: z.array(z.number().int().positive()).default([]),
    icp_kind: z.enum(["linkedin_native", "physical"]),
    persona: snake,
    company_source: z.enum(COMPANY_SOURCES),
    company_filters: z.record(z.unknown()).default({}),
    domain_source: z.enum(DOMAIN_SOURCES),
    person_source: z.enum(PERSON_SOURCES),
    email_source: z.enum(EMAIL_SOURCES),
    email_max_tier: z.enum(EMAIL_TIERS).nullable().default(null),
    rows_found: z.number().int().nonnegative().nullable().default(null),
    rows_imported: z.number().int().nonnegative().nullable().default(null),
    tam_count: z.number().int().nonnegative().nullable().default(null),
    how_i_did_it: z.string().min(20),
    notes: z.string().nullable().default(null),
    segment: segmentSchema.nullable().default(null),
    yield_by_step: yieldByStepSchema.nullable().default(null),
    spend_cents: z.number().int().nonnegative().nullable().default(null),
    suppression_scope: z.string().nullable().default("response_based_v1"),
    build_label: z.string().nullable().default(null),
    granularity: z.enum(["build", "lane"]).default("build"),
    owner_confirmed_at: z.string().datetime().nullable().default(null),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.granularity === "lane" && r.campaign_ids.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["campaign_ids"], message: "a lane receipt must name at least one campaign" });
    }
  });

export type PullReceipt = z.infer<typeof pullReceiptSchema>;

export function parsePullReceipt(input: unknown): PullReceipt {
  const r = pullReceiptSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`invalid pull receipt:\n  ${issues}`);
  }
  return r.data;
}

/** Backfill rows that say "Josh to confirm" are for proposals only. */
export function receiptConfirmed(r: Pick<PullReceipt, "owner_confirmed_at" | "notes">): boolean {
  if (r.owner_confirmed_at) return true;
  return !/josh to confirm/i.test(r.notes ?? "");
}

export type YieldPick = { receipt: PullReceipt; imported: number; found: number };

/** Best measured build for a lane. Lane rows are the filter book; builds are the yield. */
export function bestYieldBuild(receipts: PullReceipt[]): YieldPick | null {
  const builds = receipts.filter((r) => r.granularity === "build");
  if (builds.length === 0) return null;
  const scored = builds
    .map((receipt) => ({
      receipt,
      imported: receipt.rows_imported ?? receipt.yield_by_step?.imported ?? 0,
      found: receipt.rows_found ?? 0,
    }))
    .sort((a, b) => b.imported - a.imported || b.found - a.found);
  return scored[0] ?? null;
}

export function latestLaneReceipt(receipts: PullReceipt[]): PullReceipt | null {
  return receipts.find((r) => r.granularity === "lane") ?? null;
}
