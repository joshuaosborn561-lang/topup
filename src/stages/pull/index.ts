import type { RunRow } from "../../domain/runs.js";
import { recipeAuthorises, type Recipe } from "../../recipes/schema.js";
import { usd } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";
import type { PullAdapter, PullResult } from "./adapter.js";

/**
 * Step 3 — Pull (skill lead-list-build). Drives one PullAdapter: spend gate,
 * start, poll, ledger row, then the gate: useful output counted and spend
 * within the approved ceiling. "Titles audited" needs the rows in the table,
 * so step 4 runs the audit as soon as they land and reports it against this
 * gate. The URL is never opened here; step 4 hands it to LeadPipe.
 */
export interface PullDeps extends StageDeps {
  rails: SpendRails;
  adapters: PullAdapter[];
  cfg: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export class PullStage {
  private readonly clock: Clock;

  constructor(private readonly d: PullDeps) {
    this.clock = d.clock ?? realClock;
  }

  adapterFor(recipe: Recipe): PullAdapter {
    const a = this.d.adapters.find((x) => x.kind === recipe.source.kind);
    if (!a) throw new Error(`no step 3 adapter for a ${recipe.source.kind} source in this build`);
    return a;
  }

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "pull", "pulling", async () => {
      const adapter = this.adapterFor(recipe);
      const sizeStep = await this.d.repo.getStep(run.run_id, "size");
      const planRows = Number(sizeStep?.counts.plan_rows ?? 0) || recipe.runway.max_per_run;

      // Restart safety: a pull already started is polled, never started twice.
      const own = await this.d.repo.getStep(run.run_id, "pull");
      let handle = own?.vendor_job_id ?? null;
      if (!handle) {
        const decision = await this.d.rails.gate({
          runId: run.run_id,
          clientTag: run.client_tag,
          step: "pull",
          vendor: adapter.vendor,
          action: "export",
          rows: planRows,
          recipeAuthorised: recipeAuthorises(recipe, "pull", adapter.vendor),
        });
        if (decision.kind === "blocked") throw new Error(`pull blocked: ${decision.reason}`);
        if (decision.kind === "ask") {
          // No paid pull adapter exists in this build (getleads is included); a paid one lands with its own card (D21 yield card).
          throw new Error(`pull on ${adapter.vendor} would cost ${usd(decision.worstCaseCents)}; this build has no card for a paid pull. Ask Josh.`);
        }
        const started = await adapter.start(run, recipe, planRows);
        handle = started.handle;
        await this.d.repo.setStepVendorJob(run.run_id, "pull", handle);
        await this.d.console.postInThread(run, `Pull: ${adapter.vendor} export started for up to ${planRows} rows (job \`${handle}\`, worst case ${usd(started.worstCaseCents)}).`);
      }

      const result = await poll<PullResult>(() => adapter.check(handle!), { pollMs: this.d.cfg.pollMs, deadMs: this.d.cfg.deadMs, clock: this.clock, what: `${adapter.vendor} export ${handle}` });
      await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "pull", vendor: adapter.vendor, action: "export", rows: result.rows_exported, credits: 0, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: handle, approvedBy: null });

      const counts: Record<string, number> = { plan_rows: planRows, rows_exported: result.rows_exported, capped: result.cap_reason ? 1 : 0 };
      if (result.rows_exported <= 0) {
        await this.d.repo.finishStep(run.run_id, "pull", { useful_output: 0, counts });
        return gateUnmet("pull", `${adapter.vendor} export ${handle} delivered 0 rows${result.cap_reason ? ` (cap_reason ${result.cap_reason}: ${result.cap_message ?? ""})` : ""}. No useful output to count.`, counts);
      }
      const cap = result.cap_reason ? ` · fewer than planned: cap_reason \`${result.cap_reason}\`${result.cap_message ? ` (${result.cap_message})` : ""}` : "";
      return finish(this.d, run, "pull", result.rows_exported, counts, `Pull done: ${result.rows_exported} rows exported by ${adapter.vendor} (planned ${planRows})${cap} · spend $0.00 (included plan) · titles are audited when the rows land (step 4).`);
    });
  }

  /** Step 4 asks for the file again rather than the service remembering a URL across a restart. */
  async resolve(run: RunRow, recipe: Recipe): Promise<PullResult> {
    const own = await this.d.repo.getStep(run.run_id, "pull");
    if (!own?.vendor_job_id) throw new Error("pull has no vendor job id; nothing to ingest");
    const v = await this.adapterFor(recipe).check(own.vendor_job_id);
    if (v.state !== "done") throw new Error(`pull job ${own.vendor_job_id} is ${v.state}${v.state === "failed" ? `: ${v.error}` : ""}; cannot ingest`);
    return v.value;
  }
}
