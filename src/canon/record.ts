import { campaignPerformance, provenanceCounts, type ProvenanceCount } from "../builds/index.js";
import type { Queryable } from "../db/pool.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import { isColdCall, isNeverTopUp, ratePer2000 } from "../policy/rules.js";
import { registryRows, type RegistryCampaign } from "./registry.js";
import { legacyReplayWarnings } from "../recipes/legacyLeadmagic.js";
import { describeSources, type SourceLine } from "./sources.js";

/**
 * Everything Supabase holds about how a campaign was pulled (D52), as the
 * receipts wrote it: the four source legs, the filters as stored, the build
 * label, the method note, the yield funnel, the segment, the dates. Plus the
 * build rows, the lead stamps counted by label and by leg, the registry row
 * and the lifetime numbers. No verdict. Grok reads where most of the leads
 * came from and repeats that. Never a lead row.
 */
export interface RecordRepo {
  listPullReceipts(input: { clientTag: string; campaignId?: number | null }): Promise<Array<Record<string, unknown>>>;
  campaignBuilds(clientTag: string, campaignIds: number[]): Promise<Record<string, unknown>[]>;
  campaignRegistry(clientTag?: string): Promise<Record<string, unknown>[]>;
}

export interface LegCount {
  company_source: string | null;
  domain_source: string | null;
  person_source: string | null;
  email_source: string | null;
  leads: number;
}

export interface CampaignRecord {
  client_tag: string;
  campaign_id: number;
  never_top_up: boolean;
  registry: RegistryCampaign | null;
  performance: { sends: number; positives: number; rate_per_2000: number; passes_reply_bar: boolean };
  receipts: Array<Record<string, unknown>>;
  builds: Array<Record<string, unknown>>;
  leads_by_label: ProvenanceCount[];
  leads_by_leg: LegCount[];
  sources: { lines: SourceLine[]; unknown: Array<{ leg: string; value: string }> };
  /** D58: how to replay a stored LeadMagic name. The receipts themselves are unchanged. */
  legacy_warnings: string[];
  notes: string[];
  how_to_read: string;
}

export const HOW_TO_READ =
  "receipts are what was written at pull time, newest first; builds are the same facts joined to the campaign; leads_by_label and leads_by_leg count the stamped lead rows of this campaign only (not twins or a shared build). Repeat the legs that fed most of the leads, with the company_filters of the receipt that earned the replies. A missing leg or an empty company_filters is a question for Josh, not a guess. A stored email_max_tier of leadmagic replays as aiark; a stored LeadMagic person source replays as people_waterfall with the live Find Named Person order. The stored row is not rewritten (D58).";

const RECEIPT_KEYS = [
  "written_by", "written_at", "lane", "campaign_ids", "icp_kind", "persona", "granularity", "build_label",
  "company_source", "company_filters", "domain_source", "person_source", "email_source", "email_max_tier",
  "rows_found", "rows_imported", "tam_count", "segment", "yield_by_step", "spend_cents", "suppression_scope", "how_i_did_it", "notes",
] as const;

function pick(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/** Build rows carry counts and labels only; drop anything that is not one of those. */
const BUILD_KEYS = [
  "build_label", "lane", "status", "company_source", "domain_source", "person_source", "email_source", "email_max_tier",
  "company_filters", "method", "leads", "interested", "traced", "rows_found", "rows_imported", "tam_count", "pulled_at", "reconstructed", "receipt_granularity", "suppression_scope",
] as const;

export async function leadsByLeg(db: Queryable, clientTag: string, buildLabels: readonly string[], campaignId?: number): Promise<LegCount[]> {
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
    const { rows } = await db.query<Record<string, unknown>>(
      scoped
        ? `select p.company_source, p.domain_source, p.person_source, p.email_source, count(*)::text as leads
             from topup.lead_provenance p
            where p.client_tag = $1 and p.build_label = any($2::text[])
              and exists (
                select 1
                  from public.leads l
                  join public.campaigns c on c.id = l.campaign_id
                 where lower(l.email) = lower(p.email)
                   and c.smartlead_campaign_id = $3::bigint
              )
            group by 1, 2, 3, 4
            order by count(*) desc`
        : `select company_source, domain_source, person_source, email_source, count(*)::text as leads
             from topup.lead_provenance
            where client_tag = $1 and build_label = any($2::text[])
            group by 1, 2, 3, 4
            order by count(*) desc`,
      scoped ? [clientTag, labels, campaignId] : [clientTag, labels],
    );
    return rows.map((r) => ({
      company_source: (r.company_source as string | null) ?? null,
      domain_source: (r.domain_source as string | null) ?? null,
      person_source: (r.person_source as string | null) ?? null,
      email_source: (r.email_source as string | null) ?? null,
      leads: Number(r.leads),
    }));
  } catch {
    return [];
  }
}

export async function campaignRecord(db: Queryable, repo: RecordRepo, clientTag: string, campaignId: number): Promise<CampaignRecord | { error: string }> {
  const [receiptRows, buildRows, registry, perf, mirrorName] = await Promise.all([
    repo.listPullReceipts({ clientTag, campaignId }).catch(() => [] as Record<string, unknown>[]),
    repo.campaignBuilds(clientTag, [campaignId]).catch(() => [] as Record<string, unknown>[]),
    repo.campaignRegistry(clientTag).catch(() => [] as Record<string, unknown>[]),
    campaignPerformance(db, [campaignId]).catch(() => new Map()),
    campaignNameBySmartleadId(db, campaignId).catch(() => null),
  ]);
  const regRow = registryRows(registry).find((r) => r.campaign_id === campaignId) ?? null;
  const name = mirrorName ?? regRow?.campaign_name ?? null;
  if (isColdCall(name)) return { error: `#${campaignId} ${name} is marked as cold call; the service ignores it (D54). Ask Josh.` };
  const receipts = receiptRows.map((r) => pick(r, RECEIPT_KEYS)).sort((a, b) => String(b.written_at ?? "").localeCompare(String(a.written_at ?? "")));
  const builds = buildRows.map((r) => pick(r, BUILD_KEYS));
  const labels = [...receipts, ...builds].map((r) => r.build_label).filter((l): l is string => typeof l === "string" && l.length > 0);
  const [byLabel, byLeg] = await Promise.all([
    provenanceCounts(db, clientTag, labels, campaignId),
    leadsByLeg(db, clientTag, labels, campaignId),
  ]);
  const p = perf.get(campaignId) ?? { sends: 0, positives: 0 };
  const rate = Math.round(ratePer2000(p.sends, p.positives) * 100) / 100;
  const legs = (k: string) => [...receipts, ...builds, ...byLeg].map((r) => (r as Record<string, unknown>)[k] as string | null | undefined);
  const notes = [...new Set(receipts.flatMap((r) => [r.how_i_did_it, r.notes]).filter((n): n is string => typeof n === "string" && n.trim().length > 0))];
  return {
    client_tag: clientTag,
    campaign_id: campaignId,
    never_top_up: isNeverTopUp(campaignId, name),
    registry: regRow,
    performance: { sends: p.sends, positives: p.positives, rate_per_2000: rate, passes_reply_bar: p.positives >= 1 && rate >= 1 },
    receipts,
    builds,
    leads_by_label: byLabel,
    leads_by_leg: byLeg,
    sources: describeSources({ company: legs("company_source"), domain: legs("domain_source"), person: legs("person_source"), email: legs("email_source") }),
    legacy_warnings: legacyReplayWarnings([...receipts, ...builds]),
    notes,
    how_to_read: HOW_TO_READ,
  };
}
