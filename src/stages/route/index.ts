import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import { pendingCampaignCard } from "../../slack/cards.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 9 — Route to campaigns (skill lead-list-build; skill
 * smartlead-campaign-settings for what a new campaign needs). Every routed
 * lead lands on a campaign the recipe names for this client. A lead whose
 * cell matches no rule waits as `pending_campaign` — a new campaign is a
 * recipe change and Josh's — and one card asks him whether the routed rows go
 * on without them. The service never creates or clones a campaign.
 *
 * Gate: every routed campaign belongs to this client (the mirror's
 * smartlead_client_id equals the recipe's). A campaign the mirror does not
 * know is a halt, not a guess.
 */
export interface RouteDeps extends StageDeps {
  ledger?: LaneLedger;
}

/** The recipe's segment dimensions, as computed from a row's columns. */
export type Cell = Record<"band" | "mail_class" | "gift", string | null> & Record<string, string | null>;

/** getleads band label "11 to 50" → recipe segment "11_50"; "10001+" → "10001_plus". */
export function bandSegment(companySize: string | null): string | null {
  if (!companySize) return null;
  const s = companySize.trim().toLowerCase();
  const m = /^(\d+)\s*(?:to|-|–)\s*(\d+)$/.exec(s);
  if (m) return `${m[1]}_${m[2]}`;
  const plus = /^(\d+)\s*\+$/.exec(s);
  if (plus) return `${plus[1]}_plus`;
  return s.replace(/[^a-z0-9]+/g, "_");
}

export function mailClassSegment(mailClass: string | null): string {
  return (mailClass ?? "").toLowerCase() === "seg" ? "SEG" : "OTHER";
}

/** First routing rule whose every `when` matches the cell; null when none does. */
export function matchRule(cell: Cell, routing: Recipe["routing"]): Recipe["routing"][number] | null {
  for (const rule of routing) {
    const ok = Object.entries(rule.when).every(([dim, value]) => cell[dim] === value);
    if (ok) return rule;
  }
  return null;
}

export function cellLabel(cell: Cell, dims: readonly string[]): string {
  return dims.map((d) => `${d}=${cell[d] ?? "?"}`).join(" · ");
}

export class RouteStage {
  constructor(private readonly d: RouteDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "route", "routing", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const dims = Object.keys(recipe.segments);

      // Rows from earlier closed runs of this lane that waited for a campaign get another look.
      const reclaimed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const r = await tx.query(
          `update ${table} t set run_id = $1 from topup.runs r
           where t.run_id = r.run_id and r.client_tag = $2 and r.lane = $3 and not topup.run_is_open(r.status) and t.lead_status = 'pending_campaign'`,
          [run.run_id, run.client_tag, run.lane],
        );
        return r.rowCount ?? 0;
      });

      const { rows } = await db.query<{ id: string; company_size: string | null; mail_class: string | null; gift: string | null }>(
        `select id::text, company_size, mail_class, normalize_flags->'gift_tier'->>0 as gift from ${table}
         where run_id = $1 and lead_status in ('qa_passed', 'pending_campaign')`,
        [run.run_id],
      );
      const byCampaign = new Map<number, string[]>();
      const pending = new Map<string, string[]>();
      for (const r of rows) {
        const cell: Cell = { band: bandSegment(r.company_size), mail_class: mailClassSegment(r.mail_class), gift: r.gift };
        const rule = matchRule(cell, recipe.routing);
        if (rule) {
          const ids = byCampaign.get(rule.campaign_id) ?? [];
          ids.push(r.id);
          byCampaign.set(rule.campaign_id, ids);
        } else {
          const label = cellLabel(cell, dims);
          const ids = pending.get(label) ?? [];
          ids.push(r.id);
          pending.set(label, ids);
        }
      }

      // Gate: every campaign routed to is this client's, in the mirror.
      const campaignIds = [...byCampaign.keys()];
      const wrong = await this.foreignCampaigns(campaignIds, recipe.smartlead_client_id);
      if (wrong.length) {
        return gateUnmet("route", `campaign(s) ${wrong.map((w) => `#${w.id} (${w.reason})`).join(", ")} are not this client's in public.campaigns (smartlead_client_id ${recipe.smartlead_client_id})`, { routed_campaigns: campaignIds.length, foreign: wrong.length });
      }

      const routed = await this.d.repo.withRun(run.run_id, async (tx) => {
        let n = 0;
        for (const [campaign, ids] of byCampaign) {
          const r = await tx.query(
            `update ${table} set lead_status = 'routed', routed_campaign_id = $2, status_changed_at = now()
             where run_id = $1 and id = any($3::uuid[]) and lead_status in ('qa_passed', 'pending_campaign')`,
            [run.run_id, campaign, ids],
          );
          n += r.rowCount ?? 0;
        }
        const pendingIds = [...pending.values()].flat();
        if (pendingIds.length) {
          await tx.query(`update ${table} set lead_status = 'pending_campaign', status_changed_at = now() where run_id = $1 and id = any($2::uuid[]) and lead_status = 'qa_passed'`, [run.run_id, pendingIds]);
        }
        return n;
      });
      const pendingTotal = [...pending.values()].reduce((a, v) => a + v.length, 0);
      // Totals come from the table, so a re-entry after the pending card counts what the first pass routed too.
      const { rows: totals } = await db.query<{ campaign: string | null; n: string }>(`select routed_campaign_id::text as campaign, count(*)::text as n from ${table} where run_id = $1 and lead_status = 'routed' group by 1`, [run.run_id]);
      const routedTotal = totals.reduce((a, t) => a + Number(t.n), 0);
      const perCampaign = Object.fromEntries(totals.filter((t) => t.campaign).map((t) => [`routed_${t.campaign}`, Number(t.n)]));
      const counts: Record<string, number> = { routed: routedTotal, routed_this_pass: routed, pending_campaign: pendingTotal, reclaimed_pending: reclaimed, ...perCampaign };

      if (pendingTotal > 0) {
        const open = await this.d.repo.openCardsForRun(run.run_id);
        const card = open.find((c) => c.kind === "pending_campaign");
        const decided = await this.pendingDecided(run.run_id);
        if (!card && !decided) {
          await this.d.repo.mergeStepCounts(run.run_id, "route", counts);
          await this.d.console.ask({
            run,
            kind: "pending_campaign",
            audience: "owner",
            payload: { step: "route", pending: pendingTotal, cells: Object.fromEntries([...pending.entries()].map(([k, v]) => [k, v.length])) },
            text: `Step 9: ${pendingTotal} leads match no campaign in the recipe`,
            blocks: (cardId) => pendingCampaignCard({ cardId, runId: run.run_id, clientTag: run.client_tag, lane: run.lane, pending: pendingTotal, cells: [...pending.entries()].map(([cell, ids]) => ({ cell, count: ids.length })) }),
          });
          await this.d.ledger?.block(run.client_tag, run.lane, "owner", `${pendingTotal} leads have no campaign in the recipe's routing (new campaign or routing rule is Josh's)`, run.run_id);
          return { kind: "waiting", on: "owner", why: `${pendingTotal} leads match no routing rule` };
        }
        if (card) return { kind: "waiting", on: "owner", why: `${pendingTotal} leads match no routing rule` };
        await this.d.ledger?.unblock(run.client_tag, run.lane, `Josh chose to continue without the ${pendingTotal} pending leads; they wait in the lane.`, run.run_id);
      }

      const line =
        `Route done: ${routedTotal} routed to ${totals.filter((t) => t.campaign).length} campaign(s)` +
        totals.filter((t) => t.campaign).map((t) => ` · #${t.campaign} ${t.n}`).join("") +
        (pendingTotal ? ` · ${pendingTotal} wait as pending_campaign (${[...pending.keys()].slice(0, 4).join("; ")})` : "") +
        (reclaimed ? ` · ${reclaimed} reclaimed from earlier runs` : "") +
        ".";
      return finish(this.d, run, "route", routedTotal, counts, line);
    });
  }

  /** Campaigns the mirror does not know, or knows under another client. */
  private async foreignCampaigns(ids: number[], clientId: number): Promise<Array<{ id: number; reason: string }>> {
    if (ids.length === 0) return [];
    const { rows: t } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass('public.campaigns') is not null as ok`);
    if (!t[0]?.ok) return ids.map((id) => ({ id, reason: "public.campaigns is not here" }));
    const { rows } = await this.d.repo.raw().query<{ id: string; client: string | null }>(`select smartlead_campaign_id::text as id, smartlead_client_id::text as client from public.campaigns where smartlead_campaign_id = any($1::bigint[])`, [ids]);
    const out: Array<{ id: number; reason: string }> = [];
    for (const id of ids) {
      const row = rows.find((r) => Number(r.id) === id);
      if (!row) out.push({ id, reason: "not in the mirror" });
      else if (row.client !== null && Number(row.client) !== clientId) out.push({ id, reason: `belongs to client ${row.client}` });
    }
    return out;
  }

  private async pendingDecided(runId: string): Promise<boolean> {
    const { rows } = await this.d.repo.raw().query<{ n: string }>(`select count(*)::text as n from topup.cards where run_id = $1 and kind = 'pending_campaign' and status = 'resolved' and resolution = 'continue_without'`, [runId]);
    return Number(rows[0]?.n ?? 0) > 0;
  }
}
