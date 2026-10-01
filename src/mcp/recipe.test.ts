import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Queryable } from "../db/pool.js";
import {
  CAMPAIGN_NOT_FOUND,
  CLIENT_MAP_TAGS_SQL,
  clientTagSchema,
  loadClientTags,
  readCampaignBuilds,
  readProvenanceGaps,
  readTopupRecipe,
  recipeSummariesForWatch,
  summarizeRecipeForSlack,
  TOPUP_CAMPAIGN_BUILDS_SQL,
  TOPUP_PROVENANCE_GAPS_SQL,
  TOPUP_RECIPE_DESCRIPTION,
  TOPUP_RECIPE_SQL,
} from "./recipe.js";

function fakeDb(
  handler: (sql: string, values: unknown[] | undefined) => unknown,
): Queryable {
  return {
    query: async (text, values) => {
      const rows = handler(text, values);
      return { rows: Array.isArray(rows) ? rows : [rows] } as never;
    },
  };
}

const sampleRecipe = {
  campaign: { smartlead_campaign_id: 3847838, name: "parlay it dm" },
  leads: 1274,
  interested: 1,
  leads_without_method: 0,
  any_reconstructed: false,
  builds: [
    {
      build_label: "parlay_adjacent_dms_20260825",
      leads: 1274,
      interested: 1,
      reconstructed: false,
      method: "do not put this paragraph on Slack",
    },
  ],
  client_contacts_last_90d: 12,
};

describe("D40 — live pull recipe SQL", () => {
  it("topup_recipe is one call to topup.recipe and returns jsonb", async () => {
    let seen: { sql: string; values: unknown[] | undefined } | null = null;
    const db = fakeDb((sql, values) => {
      seen = { sql, values };
      return { recipe: sampleRecipe };
    });
    const out = await readTopupRecipe(db, "parlay", 3847838);
    assert.equal(seen?.sql, TOPUP_RECIPE_SQL);
    assert.deepEqual(seen?.values, ["parlay", 3847838]);
    assert.deepEqual(out, sampleRecipe);
  });

  it("returns the campaign-not-found string when campaign is null", async () => {
    const db = fakeDb(() => ({ recipe: { campaign: null, leads: 0 } }));
    assert.equal(await readTopupRecipe(db, "parlay", 1), CAMPAIGN_NOT_FOUND);
    const empty = fakeDb(() => ({ recipe: null }));
    assert.equal(await readTopupRecipe(empty, "parlay", 1), CAMPAIGN_NOT_FOUND);
  });

  it("campaign_builds and provenance_gaps are one select each, rows verbatim", async () => {
    const builds = [{ build_label: "a", leads: 9 }];
    const gaps = [{ smartlead_campaign_id: 1, missing: "method" }];
    const db = fakeDb((sql) => {
      if (sql === TOPUP_CAMPAIGN_BUILDS_SQL) return builds;
      if (sql === TOPUP_PROVENANCE_GAPS_SQL) return gaps;
      throw new Error(`unexpected sql: ${sql}`);
    });
    assert.deepEqual(await readCampaignBuilds(db, "parlay", 3847838), builds);
    assert.deepEqual(await readProvenanceGaps(db, "parlay"), gaps);
  });

  it("Slack summary names builds, interested, any_reconstructed, leads_without_method — not method text", () => {
    const text = summarizeRecipeForSlack(sampleRecipe, 3847838);
    assert.match(text, /parlay_adjacent_dms_20260825/);
    assert.match(text, /1 interested/);
    assert.match(text, /any_reconstructed: no/);
    assert.match(text, /leads_without_method: 0/);
    assert.ok(!text.includes("do not put this paragraph"), "D40: Slack starts from counts, not the method paragraph. Ask Josh.");
  });

  it("watch summary swallows a SQL error so the card still posts", async () => {
    const db = fakeDb(() => {
      throw new Error("connection refused");
    });
    const text = await recipeSummariesForWatch(db, "parlay", [3847838]);
    assert.match(text, /unavailable/);
    assert.match(text, /connection refused/);
    assert.ok(!text.includes("@"), "D40: error text is a message, not a lead row. Ask Josh.");
  });

  it("client_tag enum comes from topup.client_map, not a hardcoded twelve", async () => {
    let seen: string | null = null;
    const db = fakeDb((sql) => {
      seen = sql;
      return [{ client_tag: "parlay" }, { client_tag: "deep_roots" }, { client_tag: "vector_energy" }];
    });
    const tags = await loadClientTags(db);
    assert.equal(seen, CLIENT_MAP_TAGS_SQL);
    assert.deepEqual(tags, ["parlay", "deep_roots", "vector_energy"]);
    const schema = clientTagSchema(tags);
    assert.equal(schema.parse("deep_roots"), "deep_roots");
    assert.equal(schema.parse("vector_energy"), "vector_energy");
    assert.throws(() => schema.parse("not_a_client"));
    const open = clientTagSchema([]);
    assert.equal(open.parse("deep_roots"), "deep_roots", "empty map falls back to snake_case so a new client is not rejected");
    assert.match(TOPUP_RECIPE_DESCRIPTION, /Read before any top up/);
    assert.match(TOPUP_RECIPE_DESCRIPTION, /Counts only, never lead rows/);
  });
});
