import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRecipe, type Recipe } from "../recipes/schema.js";
import { keepCampaigns, mergeSiblingRecipes, recipePullKeys, samePull } from "../recipes/campaigns.js";
import { clientWatchDecision, primaryLane, pullGroups, type ScoredCampaign } from "./clientWide.js";

/** D40 — client-wide winners, one pull, then segment. */

function scored(partial: Partial<ScoredCampaign> & Pick<ScoredCampaign, "campaign_id" | "pull_key">): ScoredCampaign {
  return {
    client_tag: "parlay",
    lane: "it_dm_tickets",
    working: true,
    needy: true,
    ...partial,
  };
}

function mini(over: { lane: string; campaign_id: number; industries?: string[]; persona?: string }): Recipe {
  return parseRecipe({
    recipe_id: `parlay.${over.lane}.v0`,
    client_tag: "parlay",
    lane: over.lane,
    smartlead_client_id: 418274,
    supabase_project: "azpapwtnrbzywlnxxecz",
    source: {
      kind: "getleads",
      params: {
        job_titles: ["CIO", "IT Director"],
        company_size: ["11 to 50", "51 to 200"],
        ...(over.industries?.length ? { industries: over.industries } : {}),
      },
    },
    suppression: { response_based: true, same_offer_any_client: true },
    email_finding: { enabled: false },
    verify: { seg_split: true },
    normalize: {},
    segments: { gift: ["tickets", "airpods"] },
    routing: [
      {
        when: { gift: over.lane.includes("airpods") ? "airpods" : "tickets" },
        campaign_id: over.campaign_id,
        icp: { kind: "linkedin_native", persona: over.persona ?? "it_dm" },
      },
    ],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
    spend: { auto_cap_usd: 5 },
    owner_approvals: ["inferred_from_list"],
  });
}

describe("D40 client-wide pull groups", () => {
  it("tickets and airpods are one pull; a dead campaign is not a winner", () => {
    const groups = pullGroups([
      scored({ campaign_id: 1, lane: "it_dm_tickets", pull_key: "parlay|linkedin_native|it_dm|getleads|", needy: true, working: true }),
      scored({ campaign_id: 2, lane: "it_dm_airpods", pull_key: "parlay|linkedin_native|it_dm|getleads|", needy: false, working: true }),
      scored({ campaign_id: 3, lane: "it_dm_tickets", pull_key: "parlay|linkedin_native|it_dm|getleads|", needy: true, working: false }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]!.winnerIds, [1, 2]);
    assert.deepEqual(groups[0]!.needyWinnerIds, [1]);
    assert.deepEqual(groups[0]!.askIds, [3]);
    assert.equal(groups[0]!.primaryLane, "it_dm_tickets");
  });

  it("Goliath education and finserv stay two pulls (industry split)", () => {
    const groups = pullGroups([
      scored({
        client_tag: "goliath",
        lane: "education_it_dm",
        campaign_id: 10,
        pull_key: "goliath|linkedin_native|it_dm|getleads|education",
        working: true,
        needy: true,
      }),
      scored({
        client_tag: "goliath",
        lane: "finserv_it_dm",
        campaign_id: 11,
        pull_key: "goliath|linkedin_native|it_dm|getleads|banking",
        working: false,
        needy: true,
      }),
    ]);
    assert.equal(groups.length, 2);
    const edu = groups.find((g) => g.lanes.includes("education_it_dm"))!;
    const fin = groups.find((g) => g.lanes.includes("finserv_it_dm"))!;
    assert.deepEqual(edu.winnerIds, [10]);
    assert.deepEqual(fin.winnerIds, []);
    assert.deepEqual(fin.askIds, [11]);
  });

  it("goes with every winner so the pull can segment, not only the empty campaign", () => {
    const group = pullGroups([
      scored({ campaign_id: 1, pull_key: "k", needy: true, working: true }),
      scored({ campaign_id: 2, lane: "it_dm_airpods", pull_key: "k", needy: false, working: true }),
    ])[0]!;
    const d = clientWatchDecision({ group, openRun: false });
    assert.equal(d.kind, "go");
    if (d.kind === "go") assert.deepEqual(d.campaigns, [1, 2]);
  });

  it("does not pull a dead industry just because another lane of the client is working", () => {
    const fin = pullGroups([
      scored({
        client_tag: "goliath",
        lane: "finserv_it_dm",
        campaign_id: 11,
        pull_key: "goliath|linkedin_native|it_dm|getleads|banking",
        working: false,
        needy: true,
      }),
    ])[0]!;
    const d = clientWatchDecision({ group: fin, openRun: false, lastStatus: "done" });
    assert.equal(d.kind, "ask");
  });

  it("skips when a run is already open for the pull", () => {
    const group = pullGroups([scored({ campaign_id: 1, pull_key: "k" })])[0]!;
    assert.equal(clientWatchDecision({ group, openRun: true }).kind, "skip");
  });

  it("primaryLane prefers tickets over airpods", () => {
    assert.equal(primaryLane(["it_dm_airpods", "it_dm_tickets"]), "it_dm_tickets");
  });

  it("samePull is true for tickets + airpods and false across industries", () => {
    const tickets = mini({ lane: "it_dm_tickets", campaign_id: 1 });
    const airpods = mini({ lane: "it_dm_airpods", campaign_id: 2 });
    const edu = parseRecipe({
      ...mini({ lane: "education_it_dm", campaign_id: 3, industries: ["Education"] }),
      client_tag: "goliath",
      recipe_id: "goliath.education_it_dm.v0",
    });
    const fin = parseRecipe({
      ...mini({ lane: "finserv_it_dm", campaign_id: 4, industries: ["Banking"] }),
      client_tag: "goliath",
      recipe_id: "goliath.finserv_it_dm.v0",
    });
    assert.equal(samePull(tickets, airpods), true);
    assert.equal(recipePullKeys(tickets)[0], recipePullKeys(airpods)[0]);
    assert.equal(samePull(edu, fin), false);
    const merged = mergeSiblingRecipes(tickets, [airpods]);
    assert.deepEqual(
      merged.routing.map((r) => r.campaign_id).sort(),
      [1, 2],
    );
    const winnersOnly = keepCampaigns(merged, [1]);
    assert.deepEqual(winnersOnly.routing.map((r) => r.campaign_id), [1]);
  });
});
