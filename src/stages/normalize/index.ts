import type { Repo } from "../../db/repo.js";
import { ingestedTable } from "../../db/pool.js";
import { MAX_STEP_ATTEMPTS, type RunRow } from "../../domain/runs.js";
import { logger } from "../../lib/log.js";
import type { Recipe } from "../../recipes/schema.js";
import type { SlackConsole } from "../../slack/console.js";
import { normalizeCompany, type CompanyRefs } from "./company.js";
import { conversationalLocation, metroKey, type MetroRefs } from "./location.js";
import { normalizeFirstName } from "./names.js";
import { assignTeam, type TeamRefs } from "./team.js";

const log = logger("normalize");

export interface NormalizeRefs extends CompanyRefs, MetroRefs, TeamRefs {}

export interface LeadInput {
  id: string;
  first_name: string | null;
  company_name: string | null;
  city: string | null;
  state: string | null;
}

export interface NormalizedFields {
  first_name_n: string | null;
  company_n: string | null;
  location: string;
  local_sports_team: string | null;
  gift_tier: "team" | "airpods";
  flags: Record<string, string[]>;
}

/** Pure: one lead in, normalized merge fields out. Never touches the raw columns. */
export function normalizeLead(lead: LeadInput, refs: NormalizeRefs, opts: Recipe["normalize"]): NormalizedFields {
  const flags: Record<string, string[]> = {};
  const name = opts.names_cities ? normalizeFirstName(lead.first_name) : { value: lead.first_name, flags: [] };
  if (name.flags.length) flags.first_name = name.flags;
  const company = opts.company ? normalizeCompany(lead.company_name, refs) : { value: lead.company_name, flags: [] };
  if (company.flags.length) flags.company = company.flags;
  const loc = opts.location ? conversationalLocation(lead.city, lead.state, refs) : { location: lead.city ?? "", metro: null, flags: [] as string[] };
  if (loc.flags.length) flags.location = loc.flags;
  let team: string | null = null;
  let gift: "team" | "airpods" = "airpods";
  if (opts.sports_team) {
    const t = assignTeam(loc.metro ?? (loc.location || null), refs, opts.sports_team);
    team = t.team;
    gift = t.gift;
    if (t.flags.length) flags.team = t.flags;
  }
  return { first_name_n: name.value, company_n: company.value, location: loc.location, local_sports_team: team, gift_tier: gift, flags };
}

export async function loadRefs(repo: Repo): Promise<NormalizeRefs> {
  const db = repo.raw();
  const [acr, suf, met, teams, amb] = await Promise.all([
    db.query<{ acronym: string }>(`select acronym from topup.ref_acronyms`),
    db.query<{ suffix: string }>(`select suffix from topup.ref_company_suffixes where strip`),
    db.query<{ city: string; state: string; conversational: string }>(`select city, state, conversational from topup.ref_metro_names`),
    db.query<{ team: string; league: string; metro: string; pro: boolean }>(`select team, league, metro, pro from topup.ref_sports_teams`),
    db.query<{ nickname: string }>(`select nickname from topup.ref_ambiguous_nicknames`),
  ]);
  return {
    acronyms: new Set(acr.rows.map((r) => r.acronym.toUpperCase())),
    suffixes: new Set(suf.rows.map((r) => r.suffix.toLowerCase().replace(/[.,]/g, ""))),
    metros: new Map(met.rows.map((r) => [metroKey(r.city, r.state), r.conversational])),
    teams: teams.rows,
    ambiguous: new Set(amb.rows.map((r) => r.nickname.toLowerCase())),
  };
}

export type NormalizeOutcome = { kind: "done"; normalized: number; flagged: number } | { kind: "retry"; error: string } | { kind: "parked"; reason: string };

/** Moves `verified` rows of a run to `normalized`, writing the four merge fields plus flags. */
export class NormalizeStage {
  constructor(
    private readonly repo: Repo,
    private readonly console: SlackConsole,
  ) {}

  async run(run: RunRow, recipe: Recipe): Promise<NormalizeOutcome> {
    const table = ingestedTable(run.client_tag);
    const step = await this.repo.beginStep(run.run_id, "normalize");
    if (!step.ok) {
      await this.repo.setRunStatus(run.run_id, "awaiting_operator", "normalize", "normalize exhausted its attempts");
      return { kind: "parked", reason: "normalize exhausted its attempts" };
    }
    await this.repo.setRunStatus(run.run_id, "normalizing", "normalize");
    try {
      const refs = await loadRefs(this.repo);
      let normalized = 0;
      let flagged = 0;
      const flagTotals: Record<string, number> = {};
      for (;;) {
        const { rows } = await this.repo.raw().query<LeadInput>(
          `select id::text, first_name, company_name, city, state from ${table}
           where run_id = $1 and lead_status = 'verified' order by id limit 1000`,
          [run.run_id],
        );
        if (rows.length === 0) break;
        const out = rows.map((r) => ({ id: r.id, f: normalizeLead(r, refs, recipe.normalize) }));
        await this.repo.withRun(run.run_id, (tx) =>
          tx.query(
            `update ${table} t set
               first_name_n = v.first_name_n, company_n = v.company_n, location = v.location,
               local_sports_team = v.local_sports_team, normalize_flags = v.flags::jsonb,
               normalized_at = now(), lead_status = 'normalized', status_changed_at = now()
             from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
               as v(id, first_name_n, company_n, location, local_sports_team, flags)
             where t.id = v.id and t.run_id = $1 and t.lead_status = 'verified'`,
            [
              run.run_id,
              out.map((o) => o.id),
              out.map((o) => o.f.first_name_n),
              out.map((o) => o.f.company_n),
              out.map((o) => o.f.location),
              out.map((o) => o.f.local_sports_team),
              out.map((o) => JSON.stringify({ ...o.f.flags, gift_tier: [o.f.gift_tier] })),
            ],
          ),
        );
        normalized += out.length;
        for (const o of out) {
          const fl = Object.entries(o.f.flags);
          if (fl.length) flagged++;
          for (const [k, vs] of fl) for (const v of vs) flagTotals[`${k}.${v}`] = (flagTotals[`${k}.${v}`] ?? 0) + 1;
        }
      }
      await this.repo.finishStep(run.run_id, "normalize", { useful_output: normalized, counts: { normalized, flagged, ...flagTotals } });
      await this.repo.mergeRunCounts(run.run_id, { normalized });
      await this.console.postInThread(
        run,
        `Normalize done: ${normalized} rows · ${flagged} carry flags` +
          (Object.keys(flagTotals).length ? ` (${Object.entries(flagTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", ")})` : "") +
          ".",
      );
      return { kind: "done", normalized, flagged };
    } catch (err) {
      const message = (err as Error).message;
      const parked = step.attempts >= MAX_STEP_ATTEMPTS;
      await this.repo.failStep(run.run_id, "normalize", message, parked);
      log.error("normalize failed", { run_id: run.run_id, attempt: step.attempts, error: message });
      if (parked) {
        await this.repo.setRunStatus(run.run_id, "awaiting_operator", "normalize", message);
        return { kind: "parked", reason: message };
      }
      return { kind: "retry", error: message };
    }
  }
}
