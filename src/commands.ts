import type { Repo } from "./db/repo.js";
import type { LaneLedger } from "./ledger/lane.js";
import { renderWhere } from "./ledger/render.js";
import type { Orchestrator } from "./orchestrator.js";
import type { CommandHandler } from "./slack/http.js";
import { usd } from "./spend/prices.js";

const SNAKE = /^[a-z][a-z0-9_]*$/;

/**
 * Slash commands (brief section 10). Every reply is ephemeral text, counts
 * and ids only. Roles are enforced before these run (COMMAND_ROLE); a
 * handler never re-checks them and never spends money.
 */
export function buildCommands(d: { repo: Repo; orchestrator: Orchestrator; ledger: LaneLedger }): Record<string, CommandHandler> {
  return {
    "/where": async (ctx) => {
      const [clientTag, lane] = ctx.args;
      if (!clientTag || !SNAKE.test(clientTag) || (lane && !SNAKE.test(lane))) {
        return "Usage: `/where <client_tag> [lane]` — every lane for the client, or one lane in full. Counts only, never rows.";
      }
      const lanes = lane ? [{ client_tag: clientTag, lane }] : await d.ledger.lanes(clientTag);
      if (lanes.length === 0) return `Nothing is registered for ${clientTag}: no recipe, no run, no queue table. Register one from a Claude session with register_queue_table, or add a recipe to the repo.`;
      const parts: string[] = [];
      for (const l of lanes) parts.push(renderWhere(await d.ledger.state(l.client_tag, l.lane, { recount: Boolean(lane) })));
      return parts.join("\n\n");
    },

    "/topup": async (ctx) => {
      const [clientTag, lane] = ctx.args;
      if (!clientTag || !lane) return "Usage: `/topup <client_tag> <lane>` — for example `/topup parlay it_dm`.";
      if (!SNAKE.test(clientTag) || !SNAKE.test(lane)) return "client_tag and lane are snake_case.";
      const res = await d.orchestrator.startTopup({ clientTag, lane, by: ctx.userId, trigger: "manual" });
      if (!res.ok) return res.message;
      return `Run \`${res.run.run_id.slice(0, 8)}\` opened for ${clientTag}/${lane} (manual override). The watch starts this on its own when the client's runway is low and still working; you do not need this command for the normal path. Follow it in <#${res.run.slack_channel}>.`;
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
      if (!found) return `Campaign ${campaignId} is not in topup.campaign_registry yet. The watch writes a row the first time it sees the campaign. /topup also works without an override.`;
      return `Campaign ${campaignId}: working override is now *${mode}*. ${mode === "on" ? "The next watch tick will top up if the campaign is low." : mode === "off" ? "The watch will ask you instead of going." : "The 1-per-2,000-sends rule is back."}`;
    },

    "/suppress": async () =>
      "Step 5 (suppress) runs inside every top-up run against campaignintelligence replies. " +
      "Positive replies from any client expire 90 days after the reply (D37). DNC and wrong person stay forever. " +
      "An empty customer-domain list does not halt the run. Optional domains still apply via MCP `add_client_domains`. " +
      "The Smartlead block list only ever grows.",
  };
}
