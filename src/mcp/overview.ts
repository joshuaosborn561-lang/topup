import { campaignMethodTags, chooseBuildForCampaign, loadBuildRecords, missingTags, type BuildSource, type CampaignMethodTags } from "../builds/index.js";
import type { Queryable } from "../db/pool.js";
import { presentRun, type RunRow } from "../domain/runs.js";
import { assessClientRunway } from "../ledger/client_runway.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots, DEFAULT_FLOOR_DAYS, type CampaignHealth } from "../ledger/health.js";
import type { CampaignGate } from "../policy/index.js";
import { registryRows } from "../recipes/registry.js";
import { judgeCampaigns, type WatchRepo } from "../watch/assess.js";
import { watchdogLeadFlag, type WatchdogLeadFlag } from "../watch/decide.js";
import { loadClientMap } from "./recipe.js";

/**
 * One client in one read, for the babysitter (D39, D49). Every campaign of
 * the client with its health, its policy gate and reason, the build the
 * service would repeat, and which campaignintelligence tags it carries.
 * Counts, ids, labels and short reasons only. The bot reads this once,
 * then `campaign_history` only for the campaigns it will top up. Never a
 * lead row, never a file URL.
 */
export const CLIENT_OVERVIEW_DESCRIPTION =
  "Read this first for a client. Every campaign of one client in one call: status, lane, lead flag (empty, low, nearly-done), runway days, untouched leads, the policy gate and reason (reply bar, net new, excluded, paused, dropped, retired, foreign client), the build record the service would repeat and whether it can, and which campaignintelligence tags it carries (company, domain, person and email source legs; detail and evidence on physical lists). Plus open runs, client-wide runway and the loads switch. Counts and short reasons only; never a lead row. Then read campaign_history only for the campaigns you will top up, then size_client.";

export const OVERVIEW_REASON_MAX = 160;

export interface OverviewRepo extends WatchRepo, BuildSource {
  campaignRegistry(clientTag?: string): Promise<Record<string, unknown>[]>;
  openRuns(): Promise<RunRow[]>;
  loadsPaused(): Promise<boolean>;
  clientIcpKind(clientTag: string): Promise<string>;
}

export interface OverviewCampaign {
  campaign_id: number;
  name: string | null;
  status: string | null;
  lane: string | null;
  flag: WatchdogLeadFlag | null;
  runway_days: number | null;
  untouched: number;
  sends_last_14d: number;
  gate: CampaignGate;
  gate_reason: string;
  qualifies: boolean;
  reply_rate_per_2000: number | null;
  builds: number;
  chosen_build: { label: string | null; vendor: string; interested: number | null; repeatable: boolean; why: string } | null;
  tags: Omit<CampaignMethodTags, "campaign_id"> | null;
  missing_tags: string[];
}

export interface ClientOverview {
  client_tag: string;
  smartlead_client_id: number;
  icp_kind: string;
  loads_paused: boolean;
  runway: { email_days: number | null; email_rem: number; active_campaigns: number; under_floor: boolean };
  open_runs: Array<{ run_id: string; lane: string; status: string; step: string | null }>;
  counts: { campaigns: number; needing_leads: number; qualifying: number; without_build_record: number; missing_tags: number };
  campaigns: OverviewCampaign[];
  next: string;
}

export async function clientOverview(
  db: Queryable,
  repo: OverviewRepo,
  clientTag: string,
  opts: { include_inactive?: boolean } = {},
): Promise<ClientOverview | { error: string }> {
  const mapped = await loadClientMap(db).catch(() => []);
  const client = mapped.find((c) => c.client_tag === clientTag);
  if (!client) return { error: `${clientTag} is not in topup.client_map. Adding a client is a row in that table (D42). Ask Josh.` };

  const ids = await campaignIdsForClient(db, client.smartlead_client_id, !opts.include_inactive);
  const [snaps, registry, builds, methods, open, loadsPaused, icpKind] = await Promise.all([
    ids.length ? campaignSnapshots(db, ids) : Promise.resolve([]),
    repo.campaignRegistry(clientTag).catch(() => [] as Record<string, unknown>[]),
    ids.length ? loadBuildRecords(repo, clientTag, ids).catch(() => []) : Promise.resolve([]),
    campaignMethodTags(db, ids),
    repo.openRuns().catch(() => [] as RunRow[]),
    repo.loadsPaused().catch(() => true),
    repo.clientIcpKind(clientTag).catch(() => "linkedin_native"),
  ]);
  const health: CampaignHealth[] = snaps.map((s) => assessCampaign(s, DEFAULT_FLOOR_DAYS));
  const lanes = new Map(registryRows(registry).map((r) => [r.campaign_id, r.lane] as const));
  const judged = await judgeCampaigns(db, repo, { client_tag: clientTag, lane: "", smartlead_client_id: client.smartlead_client_id }, health);
  const verdicts = new Map(judged.map((j) => [j.verdict.campaign_id, j.verdict] as const));
  const runway = assessClientRunway({ clientTag, campaigns: health, uniqueInboxes: null, messagePerDay: null, floorDays: DEFAULT_FLOOR_DAYS });
  const physical = icpKind === "physical";

  const campaigns: OverviewCampaign[] = health.map((h) => {
    const id = h.smartlead_campaign_id;
    const verdict = verdicts.get(id);
    const chosen = chooseBuildForCampaign(id, builds);
    const tags = methods.get(id);
    return {
      campaign_id: id,
      name: h.name,
      status: h.status,
      lane: lanes.get(id) ?? null,
      flag: watchdogLeadFlag(h),
      runway_days: h.runway_days,
      untouched: h.untouched,
      sends_last_14d: h.sends_last_14d,
      gate: verdict?.gate ?? "not_active",
      gate_reason: short(verdict?.reason ?? `#${id} is ${h.status ?? "not ACTIVE"}; only ACTIVE campaigns are topped up`),
      qualifies: verdict?.qualifies ?? false,
      reply_rate_per_2000: verdict?.reply_rate_per_2000 ?? null,
      builds: chosen.candidates.length,
      chosen_build: chosen.build
        ? { label: chosen.build.build_label, vendor: chosen.build.vendor, interested: chosen.build.interested, repeatable: chosen.build.repeatable.ok, why: short(chosen.reason) }
        : null,
      tags: tags ? stripId(tags) : null,
      missing_tags: missingTags(tags, physical),
    };
  });
  campaigns.sort((a, b) => rank(a) - rank(b) || a.campaign_id - b.campaign_id);

  const counts = {
    campaigns: campaigns.length,
    needing_leads: campaigns.filter((c) => c.flag !== null).length,
    qualifying: campaigns.filter((c) => c.flag !== null && c.qualifies).length,
    without_build_record: campaigns.filter((c) => c.chosen_build === null).length,
    missing_tags: campaigns.filter((c) => c.missing_tags.length > 0).length,
  };
  const mine = open.filter((r) => r.client_tag === clientTag).map((r) => ({ run_id: r.run_id, lane: r.lane, status: presentRun(r).status, step: r.current_step }));
  return {
    client_tag: clientTag,
    smartlead_client_id: client.smartlead_client_id,
    icp_kind: icpKind,
    loads_paused: loadsPaused,
    runway: { email_days: runway.email_days, email_rem: runway.email_rem, active_campaigns: runway.active_campaigns, under_floor: runway.under_floor },
    open_runs: mine,
    counts,
    campaigns,
    next: nextLine(clientTag, counts, mine.length, loadsPaused),
  };
}

function rank(c: OverviewCampaign): number {
  if (c.flag === "empty") return 0;
  if (c.flag === "nearly_done") return 1;
  if (c.flag === "low") return 2;
  return 3;
}

function short(s: string): string {
  return s.length > OVERVIEW_REASON_MAX ? `${s.slice(0, OVERVIEW_REASON_MAX - 1)}…` : s;
}

function stripId(t: CampaignMethodTags): Omit<CampaignMethodTags, "campaign_id"> {
  const { campaign_id: _id, ...rest } = t;
  return rest;
}

/** One line the bot can act on. It names the next tool, never a row. */
export function nextLine(clientTag: string, counts: ClientOverview["counts"], openRuns: number, loadsPaused: boolean): string {
  if (counts.campaigns === 0) return `${clientTag} has no ACTIVE campaign in the mirror. Nothing to start.`;
  if (counts.needing_leads === 0) return `No ${clientTag} campaign is empty, low or nearly done. Nothing to start.`;
  if (counts.qualifying === 0) return `${counts.needing_leads} ${clientTag} campaign(s) need leads and none passes the policy; the gate_reason on each says why. Nothing starts. Josh's /working on is the override.`;
  const open = openRuns ? ` ${openRuns} run(s) already open: read run_status before starting another on the same lane.` : "";
  const loads = loadsPaused ? " Loads are paused: a run sizes and pulls, then parks before ingest." : "";
  return `${counts.qualifying} of ${counts.needing_leads} needy ${clientTag} campaign(s) pass the policy. Read campaign_history for each one you will top up, then size_client("${clientTag}") and approval_briefing.${open}${loads}`;
}
