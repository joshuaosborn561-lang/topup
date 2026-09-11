import type { Repo } from "../../db/repo.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import type { SlackConsole } from "../../slack/console.js";
import { mergeFieldColumn, mergeFieldsToHold } from "../../spine/gate.js";
import { attempt, type StageOutcome } from "../common.js";
import { normalizeCompany, type CompanyRefs } from "./company.js";
import { cityKey, type CityCoords } from "./geo.js";
import { conversationalLocation } from "./location.js";
import { normalizeFirstName } from "./names.js";
import { assignTeam } from "./team.js";

export interface NormalizeRefs extends CompanyRefs {
  /** topup.ref_cities in memory. Empty when the table was never seeded: every row is then NO_GEOCODE. */
  coords: CityCoords;
}

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

/**
 * Step 7 for one lead, pure. The four skills run in the spine's order
 * (name-city, company, conversational-location, sports-team); each writes a
 * new field and the raw columns are never touched.
 */
export function normalizeLead(lead: LeadInput, refs: NormalizeRefs, opts: Recipe["normalize"]): NormalizedFields {
  const flags: Record<string, string[]> = {};
  const name = opts.names_cities ? normalizeFirstName(lead.first_name) : { value: lead.first_name, flags: [] };
  if (name.flags.length) flags.first_name = name.flags;
  const company = opts.company ? normalizeCompany(lead.company_name, refs) : { value: lead.company_name, flags: [] };
  if (company.flags.length) flags.company = company.flags;
  const loc = opts.location
    ? conversationalLocation(lead.city, lead.state, refs.coords)
    : { location: lead.city ?? "", metro: null, city: lead.city, geo: null, source: "city" as const, flags: [] as string[] };
  if (loc.flags.length) flags.location = loc.flags;
  let team: string | null = null;
  let gift: "team" | "airpods" = "airpods";
  if (opts.sports_team) {
    const t = assignTeam(loc.city, lead.state, loc.geo, opts.sports_team);
    team = t.team;
    gift = t.gift;
    flags.team = [t.source];
  }
  return { first_name_n: name.value, company_n: company.value, location: loc.location, local_sports_team: team, gift_tier: gift, flags };
}

export async function loadRefs(repo: Repo): Promise<NormalizeRefs> {
  const db = repo.raw();
  const [acr, cities] = await Promise.all([
    db.query<{ acronym: string }>(`select acronym from topup.ref_acronyms`),
    db.query<{ city: string; state: string; lat: number; lon: number }>(`select city, state, lat::float8 as lat, lon::float8 as lon from topup.ref_cities`),
  ]);
  const coords = new Map<string, { lat: number; lon: number }>();
  for (const r of cities.rows) coords.set(cityKey(r.city, r.state), { lat: r.lat, lon: r.lon });
  return { acronyms: new Set(acr.rows.map((r) => r.acronym.toUpperCase())), coords };
}

export type NormalizeOutcome = StageOutcome;

/**
 * Moves `verified` rows of a run to `normalized`, writing the merge fields plus
 * flags; then holds (`qa_hold`) every row with a required merge field empty.
 * Step 7 gate: every merge field the copy uses is populated or the row is held.
 */
export class NormalizeStage {
  constructor(
    private readonly repo: Repo,
    private readonly console: SlackConsole,
  ) {}

  async run(run: RunRow, recipe: Recipe): Promise<NormalizeOutcome> {
    const table = ingestedTable(run.client_tag);
    return attempt({ repo: this.repo, console: this.console }, run, "normalize", "normalizing", async () => {
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
          const fl = Object.entries(o.f.flags).filter(([k]) => k !== "team");
          if (fl.length) flagged++;
          for (const [k, vs] of Object.entries(o.f.flags)) for (const v of vs) flagTotals[`${k}.${v}`] = (flagTotals[`${k}.${v}`] ?? 0) + 1;
        }
      }
      const held = await this.holdEmptyMergeFields(run, table, recipe);
      const heldDetail = Object.entries(held.by_field).filter(([, n]) => n > 0);
      await this.repo.finishStep(run.run_id, "normalize", {
        useful_output: normalized - held.rows,
        counts: { normalized, held_merge_field: held.rows, flagged, ...Object.fromEntries(heldDetail.map(([f, n]) => [`held_${f}`, n])), ...flagTotals },
      });
      await this.repo.mergeRunCounts(run.run_id, { normalized, held: held.rows });
      const geocodeNote = refs.coords.size === 0 ? " · topup.ref_cities is empty, so every location is NO_GEOCODE: run `npm run seed:cities`" : "";
      await this.console.postInThread(
        run,
        `Normalize done: ${normalized} rows · ${held.rows} held for an empty merge field` +
          (heldDetail.length ? ` (${heldDetail.map(([f, n]) => `${f} ${n}`).join(", ")})` : "") +
          ` · ${flagged} carry flags` +
          (Object.keys(flagTotals).length ? ` (${Object.entries(flagTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", ")})` : "") +
          geocodeNote +
          ".",
      );
      return { kind: "done", counts: { normalized, held: held.rows, flagged } };
    });
  }

  /**
   * Step 7 gate, the "or the row is held" half: rows this run normalized whose
   * required merge fields (recipe.required_fields, minus the team) came out
   * empty move to qa_hold with the empty fields in qa_flags. Counts only.
   */
  private async holdEmptyMergeFields(run: RunRow, table: string, recipe: Recipe): Promise<{ rows: number; by_field: Record<string, number> }> {
    const fields = mergeFieldsToHold(recipe.required_fields);
    if (fields.length === 0) return { rows: 0, by_field: {} };
    const col = (f: string) => mergeFieldColumn(f);
    const emptyList = fields.map((f) => `case when coalesce(${col(f)}::text, '') = '' then '${f}' end`).join(", ");
    const anyEmpty = fields.map((f) => `coalesce(${col(f)}::text, '') = ''`).join(" or ");
    // `held` exposes the returned aliases (the merge field names), not the table's column names.
    const perField = fields.map((f) => `count(*) filter (where coalesce("${f}"::text, '') = '')::text as "${f}"`).join(", ");
    return this.repo.withRun(run.run_id, async (tx) => {
      const { rows } = await tx.query<Record<string, string>>(
        `with held as (
           update ${table} set
             lead_status = 'qa_hold', status_changed_at = now(),
             qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('merge_field_empty', array_remove(array[${emptyList}], null))
           where run_id = $1 and lead_status = 'normalized' and (${anyEmpty})
           returning ${fields.map((f) => `${col(f)} as "${f}"`).join(", ")}
         )
         select count(*)::text as rows, ${perField} from held`,
        [run.run_id],
      );
      const r = rows[0] ?? {};
      return { rows: Number(r.rows ?? 0), by_field: Object.fromEntries(fields.map((f) => [f, Number(r[f] ?? 0)])) };
    });
  }
}
