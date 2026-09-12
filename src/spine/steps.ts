import type { Step } from "../domain/runs.js";

/**
 * The spine: the thirteen steps of `skills/lead-list-build/SKILL.md`. A lane is
 * always on exactly one step; every card, log line and ledger row names the
 * step by number so it and the skill say the same thing (D24).
 *
 * Titles, owners, gates and skills are copied from the skill's headings and
 * its "Gate:" / "Skill:" lines, word for word (D25). `src/guards/spine.test.ts`
 * parses the skill and fails when this table drifts from it. Change the skill
 * first, then this file; never the other way round.
 */

export type StepOwner = "code" | "josh" | "cayden";

export interface SpineStep {
  n: number;
  /** The step title from the skill heading, without the owner parenthetical. */
  title: string;
  /** Who runs the step (the first name in the heading's parenthetical). */
  owner: StepOwner;
  /** A human whose tap the step also needs on some paths, and when — from the heading or the step body. */
  also: { who: Exclude<StepOwner, "code">; when: string } | null;
  /** The skill's "Gate:" line, verbatim. */
  gate: string;
  /** The skill(s) the skill names as the specification for this step. */
  skill: string | null;
  /** Internal pipeline stages (run_steps.step) that belong to this step. */
  pipeline: readonly Step[];
  /** What the human must see on the card at this step (skill body + Josh's prompt). */
  card: string | null;
}

export const SPINE: readonly SpineStep[] = [
  {
    n: 1,
    title: "Nail the ICP for the lane",
    owner: "josh",
    also: null,
    gate: "every cell has a campaign or Josh knows one must be built. Josh signs off on the segment before anything is pulled.",
    skill: "the client's lead pull skill (parlay-lead-pulls, culture-fits-lead-pulls, techevo-lead-pulls, goliath-lead-pulls, salesglider-lead-pulls) plus the latest client call in Fireflies",
    // The recipe is the signed-off segment; `trigger` checks a recipe exists for the lane before a run opens.
    pipeline: ["trigger"],
    card: "the segment with counts and ten sample rows",
  },
  {
    n: 2,
    title: "Size it",
    owner: "code",
    also: { who: "josh", when: "the pool is thin: widening options with counts, Josh decides" },
    gate: "projected net new is above the useful floor (default 200). If thin, present widening options with counts; Josh decides. Never widen unasked, never declare a pool exhausted.",
    skill: "tam-sizing",
    pipeline: ["size"],
    card: "the segment with counts and ten sample rows",
  },
  {
    n: 3,
    title: "Pull",
    owner: "code",
    also: { who: "josh", when: "paid tiers; company-first lanes: the yield card, then the pilot (~100) result before scaling" },
    gate: "useful output counted, titles audited, spend within the approved ceiling.",
    skill:
      "the client pull skill, leadgen-mcp-routing; company-first: unmask-shell-llc, domain-waterfall, people-waterfall, serp-dm-discovery, hard-to-find-dm-discovery, unresolved-name-routing",
    pipeline: ["pull", "find_emails"],
    card: "expected yield and cost per usable lead, and the pilot result for company-first lanes",
  },
  {
    n: 4,
    title: "Ingest",
    owner: "code",
    also: null,
    gate: "row count equals the export count.",
    skill: null,
    pipeline: ["ingest"],
    card: null,
  },
  {
    n: 5,
    title: "Suppress and dedupe",
    owner: "code",
    also: { who: "cayden", when: "the client's customer domain list is missing" },
    gate: "report raw, removed by reason, net new. Net new is the number from here on.",
    skill: "global-suppression",
    pipeline: ["suppress"],
    card: null,
  },
  {
    n: 6,
    title: "Verify",
    owner: "code",
    also: { who: "josh", when: "the estimate is over the auto cap, or a resubmit after a stall can bill" },
    gate: "sendable count and reject rate reported. A reject rate far above the lane's norm means the source is bad, stop and say so.",
    skill: "supabase-csv-endpoint; Email Verifier Progression",
    pipeline: ["verify"],
    card: null,
  },
  {
    n: 7,
    title: "Normalize",
    owner: "code",
    also: null,
    gate: "every merge field the copy uses is populated or the row is held.",
    skill: "name-city-normalization, company-name-normalization, conversational-location, sports-team-assignment (in that order)",
    pipeline: ["normalize"],
    card: null,
  },
  {
    n: 8,
    title: "QA",
    owner: "code",
    also: { who: "cayden", when: "clears holds" },
    gate: "holds cleared or excluded; counts of purged and held reported.",
    skill: null,
    pipeline: ["qa"],
    card: "the hold: rule, count, ten sample rows",
  },
  {
    n: 9,
    title: "Route to campaign",
    owner: "code",
    also: { who: "josh", when: "copy is needed (a cell with no campaign)" },
    gate: "every lead has a campaign id whose client matches.",
    skill: "smartlead-campaign-settings, salesglider-cold-email-copy, subject-line-offer-naming, spintax-generator, salesglider-unsubscribe",
    pipeline: ["route"],
    card: "the parked cell and a clone offer",
  },
  {
    n: 10,
    title: "Stage",
    owner: "code",
    also: null,
    gate: "staged count equals routed count.",
    skill: null,
    pipeline: ["stage"],
    card: null,
  },
  {
    n: 11,
    title: "Import",
    owner: "code",
    also: null,
    gate: "counts match on every campaign.",
    skill: null,
    pipeline: ["import"],
    card: null,
  },
  {
    n: 12,
    title: "Pre launch check",
    owner: "code",
    also: null,
    gate: 'receipt posted: campaign, imported, runway before and after, spend by vendor, holds, "ready for ACTIVE."',
    skill: "smartlead-campaign-settings (scripts/check_merge_tags.py)",
    pipeline: ["post_import"],
    card: "the receipt",
  },
  {
    n: 13,
    title: "Flip active and watch day one",
    owner: "josh",
    also: null,
    gate: "Josh sets the campaign ACTIVE by hand. Nothing automated ever starts, pauses, or stops a campaign.",
    skill: null,
    pipeline: ["flip"],
    card: null,
  },
];

/** Every internal stage is now placed on a step (D25). Kept so callers that ask "is this unplaced?" still can. */
export const UNPLACED_STAGES: readonly Step[] = [];

const BY_N = new Map(SPINE.map((s) => [s.n, s]));
const BY_STAGE = new Map<Step, SpineStep>();
for (const s of SPINE) for (const p of s.pipeline) BY_STAGE.set(p, s);

export function spineStep(n: number): SpineStep {
  const s = BY_N.get(n);
  if (!s) throw new Error(`no step ${n}; the spine has 13`);
  return s;
}

/** Which spine step an internal pipeline stage belongs to; null only for a stage nobody placed. */
export function stepForStage(stage: Step): SpineStep | null {
  return BY_STAGE.get(stage) ?? null;
}

/** "Step 6 — Verify". Never a made-up name: the title is the skill's heading. */
export function stepLabel(n: number | null): string {
  if (n === null) return "no step (idle)";
  const s = spineStep(n);
  return `Step ${s.n} — ${s.title}`;
}

/** The gate a step must pass, for cards and ledger lines. */
export function gateLabel(n: number): string {
  return spineStep(n).gate;
}

/** The step a lane moves to when this one is done. Null after 13. */
export function nextStep(n: number): number | null {
  return n < 13 ? n + 1 : null;
}
