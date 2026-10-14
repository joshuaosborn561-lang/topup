import { z } from "zod";
import type { GrokSplit } from "../canon/laneSplit.js";

/**
 * The settings of one top-up job (D99). Nothing here is a recipe: the
 * method lives in the campaign's build transcript and Grokbot replays it
 * with its own connectors; how a lane splits is read by Grokbot from the
 * chats and passed with the pool (D108). These are only what the referee
 * stages need to run on the pool it hands over: where the pool is, which
 * client, which campaigns, the split as passed, and the fixed defaults of
 * the shared tail (dedupe, unsubscribes, the ICP website check,
 * verification, merge fields, staging, import).
 * Client-agnostic; no per-client branch anywhere.
 */
const ident = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");

export const poolSource = z.discriminatedUnion("kind", [
  /** A CSV the bot exported with its own connector (GetLeads export, a LeadPipe export, any signed URL). LeadPipe ingests it. */
  z.object({ kind: z.literal("file_url"), urls: z.array(z.string().url()).min(1) }),
  /** A table or view on campaignintelligence the bot built in SQL. The service copies the standard columns into the lane table. */
  z.object({ kind: z.literal("table"), table: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "schema.table"), where: z.string().min(1).default("true") }),
]);

/** D108: the split Grokbot read from the lane's chats, passed on topup with the pool. Checked against the lane before a job opens. */
export const laneSplitInput = z.object({
  rule: z.string().min(1).max(2000).describe("One short plain-English paragraph: how the chats split this lane's leads across its campaigns."),
  routing: z
    .array(z.object({ when: z.record(z.string()), campaign_id: z.number().int().positive() }))
    .min(1)
    .describe("Ordered rules; the first whose every `when` matches the row wins. `when` names built-in dimensions (band, mail_class, team_source) or ones defined in dimensions."),
  dimensions: z
    .array(z.record(z.unknown()))
    .default([])
    .describe("Derived dimensions the routing reads, each one lane column through one of four kinds: match, set, present, hash_parity (D106)."),
  from: z.array(z.string().min(1).max(200)).max(40).default([]).describe("Where it was read: transcript step numbers, chat or playbook entries."),
});

export const jobSettingsSchema = z
  .object({
    id: z.string().min(1),
    client_tag: ident,
    lane: ident,
    smartlead_client_id: z.number().int().positive(),
    campaign_id: z.number().int().positive(),
    campaign_ids: z.array(z.number().int().positive()).default([]),
    scope: z.enum(["lane", "campaign"]).default("campaign"),
    pointed_from_campaign_id: z.number().int().positive().nullable().default(null),
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
    segments: z.record(z.array(z.string())).default({}),
    routing: z.array(z.object({ when: z.record(z.string()), campaign_id: z.number().int().positive() })).default([]),
    /** D106: derived routing dimensions (parsed strictly by canon/dimensions before they get here). */
    dimensions: z.array(z.record(z.unknown())).default([]),
    /** D108: the split as Grokbot read it from the chats, in plain English, and where it read it. For the quote and the record. */
    split_rule: z.string().max(2000).nullable().default(null),
    split_from: z.array(z.string()).default([]),
    required_fields: z.array(z.string()).default([]),
  })
  // Unknown keys (a field an older version stored) are dropped, so a job a deploy cut off still resumes.
  .strip();

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
  campaign_id?: number;
  lane?: string;
  source: PoolSource;
  /** D108: how the chats split the lane, as Grokbot read it. */
  split?: GrokSplit | null;
}

export interface LaneJobSplit {
  lane: string;
  campaign_ids: number[];
  routing: JobSettings["routing"];
  segments: JobSettings["segments"];
  dimensions: JobSettings["dimensions"];
  split_rule?: string | null;
  split_from?: string[];
  pointed_from_campaign_id: number | null;
}

/** The lane a job files under: its own name, so no lane lookup ever hands a job's settings to anything else. */
export function jobLane(spec: Pick<JobSpec, "campaign_id">, stamp: number): string {
  return `job_${spec.campaign_id}_${stamp}`;
}

/** Every row routes to the one campaign unless the lane splits (D105, D108). */
export function jobSettings(spec: JobSpec, stamp = Date.now(), split?: LaneJobSplit | null): JobSettings {
  if (split && split.campaign_ids.length > 0) {
    const campaign_id = spec.campaign_id && split.campaign_ids.includes(spec.campaign_id) ? spec.campaign_id : split.campaign_ids[0]!;
    return parseJobSettings({
      id: `${spec.client_tag}.${split.lane}.${stamp}`,
      client_tag: spec.client_tag,
      lane: split.lane,
      smartlead_client_id: spec.smartlead_client_id,
      campaign_id,
      campaign_ids: split.campaign_ids,
      scope: "lane",
      pointed_from_campaign_id: split.pointed_from_campaign_id,
      source: spec.source,
      routing: split.routing,
      segments: split.segments,
      dimensions: split.dimensions,
      split_rule: split.split_rule ?? null,
      split_from: split.split_from ?? [],
    });
  }
  if (spec.campaign_id == null) throw new Error("topup needs a campaign_id or a lane.");
  const lane = jobLane(spec, stamp);
  return parseJobSettings({
    id: `${spec.client_tag}.${lane}.v1`,
    client_tag: spec.client_tag,
    lane,
    smartlead_client_id: spec.smartlead_client_id,
    campaign_id: spec.campaign_id,
    campaign_ids: [spec.campaign_id],
    scope: "campaign",
    pointed_from_campaign_id: null,
    source: spec.source,
    routing: [{ when: {}, campaign_id: spec.campaign_id }],
  });
}

/** Campaign settings the post-import check reads from Smartlead. Findings only; the merge-tag check is the gate. */
export const CAMPAIGN_SETTING_CHECKS = ["send_as_plain_text", "tracking_off", "stop_on_reply", "bounce_autopause_off", "schedule_mon_thu"] as const;
