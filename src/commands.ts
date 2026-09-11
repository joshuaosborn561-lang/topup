import type { Repo } from "./db/repo.js";
import type { Orchestrator } from "./orchestrator.js";
import type { CommandHandler } from "./slack/http.js";
import { usd } from "./spend/prices.js";

/**
 * Slash commands (brief section 10). Every reply is ephemeral text, counts
 * and ids only. Roles are enforced before these run (COMMAND_ROLE); a
 * handler never re-checks them and never spends money.
 */
export function buildCommands(d: { repo: Repo; orchestrator: Orchestrator }): Record<string, CommandHandler> {
  return {
    "/topup": async (ctx) => {
      const [clientTag, lane] = ctx.args;
      if (!clientTag || !lane) return "Usage: `/topup <client_tag> <lane>` — for example `/topup parlay it_dm`.";
      if (!/^[a-z][a-z0-9_]*$/.test(clientTag) || !/^[a-z][a-z0-9_]*$/.test(lane)) return "client_tag and lane are snake_case.";
      const res = await d.orchestrator.startTopup({ clientTag, lane, by: ctx.userId, trigger: "manual" });
      if (!res.ok) return res.message;
      return `Run \`${res.run.run_id.slice(0, 8)}\` opened for ${clientTag}/${lane}. Follow it in <#${res.run.slack_channel}> — every step posts to its thread; anything over the cap will ask before it spends.`;
    },

    "/holds": async (ctx) => {
      const holds = await d.orchestrator.holds(ctx.args[0]);
      if (holds.length === 0) return "No open holds. Nothing is waiting on a human.";
      return [
        `${holds.length} open hold${holds.length === 1 ? "" : "s"}:`,
        ...holds.map(
          (h) =>
            `• \`${h.card_id.slice(0, 8)}\` ${h.kind} · ${h.client_tag ?? "-"}${h.run_id ? ` run \`${h.run_id.slice(0, 8)}\`` : ""} · ${h.age_minutes}m · needs ${h.audience === "owner" ? "Josh" : "Josh or Cayden"} · ${h.summary}`,
        ),
      ].join("\n");
    },

    "/runs": async (ctx) => {
      const runs = await d.repo.listRuns(10, ctx.args[0]);
      if (runs.length === 0) return "No runs yet.";
      return runs
        .map((r) => {
          const spend = Object.values(r.spend_cents_by_vendor).reduce((a, b) => a + b, 0);
          const counts = Object.entries(r.counts_by_status)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ");
          return `• \`${r.run_id.slice(0, 8)}\` ${r.client_tag}/${r.lane} · *${r.status}*${r.current_step ? ` @ ${r.current_step}` : ""} · ${usd(spend)}${counts ? ` · ${counts}` : ""} · ${r.opened_at.toString().slice(0, 16)}`;
        })
        .join("\n");
    },

    "/working": async (ctx) => {
      const [idRaw, mode] = ctx.args;
      const campaignId = Number(idRaw);
      if (!Number.isInteger(campaignId) || !["on", "off", "auto"].includes(mode ?? "")) {
        return "Usage: `/working <campaign_id> on|off|auto` — `on` forces working, `off` forces not working, `auto` goes back to the 1-per-2,000-sends rule.";
      }
      const value = mode === "auto" ? null : mode === "on";
      const found = await d.repo.setWorkingOverride(campaignId, value);
      if (!found) return `Campaign ${campaignId} is not in topup.campaign_registry. The registry is filled by the runway check, which lands in the next PR.`;
      return `Campaign ${campaignId}: working override is now *${mode}*.`;
    },

    "/suppress": async () =>
      "Suppression uploads are handled by the suppression stage, which is not in this build. " +
      "When it lands, `/suppress <client_tag>` with a CSV attached adds every row to lp.<tag>_suppression. The Smartlead block list only ever grows.",
  };
}
