import { z } from "zod";

/**
 * The settings of one top-up job (D99). Nothing here is a settings: the
 * method lives in the campaign's build transcript and Grokbot replays it
 * with its own connectors. These are only what the referee stages need to
 * run on the pool it hands over: where the pool is, which client, which
 * campaign, and the fixed defaults of the shared tail (dedupe, unsubscribes,
 * the ICP website check, verification, merge fields, staging, import).
 * Client-agnostic; no per-client branch anywhere.
 */
const ident = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");

export const poolSource = z.discriminatedUnion("kind", [
  /** A CSV the bot exported with its own connector (GetLeads export, a LeadPipe export, any signed URL). LeadPipe ingests it. */
  z.object({ kind: z.literal("file_url"), urls: z.array(z.string().url()).min(1) }),
  /** A table or view on campaignintelligence the bot built in SQL. The service copies the standard columns into the lane table. */
  z.object({ kind: z.literal("table"), table: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "schema.table"), where: z.string().min(1).default("true") }),
]);

export const jobSettingsSchema = z
  .object({
    id: z.string().min(1),
    client_tag: ident,
    lane: ident,
    smartlead_client_id: z.number().int().positive(),
    campaign_id: z.number().int().positive(),
    source: poolSource,
    suppression: z.object({ public_suppression: z.boolean().default(true), bounced_any_client: z.boolean().default(true) }).default({}),
    verify: z.object({ reject_rate_norm: z.number().min(0).max(1).nullable().default(null), drop_gateway_catchalls: z.boolean().default(false) }).default({}),
    normalize: z
      .object({
        names_cities: z.boolean().default(true),
        company: z.boolean().default(true),
        location: z.boolean().default(true),
        sports_team: z.object({ league: z.enum(["mlb", "nfl", "both"]).default("both"), pro_only: z.boolean().default(false) }).nullable().default({ league: "both", pro_only: false }),
        first_name_fallback: z.string().min(1).max(40).nullable().optional(),
      })
      .default({}),
    qa: z.array(z.string()).default([]),
    reroute: z.record(z.number().int().positive()).default({}),
    segments: z.record(z.array(z.string())).default({}),
    routing: z.array(z.object({ when: z.record(z.string()), campaign_id: z.number().int().positive() })).default([]),
    required_fields: z.array(z.string()).default([]),
  })
  .strict();

export type JobSettings = z.infer<typeof jobSettingsSchema>;
export type PoolSource = JobSettings["source"];

export function parseJobSettings(input: unknown): JobSettings {
  const r = jobSettingsSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`invalid job settings:\n  ${issues}`);
  }
  return r.data;
}

export interface JobSpec {
  client_tag: string;
  smartlead_client_id: number;
  campaign_id: number;
  source: PoolSource;
}

/** The lane a job files under: its own name, so no lane lookup ever hands a job's settings to anything else. */
export function jobLane(spec: Pick<JobSpec, "campaign_id">, stamp: number): string {
  return `job_${spec.campaign_id}_${stamp}`;
}

/** Every row routes to the one campaign; no segments, no reroutes, no merge-field holds unless a later decision adds them. */
export function jobSettings(spec: JobSpec, stamp = Date.now()): JobSettings {
  const lane = jobLane(spec, stamp);
  return parseJobSettings({
    id: `${spec.client_tag}.${lane}.v1`,
    client_tag: spec.client_tag,
    lane,
    smartlead_client_id: spec.smartlead_client_id,
    campaign_id: spec.campaign_id,
    source: spec.source,
    routing: [{ when: {}, campaign_id: spec.campaign_id }],
  });
}

/** Campaign settings the post-import check reads from Smartlead. Findings only; the merge-tag check is the gate. */
export const CAMPAIGN_SETTING_CHECKS = ["send_as_plain_text", "tracking_off", "stop_on_reply", "bounce_autopause_off", "schedule_mon_thu"] as const;
