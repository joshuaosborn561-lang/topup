import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { recipeFromReceipts, scopeCampaignIds, sourceFromStamp, type ReceiptStamp } from "../recipes/infer.js";
import { parseRecipe } from "../recipes/schema.js";
import { receiptGapReason, routeSize } from "../stages/pull/route.js";
import { SECTION_TEXT_MAX, section } from "../slack/cards.js";

/** D46 — lane rows own campaigns; other clients' ids never enter; the park card names the gap. Ask Josh. */

const root = new URL("../../", import.meta.url);

const PETERSON = 548610;
const C1 = [3798227, 3798228];
const FOREIGN = [3138854, 3241703, 3763797]; // other clients' campaigns that a reconstructed build row listed

function stamp(over: Partial<ReceiptStamp> = {}): ReceiptStamp {
  return {
    written_by: "claude_backfill",
    client_tag: "peterson",
    smartlead_client_id: PETERSON,
    lane: "c1_general_contractors",
    campaign_ids: C1,
    icp_kind: "physical",
    persona: "gc_owner_pm",
    company_source: "maps",
    company_filters: { maps: { categories: ["general contractor"], geo: "DFW grid" } },
    email_source: "email_waterfall",
    email_max_tier: "aiark",
    how_i_did_it: "Maps DFW grid general contractors, permits cross-check, domain waterfall, people waterfall, email waterfall.",
    notes: null,
    segment: null,
    granularity: "lane",
    rows_imported: 824,
    ...over,
  };
}

describe("D46 — receipt campaign scope", () => {
  it("CANON, the ledger and the skill name D46 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const skill = await readFile(new URL("skills/first-pull-receipt/SKILL.md", root), "utf8");
    const backfill = await readFile(new URL("skills/first-pull-receipt/BACKFILL.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D\d+\*\*/);
    assert.match(canon, /A campaign belongs to\s+the lane whose lane row names it/);
    assert.match(canon, /receipt gap/);
    assert.match(ledger, /## D46 — /);
    assert.match(ledger, /^\| D46 \|/m);
    assert.match(skill, /BACKFILL\.md/);
    assert.match(backfill, /`campaign_ids` are only this lane's campaigns/);
    assert.match(backfill, /exact band labels only/);
    assert.match(backfill, /`tam_count` is a fresh/);
  });

  it("the lane row's ids are the routing; a build row's reconstructed ids do not widen it — Ask Josh", () => {
    const lane = stamp();
    const build = stamp({
      written_by: "claude_backfill_build",
      granularity: "build",
      build_label: "stage_20260909:gc_contacts_valid:gc",
      campaign_ids: [...C1, ...FOREIGN, 3798231],
      rows_imported: 1487,
    });
    const recipe = recipeFromReceipts({ receipts: [lane, build], smartleadClientId: PETERSON });
    assert.deepEqual(recipe.routing.map((r) => r.campaign_id).sort(), C1);
  });

  it("other clients' ids and ids claimed by another lane row are dropped before anything routes — Ask Josh", () => {
    const build = stamp({
      written_by: "claude_backfill_build",
      granularity: "build",
      lane: "schools",
      build_label: "dm_contacts:church_gc_school_hosp:SCHOOL",
      campaign_ids: [...C1, 3798231, ...FOREIGN],
    });
    const scoped = scopeCampaignIds({
      stamps: [build],
      lane: "schools",
      smartleadClientId: PETERSON,
      laneRowClaims: new Map([
        [3798227, "c1_general_contractors"],
        [3798228, "c1_general_contractors"],
        [3798231, "c3_churches"],
      ]),
      owners: new Map([
        [3138854, 345263],
        [3241703, 345263],
        [3763797, 542838],
        [3798227, PETERSON],
      ]),
    });
    assert.deepEqual(scoped.own, [], "a build segment that names nothing of its own is not a lane");
    assert.equal(scoped.hasLaneRow, false);
    assert.equal(scoped.dropped.other_client.length, 3);
    assert.deepEqual(
      scoped.dropped.claimed_by_other_lane.map((d) => d.lane).sort(),
      ["c1_general_contractors", "c1_general_contractors", "c3_churches"],
    );

    const own = scopeCampaignIds({
      stamps: [stamp()],
      lane: "c1_general_contractors",
      smartleadClientId: PETERSON,
      laneRowClaims: new Map([[3798227, "c1_general_contractors"]]),
      owners: new Map([[3798227, PETERSON]]),
    });
    assert.deepEqual(own.own, C1);
    assert.equal(own.hasLaneRow, true);
  });

  it("an incomplete getleads receipt parks by receipt id and field name, and fits a Slack section — Ask Josh", () => {
    const src = sourceFromStamp(
      stamp({
        receipt_id: "dc0e83fd-d849-4b6d-9d38-154c3e47332c",
        lane: "c2_property_managers",
        icp_kind: "linkedin_native",
        persona: "property_manager",
        company_source: "getleads",
        company_filters: { geo: "DFW metro cities", permits: { source: "PermitStack" } },
      }),
    );
    assert.equal(src.kind, "mixed");
    if (src.kind !== "mixed") return;
    assert.match(src.note, /^receipt dc0e83fd on peterson\/c2_property_managers, written_by claude_backfill: /);
    assert.match(src.note, /job_titles: absent/);
    assert.match(src.note, /company_size: absent/);
    assert.match(src.note, /BACKFILL\.md/);
    assert.ok(!/\.json/.test(src.note));

    const reason = receiptGapReason(src.note, "size each campaign separately.");
    assert.ok(reason.startsWith("receipt gap — receipt dc0e83fd"));
    const recipe = parseRecipe({
      recipe_id: "peterson.c2_property_managers.v0",
      client_tag: "peterson",
      lane: "c2_property_managers",
      smartlead_client_id: PETERSON,
      supabase_project: "azpapwtnrbzywlnxxecz",
      suppression: { response_based: true, same_offer_any_client: true },
      email_finding: { enabled: false },
      verify: { seg_split: true },
      normalize: {},
      runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
      working: { interested_per_2000_sends: 1, variant_min_sends: 300 },
      spend: { auto_cap_usd: 5 },
      source: src,
      segments: { slot: ["3798230"] },
      routing: [{ when: { slot: "3798230" }, campaign_id: 3798230, icp: { kind: "linkedin_native", persona: "property_manager" } }],
    });
    const sized = routeSize(recipe, [3798230]);
    assert.equal(sized.kind, "park");
    if (sized.kind === "park") assert.doesNotMatch(sized.reason, /^mixed ICP/);

    const text = (section("x".repeat(4000)).text as { text: string }).text;
    assert.ok(text.length <= SECTION_TEXT_MAX && text.length < 3000);
  });
});
