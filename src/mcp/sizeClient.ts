import type { Repo } from "../db/repo.js";
import { presentRun, runIsOpen, type RunRow } from "../domain/runs.js";
import type { Orchestrator } from "../orchestrator.js";
import { isRetiredParlayLane } from "../recipes/parlay.js";
import type { Recipe } from "../recipes/schema.js";
import { campaignReportFromCounts, type CampaignReportEntry } from "../stages/size/campaignReport.js";

/**
 * Pilot and size in one call per client (D48). One size-only run opens per
 * lane of the client, concurrently; the call waits a bounded time for the
 * runs to close and returns each lane's per-campaign report and briefing.
 * A lane with a run already open is reported, not restarted. Nothing is
 * pulled or loaded. Counts and ids only.
 */
export interface SizeClientDeps {
  repo: Pick<Repo, "getRun" | "getStep" | "openRunFor">;
  orchestrator: Pick<Orchestrator, "startTopup">;
  recipes: readonly Recipe[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface SizeClientInput {
  clientTag: string;
  lanes?: string[];
  campaignIds?: number[];
  pilot?: boolean;
  waitSeconds?: number;
  by: string;
}

export interface LaneSizeResult {
  lane: string;
  run_id: string | null;
  status: string | null;
  started: boolean;
  message: string | null;
  campaigns_ok: number | null;
  campaigns_skipped: number | null;
  plan_rows: number | null;
  vendor_calls: number | null;
  campaign_report: CampaignReportEntry[];
  briefing: string | null;
}

export interface SizeClientResult {
  client_tag: string;
  pilot: boolean;
  waited_seconds: number;
  lanes: LaneSizeResult[];
  still_running: string[];
  briefing: string;
}

export const SIZE_CLIENT_DEFAULT_WAIT_SECONDS = 120;
export const SIZE_CLIENT_MAX_WAIT_SECONDS = 300;

function lanesFor(recipes: readonly Recipe[], input: SizeClientInput): Array<{ lane: string; campaignIds?: number[] }> {
  const mine = recipes.filter((r) => r.client_tag === input.clientTag && !(r.client_tag === "parlay" && isRetiredParlayLane(r.lane)));
  const want = new Set(input.lanes ?? []);
  const byLane = new Map<string, number[]>();
  if (input.campaignIds?.length) {
    for (const id of input.campaignIds) {
      const recipe = mine.find((r) => r.routing.some((rule) => rule.campaign_id === id));
      const lane = recipe?.lane ?? `campaign:${id}`;
      byLane.set(lane, [...(byLane.get(lane) ?? []), id]);
    }
    return [...byLane.entries()].map(([lane, ids]) => (lane.startsWith("campaign:") ? { lane, campaignIds: ids } : { lane, campaignIds: ids }));
  }
  return mine.filter((r) => r.routing.length > 0 && (want.size === 0 || want.has(r.lane))).map((r) => ({ lane: r.lane }));
}

function laneResult(lane: string, run: RunRow | null, started: boolean, message: string | null, step: { counts: Record<string, unknown> } | null): LaneSizeResult {
  const counts = (step?.counts ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof counts[k] === "number" ? (counts[k] as number) : null);
  return {
    lane,
    run_id: run?.run_id ?? null,
    status: run ? presentRun(run).status : null,
    started,
    message,
    campaigns_ok: n("campaigns_ok"),
    campaigns_skipped: n("campaigns_skipped"),
    plan_rows: n("plan_rows"),
    vendor_calls: n("vendor_calls"),
    campaign_report: campaignReportFromCounts(counts),
    briefing: typeof counts.briefing === "string" ? counts.briefing : null,
  };
}

export async function sizeClient(d: SizeClientDeps, input: SizeClientInput): Promise<SizeClientResult> {
  const sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = d.now ?? (() => Date.now());
  const waitSeconds = Math.min(SIZE_CLIENT_MAX_WAIT_SECONDS, Math.max(0, input.waitSeconds ?? SIZE_CLIENT_DEFAULT_WAIT_SECONDS));
  const targets = lanesFor(d.recipes, input);
  const started = await Promise.all(
    targets.map(async (t) => {
      const lane = t.lane.startsWith("campaign:") ? undefined : t.lane;
      const res = await d.orchestrator.startTopup({
        clientTag: input.clientTag,
        lane,
        campaignIds: t.campaignIds,
        by: input.by,
        trigger: "manual",
        stopAfter: input.pilot ? "pilot" : "size",
      });
      if (res.ok) return { lane: res.run.lane, run: res.run as RunRow | null, started: true, message: null as string | null };
      const open = lane ? await d.repo.openRunFor(input.clientTag, lane).catch(() => null) : null;
      return { lane: lane ?? t.lane, run: open, started: false, message: res.message };
    }),
  );

  const begun = now();
  const deadline = begun + waitSeconds * 1000;
  const pending = new Set(started.filter((s) => s.run).map((s) => s.run!.run_id));
  while (pending.size && now() < deadline) {
    await sleep(2000);
    for (const id of [...pending]) {
      const run = await d.repo.getRun(id);
      if (!run) {
        pending.delete(id);
        continue;
      }
      const shown = presentRun(run);
      if (!runIsOpen(shown.status) || shown.status === "awaiting_josh" || shown.status === "awaiting_operator") pending.delete(id);
    }
  }

  const lanes: LaneSizeResult[] = [];
  for (const s of started) {
    const run = s.run ? await d.repo.getRun(s.run.run_id) : null;
    const step = run ? await d.repo.getStep(run.run_id, "size").catch(() => null) : null;
    lanes.push(laneResult(s.lane, run, s.started, s.message, step));
  }
  const briefing = lanes
    .map((l) => l.briefing ?? `${input.clientTag}/${l.lane}: ${l.started ? `run ${l.run_id?.slice(0, 8)} is ${l.status}` : l.message ?? "not started"}`)
    .join("\n\n");
  return {
    client_tag: input.clientTag,
    pilot: Boolean(input.pilot),
    waited_seconds: Math.round((now() - begun) / 1000),
    lanes,
    still_running: [...pending],
    briefing,
  };
}
