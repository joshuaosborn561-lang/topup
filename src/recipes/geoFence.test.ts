import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveTargetCampaignIds } from "./campaigns.js";
import { countSlices, geoFenceRef, groupGeoChunks, loadGeoFenceCities, type GeoCity } from "./geoFence.js";
import { getleadsParamsFromFilters, recipeFromReceipts, type ReceiptStamp } from "./infer.js";
import { routeSize } from "../stages/pull/route.js";

const PROPERTY_FILTERS = {
  cities: "client_emcor.geo_fence (137 cities, 22 counties, run in 3 chunks by geo_chunk; >45 cities times out)",
  states: ["California"],
  industries: ["Real Estate", "Commercial Real Estate", "Leasing Non-residential Real Estate"],
  job_titles: ["Property Manager", "Asset Manager", "Chief Engineer"],
  email_status: ["VALID"],
};

function stamp(over: Partial<ReceiptStamp> = {}): ReceiptStamp {
  return {
    written_by: "claude",
    client_tag: "emcor",
    smartlead_client_id: 55648,
    lane: "c_healthcare",
    campaign_ids: [4036508, 4037545, 4036509, 4037548],
    icp_kind: "linkedin_native",
    persona: "facilities",
    company_source: "getleads",
    company_filters: PROPERTY_FILTERS,
    email_source: "getleads",
    email_max_tier: null,
    how_i_did_it: "getleads on the geo fence, California, titles, VALID. No employee band.",
    notes: null,
    segment: null,
    granularity: "lane",
    rows_imported: 34,
    ...over,
  };
}

function cities(n: number, chunkOf: (i: number) => string | null): GeoCity[] {
  return Array.from({ length: n }, (_, i) => ({ city: `City ${i}`, chunk: chunkOf(i) }));
}

describe("EMCOR geo fence sizing", () => {
  it("copies the recipe filters and does not add a band", () => {
    const params = getleadsParamsFromFilters(PROPERTY_FILTERS);
    assert.ok(params);
    assert.equal(params.company_size, undefined);
    assert.deepEqual(params.email_status, ["VALID"]);
    assert.deepEqual(params.states, ["California"]);
    assert.deepEqual(params.job_titles, ["Property Manager", "Asset Manager", "Chief Engineer"]);
    assert.deepEqual(params.industries, ["Real Estate", "Commercial Real Estate", "Leasing Non-residential Real Estate"]);
    assert.equal(params.cities, undefined);
    assert.deepEqual(params.geo_fence, { schema: "client_emcor", table: "geo_fence" });
    assert.deepEqual(geoFenceRef(PROPERTY_FILTERS.cities), params.geo_fence);
  });

  it("splits 137 cities into 3 or 4 chunks of at most 45", () => {
    const grouped = cities(137, (i) => (i < 45 ? "1" : i < 90 ? "2" : "3"));
    const chunks = groupGeoChunks(grouped);
    assert.ok(chunks.length >= 3 && chunks.length <= 4);
    assert.ok(chunks.every((chunk) => chunk.length <= 45 && chunk.length > 0));
    assert.equal(chunks.reduce((n, chunk) => n + chunk.length, 0), 137);

    const flat = groupGeoChunks(cities(137, () => null));
    assert.equal(flat.length, 4);
    assert.deepEqual(flat.map((chunk) => chunk.length), [45, 45, 45, 2]);
  });

  it("sizes Property near 1612 from the chunk counts, before held contacts", () => {
    const params = getleadsParamsFromFilters(PROPERTY_FILTERS);
    assert.ok(params);
    const slices = countSlices(params, cities(135, (i) => String(Math.floor(i / 45))));
    assert.equal(slices.length, 3);
    assert.ok(slices.every((slice) => (slice.cities?.length ?? 0) <= 45));
    assert.ok(slices.every((slice) => slice.company_size === undefined && slice.email_status?.[0] === "VALID" && !("geo_fence" in slice)));
    const chunkTotals = [500, 560, 552];
    const tam = slices.reduce((sum, _slice, i) => sum + chunkTotals[i]!, 0);
    assert.equal(tam, 1612);
  });

  it("sizes every ACTIVE recipe campaign and drops completed and drafted ones", () => {
    const recipe = recipeFromReceipts({ receipts: [stamp()], smartleadClientId: 55648 });
    assert.equal(recipe.source.kind, "getleads");
    for (const id of [4036508, 4037545]) {
      const route = routeSize(recipe, [id]);
      assert.equal(route.kind, "getleads");
      if (route.kind === "getleads") assert.equal(route.source.params.company_size, undefined);
    }
    const statuses = new Map<number, string | null>([
      [4036508, "ACTIVE"],
      [4037545, "ACTIVE"],
      [4036509, "COMPLETED"],
      [4037548, "DRAFTED"],
    ]);
    assert.deepEqual(
      liveTargetCampaignIds(recipe, [4036508, 4036509, 4037548], statuses),
      [4036508, 4037545],
    );
    const education = recipeFromReceipts({
      receipts: [stamp({ lane: "d_education", campaign_ids: [4037551] })],
      smartleadClientId: 55648,
    });
    assert.deepEqual(liveTargetCampaignIds(education, [4037551], new Map([[4037551, "COMPLETED"]])), []);
    assert.deepEqual(
      liveTargetCampaignIds(education, [4037551], new Map([[4037551, "PAUSED"]])),
      [],
    );
    assert.deepEqual(
      liveTargetCampaignIds(recipe, [4036508], new Map([[4036508, "ARCHIVED"], [4037545, "ACTIVE"], [4036509, "COMPLETED"], [4037548, "DRAFT"]])),
      [4037545],
    );
  });

  it("loads city and chunk columns from the allowlist", async () => {
    const seen: string[] = [];
    const db = {
      async query<R extends Record<string, unknown>>(text: string): Promise<{ rows: R[] }> {
        seen.push(text);
        if (text.includes("information_schema")) {
          return { rows: [{ column_name: "name" }, { column_name: "city" }, { column_name: "geo_chunk" }] as unknown as R[] };
        }
        return { rows: [{ city: "Oakland", chunk: "1" }] as unknown as R[] };
      },
    };
    const rows = await loadGeoFenceCities(db, { schema: "client_emcor", table: "geo_fence" });
    assert.deepEqual(rows, [{ city: "Oakland", chunk: "1" }]);
    assert.match(seen[1]!, /"city"/);
    assert.match(seen[1]!, /"geo_chunk"/);
    assert.match(seen[1]!, /"client_emcor"\."geo_fence"/);
    await assert.rejects(
      () => loadGeoFenceCities(db, { schema: "client_emcor", table: "geo-fence" }),
      /identifier/,
    );
  });
});
