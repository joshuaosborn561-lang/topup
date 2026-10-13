import type { Queryable } from "../db/pool.js";

/**
 * The campaignintelligence tags, as counts and method names (D39, D47, D49).
 * `topup.campaign_method` is one row per campaign: the four source legs,
 * the email tier, and whether a company detail and an evidence note were
 * written. `topup.lead_provenance` is the per-lead stamp of the same tags:
 * it is COUNTED by build label and confidence, never selected. Nothing here
 * reads an email, a name or a phone.
 */
export const SOURCE_LEGS = ["company_source", "domain_source", "person_source", "email_source"] as const;

export interface CampaignMethodTags {
  campaign_id: number;
  lane: string | null;
  company_source: string | null;
  domain_source: string | null;
  person_source: string | null;
  email_source: string | null;
  email_tier: string | null;
  company_detail: boolean;
  evidence: boolean;
}

export interface ProvenanceCount {
  build_label: string | null;
  confidence: string | null;
  leads: number;
}

export async function campaignMethodTags(db: Queryable, campaignIds: readonly number[]): Promise<Map<number, CampaignMethodTags>> {
  const out = new Map<number, CampaignMethodTags>();
  if (campaignIds.length === 0) return out;
  await readMethodRows(db, campaignIds, out);
  const rest = campaignIds.filter((id) => !out.has(id));
  if (rest.length) await readBuildLegs(db, rest, out);
  return out;
}

/** `campaign_method`: one row per campaign, the stamp Josh's skills write. */
async function readMethodRows(db: Queryable, campaignIds: readonly number[], out: Map<number, CampaignMethodTags>): Promise<void> {
  try {
    const { rows } = await db.query<Record<string, unknown>>(
      `select smartlead_campaign_id::text as campaign_id, lane, company_source, domain_source, person_source, email_source, email_tier,
              (company_detail is not null and company_detail <> '') as company_detail,
              (evidence is not null and evidence <> '') as evidence
         from topup.campaign_method
        where smartlead_campaign_id = any($1::bigint[])`,
      [campaignIds],
    );
    for (const row of rows) {
      const id = Number(row.campaign_id);
      if (!Number.isInteger(id)) continue;
      out.set(id, {
        campaign_id: id,
        lane: str(row.lane),
        company_source: str(row.company_source),
        domain_source: str(row.domain_source),
        person_source: str(row.person_source),
        email_source: str(row.email_source),
        email_tier: str(row.email_tier),
        company_detail: Boolean(row.company_detail),
        evidence: Boolean(row.evidence),
      });
    }
  } catch {
    /* the table is not on every database; the build records still answer */
  }
}

/**
 * `campaign_builds` carries the same four legs per build (D47). When a
 * campaign has no `campaign_method` row, its latest build's legs are the
 * tags; the method note stands in for the detail. Evidence is only ever a
 * stamp, so it reads false here.
 */
async function readBuildLegs(db: Queryable, campaignIds: readonly number[], out: Map<number, CampaignMethodTags>): Promise<void> {
  try {
    const { rows } = await db.query<Record<string, unknown>>(
      `select distinct on (smartlead_campaign_id)
              smartlead_campaign_id::text as campaign_id, lane, company_source, domain_source, person_source, email_source,
              email_max_tier as email_tier,
              (method is not null and method <> '') as company_detail
         from topup.campaign_builds
        where smartlead_campaign_id = any($1::bigint[])
        order by smartlead_campaign_id, pulled_at desc nulls last`,
      [campaignIds],
    );
    for (const row of rows) {
      const id = Number(row.campaign_id);
      if (!Number.isInteger(id) || out.has(id)) continue;
      out.set(id, {
        campaign_id: id,
        lane: str(row.lane),
        company_source: str(row.company_source),
        domain_source: str(row.domain_source),
        person_source: str(row.person_source),
        email_source: str(row.email_source),
        email_tier: str(row.email_tier),
        company_detail: Boolean(row.company_detail),
        evidence: false,
      });
    }
  } catch {
    /* no build view here either; the caller reports the campaign_method row as missing */
  }
}

/** Leads stamped per build label and confidence, for this campaign (D74). A count, never a row. */
export async function provenanceCounts(
  db: Queryable,
  clientTag: string,
  buildLabels: readonly string[],
  campaignId?: number,
): Promise<ProvenanceCount[]> {
  const labels = [...new Set(buildLabels.filter((l) => l.length > 0))];
  if (labels.length === 0) return [];
  try {
    const scoped = Number.isInteger(campaignId);
    if (scoped) {
      const { rows: has } = await db.query<{ leads: boolean; campaigns: boolean }>(
        `select to_regclass('public.leads') is not null as leads, to_regclass('public.campaigns') is not null as campaigns`,
      );
      if (!has[0]?.leads || !has[0].campaigns) return [];
    }
    const { rows } = await db.query<{ build_label: string | null; confidence: string | null; leads: string }>(
      scoped
        ? `select p.build_label, p.confidence, count(*)::text as leads
             from topup.lead_provenance p
            where p.client_tag = $1 and p.build_label = any($2::text[])
              and exists (
                select 1
                  from public.leads l
                  join public.campaigns c on c.id = l.campaign_id
                 where lower(l.email) = lower(p.email)
                   and c.smartlead_campaign_id = $3::bigint
              )
            group by 1, 2
            order by 1, 2`
        : `select build_label, confidence, count(*)::text as leads
             from topup.lead_provenance
            where client_tag = $1 and build_label = any($2::text[])
            group by 1, 2
            order by 1, 2`,
      scoped ? [clientTag, labels, campaignId] : [clientTag, labels],
    );
    return rows.map((r) => ({ build_label: r.build_label, confidence: r.confidence, leads: Number(r.leads) }));
  } catch {
    return [];
  }
}

/** Which tags a campaign still lacks. Physical lists also need the detail and evidence notes (D39). */
export function missingTags(tags: CampaignMethodTags | undefined, physical: boolean): string[] {
  if (!tags) return ["campaign_method row or campaign_builds row"];
  const missing: string[] = [];
  for (const leg of SOURCE_LEGS) if (!tags[leg]) missing.push(leg);
  if (physical) {
    if (!tags.company_detail) missing.push("company_detail");
    if (!tags.evidence) missing.push("evidence");
  }
  return missing;
}

function str(v: unknown): string | null {
  return v == null || v === "" ? null : String(v);
}
