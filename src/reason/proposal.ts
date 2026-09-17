import { z } from "zod";
import {
  COMPANY_SOURCES,
  DOMAIN_SOURCES,
  EMAIL_SOURCES,
  EMAIL_TIERS,
  PERSON_SOURCES,
} from "../recipes/receipt.js";

/**
 * D39 — structured proposal the reasoner must return. Code validates this
 * before a card renders. Counts, ids, filters. Never emails.
 */

export const VERDICTS = ["repeat", "avoid", "unknown"] as const;
export const ACTIONS = ["repeat", "widen", "new_segment", "hold"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

const bandValue = z.union([z.string().min(1), z.number()]).transform((v, ctx) => {
  if (typeof v === "number") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "company_size bands must be label strings, never integers" });
    return z.NEVER;
  }
  return v;
});

export const segmentSchema = z
  .object({
    icp_kind: z.enum(["linkedin_native", "physical"]),
    company_source: z.enum(COMPANY_SOURCES),
    company_filters: z.record(z.unknown()).default({}),
    domain_source: z.enum(DOMAIN_SOURCES),
    person_source: z.enum(PERSON_SOURCES),
    email_source: z.enum(EMAIL_SOURCES),
    email_max_tier: z.enum(EMAIL_TIERS).nullable().default(null),
    band: z.array(z.string()).default([]),
    mail_class: z.array(z.string()).default([]),
    gift: z.string().nullable().default(null),
    offer_key: z.array(z.string()).default([]),
  })
  .strict();

export const diffSchema = z
  .object({
    field: z.string().min(1),
    was: z.unknown(),
    now: z.unknown(),
    why: z.string().min(1),
  })
  .strict();

export const wideningOptionSchema = z
  .object({
    label: z.string().min(1),
    company_filters: z.record(z.unknown()).default({}),
    pool: z.number().int().nonnegative(),
    net_new: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative(),
  })
  .strict();

export const proposalSchema = z
  .object({
    lane: z.string().regex(/^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/),
    basis_receipt_ids: z.array(z.string().uuid()).default([]),
    basis_verdicts: z.record(z.enum(VERDICTS)).default({}),
    action: z.enum(ACTIONS),
    segment: segmentSchema,
    diff_from_basis: z.array(diffSchema).default([]),
    counts: z
      .object({
        pool: z.number().int().nonnegative(),
        already_in_client: z.number().int().nonnegative(),
        suppressed: z.number().int().nonnegative(),
        projected_net_new: z.number().int().nonnegative(),
        projected_verified: z.number().int().nonnegative(),
        expected_interested_per_2000: z.number().nullable().default(null),
      })
      .strict(),
    cost: z
      .object({
        worst_case_usd: z.number().nonnegative(),
        by_step: z.record(z.number()).default({}),
      })
      .strict(),
    widening_options: z.array(wideningOptionSchema).default([]),
    pilot_required: z.boolean(),
    confidence: z.enum(CONFIDENCE),
    reasons: z.array(z.string().min(1)).min(1),
    flags: z.array(z.string()).default([]),
    count_call_id: z.string().min(1).nullable().default(null),
  })
  .strict()
  .superRefine((p, ctx) => {
    const sizes = (p.segment.company_filters as { company_size?: unknown }).company_size;
    if (Array.isArray(sizes)) {
      for (const [i, s] of sizes.entries()) {
        const parsed = bandValue.safeParse(s);
        if (!parsed.success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["segment", "company_filters", "company_size", i], message: "band values must be label strings, never integers" });
        }
      }
    }
    if ((p.segment.icp_kind === "physical" || p.action === "new_segment") && !p.pilot_required) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pilot_required"], message: "physical lanes and new_segment require a 100-row pilot" });
    }
  });

export type SegmentPlan = z.infer<typeof segmentSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Verdict = (typeof VERDICTS)[number];
export type Action = (typeof ACTIONS)[number];

export function parseProposal(input: unknown): { ok: true; proposal: Proposal } | { ok: false; message: string } {
  const r = proposalSchema.safeParse(input);
  if (r.success) return { ok: true, proposal: r.data };
  return { ok: false, message: r.error.issues.map((i) => `${i.path.join(".") || "proposal"}: ${i.message}`).join("; ") };
}
