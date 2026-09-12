import { z } from "zod";

/**
 * A first-pull receipt (D31). Claude writes one after the first list for a
 * campaign; this service reads the latest row to get more of the same people.
 * Counts, ids, filters, method names. Never emails.
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

export const pullReceiptSchema = z
  .object({
    written_by: z.string().min(1).default("claude"),
    supabase_project: z.literal("azpapwtnrbzywlnxxecz").default("azpapwtnrbzywlnxxecz"),
    client_tag: snake,
    smartlead_client_id: z.number().int().positive().nullable().default(null),
    lane: snake,
    campaign_ids: z.array(z.number().int().positive()).min(1),
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
  })
  .strict();

export type PullReceipt = z.infer<typeof pullReceiptSchema>;

export function parsePullReceipt(input: unknown): PullReceipt {
  const r = pullReceiptSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`invalid pull receipt:\n  ${issues}`);
  }
  return r.data;
}
