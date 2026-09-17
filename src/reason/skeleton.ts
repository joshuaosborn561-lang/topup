import { parseRecipe, type Recipe } from "../recipes/schema.js";
import type { PullReceipt } from "../recipes/receipt.js";

/** Open a run even when infer parks (physical / signal). Executors wait on the D39 card. */
export function skeletonRecipe(input: {
  clientTag: string;
  lane: string;
  smartleadClientId: number;
  receipts: PullReceipt[];
}): Recipe {
  const lane = input.receipts.find((r) => r.granularity === "lane") ?? input.receipts[0];
  if (!lane) throw new Error(`No receipt for ${input.clientTag}/${input.lane}`);
  const campaignIds = [...new Set(input.receipts.flatMap((r) => r.campaign_ids))];
  if (campaignIds.length === 0) throw new Error(`Receipt for ${input.clientTag}/${input.lane} names no campaign ids.`);
  return parseRecipe({
    recipe_id: `${input.clientTag}.${input.lane}.v0`,
    client_tag: input.clientTag,
    lane: input.lane,
    smartlead_client_id: input.smartleadClientId,
    supabase_project: "azpapwtnrbzywlnxxecz",
    owner_approved_at: null,
    source: { kind: "mixed", note: "D39: segment comes from the receipt + reasoner card; this skeleton only names campaigns." },
    suppression: {
      response_based: true,
      client_prior_contacts: true,
      bounced_any_client: true,
      public_suppression: true,
      client_domain_blocklist: true,
      same_offer_any_client: true,
      same_gift_any_client: false,
      exclude_other_live_campaigns: true,
    },
    email_finding: { enabled: false, max_tier: "aiark", fullenrich: false, batch_rows: 200, steps: [], name_to_email: false },
    verify: { seg_split: true, reject_rate_norm: null },
    normalize: { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } },
    qa: ["junk_titles", "retail_school_purge", "nonprofit_to_eos", "company_name_acronym_hold"],
    segments: {},
    routing: campaignIds.map((campaign_id) => ({
      when: {},
      campaign_id,
      icp: { kind: lane.icp_kind, persona: lane.persona },
    })),
    required_fields: ["first_name_n", "company_n", "location", "job_title", "company_size", "vertical"],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
    spend: { auto_cap_usd: 5 },
    owner_approvals: ["inferred_from_receipts"],
  });
}
