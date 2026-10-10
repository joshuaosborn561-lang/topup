import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { firstNonEmptyColSql } from "../canon/mapsPool.js";
import { STEP_RULES } from "../jobs/rules.js";
import { mapsNameJoinSql } from "../stages/normalize/mapsName.js";
import { normalizeLead } from "../stages/normalize/index.js";
import { isRoleInbox } from "../stages/normalize/roleInbox.js";
import { missingEwViewMessage, resolveEwDomainSource, ewDomainViewName } from "../stages/puzzle/ewSource.js";

/**
 * D67 — job 46b1c941 after #44. Ask Josh before any of this changes.
 */

const root = new URL("../../", import.meta.url);
const RUNTIME_DDL =
  /ewDomainViewSql|ewDomainViewDropSql|ensureEwDomainSource|`[^`]*(create|drop|alter)\s+(or\s+replace\s+)?(view|table)|query\(\s*(['"`])[\s\S]*?\b(create|drop)\s+(or\s+replace\s+)?view/i;

describe("D67 — no runtime DDL; Maps company from maps_raw.name", () => {
  it("the service never CREATE / DROP / ALTER a view, and names the other-repo alternative", async () => {
    const src = await readFile(new URL("src/stages/puzzle/ewSource.ts", root), "utf8");
    assert.doesNotMatch(src, RUNTIME_DDL, "D67: ewSource must not emit DDL. Ask Josh.");
    assert.match(src, /resolveEwDomainSource/, "D67: look the view up; do not create it. Ask Josh.");
    assert.match(src, /FIELD_CANDIDATES/, "D67: name the other-repo map. Ask Josh.");
    assert.match(src, /count_source_with_domain/, "D67: name the hardcoded domain count. Ask Josh.");
    assert.match(src, /people_waterfall\/source\.py/, "D67: the alternative lives there. Ask Josh.");
    assert.match(src, /0021/, "D67: the one-time migration is 0021. Ask Josh.");
    const puzzle = await readFile(new URL("src/stages/puzzle/index.ts", root), "utf8");
    const email = await readFile(new URL("src/stages/find_emails/index.ts", root), "utf8");
    assert.doesNotMatch(puzzle, RUNTIME_DDL, "D67: puzzle must not emit DDL. Ask Josh.");
    assert.doesNotMatch(email, RUNTIME_DDL, "D67: find_emails must not emit DDL. Ask Josh.");
    assert.equal(ewDomainViewName("lp.emcor_ingested_leads"), "topup.emcor_ingested_leads_ew");
    assert.match(missingEwViewMessage("lp.emcor_ingested_leads"), /0021/, "D67: a missing view asks Josh to apply 0021.");
  });

  it("0021 creates topup views for existing ingest tables and does not ALTER lp or GRANT on schema lp", async () => {
    const m20 = await readFile(new URL("supabase/migrations/0020_ingested_ew_domain_view.sql", root), "utf8");
    const m21 = await readFile(new URL("supabase/migrations/0021_ingested_ew_domain_views.sql", root), "utf8");
    assert.match(m21, /unapplied/i, "D67: 0021 is unapplied until Josh says so. Ask Josh.");
    assert.match(m21, /create or replace view topup\.%I/, "D67: views live in topup, not lp. Ask Josh.");
    assert.match(m21, /as domain/, "D67: the view exposes domain. Ask Josh.");
    assert.match(m21, /company_domain/, "D67: domain comes from company_domain. Ask Josh.");
    assert.match(m21, /grant select, update on topup\.%I to leadtopup_app/, "D67: grant the view, not the schema. Ask Josh.");
    assert.doesNotMatch(m21, /grant\s+(create|usage)\s+on\s+schema\s+lp/i, "D67: no schema grants on lp. Ask Josh.");
    assert.doesNotMatch(m21, /alter table lp\./i, "D67: do not ALTER a live lane table. Ask Josh.");
    assert.doesNotMatch(m20, /create or replace function topup\.ensure_ingested_ew_view/i, "D67: 0020 must not recreate the DDL function. Ask Josh.");
    assert.match(m20, /drop function if exists topup\.ensure_ingested_ew_view/, "D67: 0020 drops the unused DDL function. Ask Josh.");
  });

  it("resolveEwDomainSource looks up the view and never issues DDL", async () => {
    const seen: string[] = [];
    const repo = {
      raw: () => ({
        query: async (text: string, params?: unknown[]) => {
          seen.push(text);
          if (text.includes("information_schema.columns")) {
            return { rows: [{ column_name: "company_domain" }, { column_name: "email" }] };
          }
          if (text.includes("information_schema.tables")) {
            const name = String(params?.[1] ?? "");
            return { rows: [{ n: name === "emcor_ingested_leads_ew" ? "1" : "0" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      }),
    };
    const source = await resolveEwDomainSource(repo as never, "lp.emcor_ingested_leads");
    assert.equal(source, "topup.emcor_ingested_leads_ew");
    assert.equal(seen.some((q) => RUNTIME_DDL.test(q)), false, "D67: lookup must not run DDL. Ask Josh.");

    const missingRepo = {
      raw: () => ({
        query: async (text: string) => {
          if (text.includes("information_schema.columns")) {
            return { rows: [{ column_name: "company_domain" }] };
          }
          return { rows: [{ n: "0" }] };
        },
      }),
    };
    await assert.rejects(
      () => resolveEwDomainSource(missingRepo as never, "lp.emcor_ingested_leads"),
      /0021/,
      "D67: a missing view fails and names 0021. Ask Josh.",
    );
  });

  it("ingest coalesces company then name then title, and normalize joins maps_raw.name on email", async () => {
    assert.match(
      firstNonEmptyColSql("s", ["company", "name", "title"]),
      /coalesce\(nullif\(s\."company"::text, ''\), nullif\(s\."name"::text, ''\), nullif\(s\."title"::text, ''\)\)/,
      "D67: an empty company column must not hide name. Ask Josh.",
    );
    const join = mapsNameJoinSql("emcor", "t", new Set(["place_id", "name", "email", "company", "title"]));
    assert.ok(join, "D67: maps_raw with name+email must join. Ask Josh.");
    assert.match(join!, /client_emcor/, "D67: join client_<tag>.maps_raw. Ask Josh.");
    assert.match(join!, /lower\(email\)/, "D67: ingest has no place_id; join on email. Ask Josh.");
    assert.match(join!, /maps_name/, "D67: the name column is the business. Ask Josh.");
    assert.equal(mapsNameJoinSql("emcor", "t", new Set(["place_id"])), null);

    const refs = { acronyms: new Set<string>(), coords: new Map() };
    const opts = { names_cities: true, company: true, location: false, sports_team: null };
    const fromMaps = normalizeLead(
      { id: "1", first_name: null, company_name: null, city: "Tahoe", state: "CA", email: "adam@example.test", maps_name: "Obexer's Water Sports" },
      refs,
      opts,
    );
    assert.equal(fromMaps.company_n, "Obexer's Water Sports", "D67: maps_raw.name fills company even when the local is a person. Ask Josh.");
    assert.ok(fromMaps.flags.company?.includes("maps_business_name"));
    assert.equal(fromMaps.first_name_n, null, "D67: first_name_fallback stays off. Ask Josh.");

    const roleTitle = normalizeLead(
      { id: "2", first_name: null, company_name: null, city: "Oakland", state: "CA", email: "info@example.test", title: "Bay Area Electric" },
      refs,
      opts,
    );
    assert.equal(roleTitle.company_n, "Bay Area Electric", "D67: role-inbox title remains the fallback. Ask Josh.");
  });

  it("role-inbox grows by the generic 46b1c941 locals, not brand or person names", () => {
    assert.equal(isRoleInbox("staff@example.test"), true);
    assert.equal(isRoleInbox("customerservice@example.test"), true);
    assert.equal(isRoleInbox("concierge@example.test"), true);
    assert.equal(isRoleInbox("boxoffice@example.test"), true);
    assert.equal(isRoleInbox("events@example.test"), true);
    assert.equal(isRoleInbox("rentals@example.test"), true);
    assert.equal(isRoleInbox("inquire@example.test"), true);
    assert.equal(isRoleInbox("adam@example.test"), false, "D67: person locals stay off the list. Ask Josh.");
    assert.equal(isRoleInbox("bowmanvet@example.test"), false, "D67: brand-as-local stays off the list. Ask Josh.");
    assert.equal(STEP_RULES.normalize, "d69:hold-recompute-size", "D69 superseded the D67 hash so the 147 reopen. Ask Josh.");
  });

  it("CANON and the babysitter name the view, the migration, and the maps_raw join", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D69\*\*/, "D69 is current; D67 stays folded. Ask Josh.");
    assert.match(canon, /topup\.<tag>_ingested_leads_ew/, "D67: the view lives in topup. Ask Josh.");
    assert.match(canon, /never CREATE \/ DROP \/ ALTER at runtime/i, "D67: no runtime DDL. Ask Josh.");
    assert.match(canon, /maps_raw\.name/, "D67: company is maps_raw.name. Ask Josh.");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /topup\.<tag>_ingested_leads_ew/, "D67: babysitter names the topup view. Ask Josh.");
    assert.match(skill, /0021/, "D67: babysitter names the migration. Ask Josh.");
  });
});
