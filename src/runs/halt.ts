import type { Step } from "../domain/runs.js";

export type StopAfter = "pilot" | "size" | "pull";

/** dry_run is size-only. An explicit stop_after wins. */
export function resolveStopAfter(input: { dryRun?: boolean; stopAfter?: StopAfter | null }): StopAfter | null {
  if (input.stopAfter === "pilot" || input.stopAfter === "size" || input.stopAfter === "pull") return input.stopAfter;
  if (input.dryRun) return "size";
  return null;
}

/**
 * Where a run stops before the next vendor or load step.
 * size-only closes before pull. A counted pull, or the global loads pause,
 * parks before ingest so nothing reaches Smartlead.
 */
export function haltBeforeStep(step: Step, counts: Record<string, number>, loadsPaused: boolean): "sized" | "park_ingest" | null {
  if (step === "pull" && (counts.stop_after_size === 1 || counts.stop_after_pilot === 1)) return "sized";
  // D46: when no campaign qualifies the run closes as sized with the report; nobody is paged for a pull of nothing.
  if (step === "pull" && counts.nothing_to_pull === 1) return "sized";
  if (step === "ingest" && (counts.stop_after_pull === 1 || loadsPaused)) return "park_ingest";
  return null;
}

export function parkIngestReason(counts: Record<string, number>, loadsPaused: boolean): string {
  if (loadsPaused) return "loads are paused; this run stops before ingest so nothing reaches Smartlead";
  if (counts.stop_after_pull === 1) return "stopped after pull so the counted pull can be reviewed before ingest";
  return "stopped before ingest";
}
