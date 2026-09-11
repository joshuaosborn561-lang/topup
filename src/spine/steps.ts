import type { Step } from "../domain/runs.js";

/**
 * The spine: the thirteen steps of `skills/lead-list-build/SKILL.md`. A lane is
 * always on exactly one step; every card, log line and ledger row names the
 * step by number so it and the skill say the same thing (D24).
 *
 * The skill file is not in this repository yet (see the PR). Everything here
 * comes from Josh's "build to the spine" prompt, which names owners and gates
 * for some steps and not others. What the prompt did not say is `null`, never
 * guessed: a null title or gate renders as "Step N" and is a question for
 * Josh, not a default. When the skill lands, `src/guards/spine.test.ts`
 * compares this table to its headings.
 */

export type StepOwner = "code" | "josh" | "cayden";

export interface SpineStep {
  n: number;
  /** The step title from the skill. Null until the skill is in the repo. */
  title: string | null;
  /** Who runs the step. Code never waits for a human on its own step unless a gate fails. */
  owner: StepOwner | null;
  /** A human whose tap the step also needs on some paths, and when. */
  also: { who: Exclude<StepOwner, "code">; when: string } | null;
  /** The test that must pass before the next step starts. Verbatim from the prompt where it gave one. */
  gate: string | null;
  /** The skill that is the specification for this step. */
  skill: string | null;
  /** Internal pipeline stages (run_steps.step) that belong to this step. */
  pipeline: readonly Step[];
  /** What Josh must see on the card, when the prompt said. */
  card: string | null;
}

export const SPINE: readonly SpineStep[] = [
  {
    n: 1,
    title: null,
    owner: "josh",
    also: null,
    gate: "sign off on the segment before any pull",
    skill: null,
    pipeline: [],
    card: "the segment with counts and ten sample rows",
  },
  {
    n: 2,
    title: null,
    owner: null,
    also: null,
    gate: "useful floor",
    skill: "tam-sizing",
    pipeline: [],
    card: "the segment with counts and ten sample rows",
  },
  {
    n: 3,
    title: null,
    owner: "code",
    also: { who: "josh", when: "company-first lanes: the yield card, then the pilot result before scaling" },
    gate: "title audit and spend ceiling",
    skill: "leadgen-mcp-routing; company-first: domain-waterfall, people-waterfall, unmask-shell-llc, hard-to-find-dm-discovery, serp-dm-discovery, unresolved-name-routing",
    pipeline: ["pull", "ingest", "find_emails"],
    card: "expected yield and cost per usable lead, and the pilot result for company-first lanes",
  },
  { n: 4, title: null, owner: "code", also: null, gate: null, skill: null, pipeline: [], card: null },
  {
    n: 5,
    title: null,
    owner: "code",
    also: { who: "cayden", when: "the client customer list" },
    gate: "response based scope and the cross campaign check against staging",
    skill: null,
    pipeline: ["suppress"],
    card: null,
  },
  {
    n: 6,
    title: null,
    owner: "code",
    also: null,
    gate: "sendable rule and stall runbook",
    skill: null,
    pipeline: ["verify"],
    card: null,
  },
  {
    n: 7,
    title: null,
    owner: "code",
    also: null,
    gate: "every merge field populated",
    skill: "normalizers: normalize_names_and_cities, normalize_company, conversational_location, assign_team",
    pipeline: ["normalize"],
    card: null,
  },
  {
    n: 8,
    title: null,
    owner: "code",
    also: { who: "cayden", when: "clears holds" },
    gate: null,
    skill: null,
    pipeline: ["qa"],
    card: null,
  },
  {
    n: 9,
    title: null,
    owner: "code",
    also: { who: "josh", when: "copy is needed" },
    gate: null,
    skill: null,
    pipeline: ["route"],
    card: "the parked cell and a clone offer",
  },
  { n: 10, title: null, owner: "code", also: null, gate: null, skill: null, pipeline: [], card: null },
  { n: 11, title: null, owner: "code", also: null, gate: "count assert", skill: null, pipeline: ["import"], card: null },
  { n: 12, title: null, owner: "code", also: null, gate: "the receipt posts", skill: null, pipeline: ["post_import"], card: "the receipt" },
  { n: 13, title: null, owner: "josh", also: null, gate: null, skill: null, pipeline: [], card: null },
];

/**
 * Internal stages the prompt did not place on a step. `trigger` opens a run
 * (before or at step 1?); `stage` is the Smartlead staging write (step 10?).
 * Both are questions in the PR; until answered they report no step.
 */
export const UNPLACED_STAGES: readonly Step[] = ["trigger", "stage"];

const BY_N = new Map(SPINE.map((s) => [s.n, s]));
const BY_STAGE = new Map<Step, SpineStep>();
for (const s of SPINE) for (const p of s.pipeline) BY_STAGE.set(p, s);

export function spineStep(n: number): SpineStep {
  const s = BY_N.get(n);
  if (!s) throw new Error(`no step ${n}; the spine has 13`);
  return s;
}

/** Which spine step an internal pipeline stage belongs to; null for the unplaced ones. */
export function stepForStage(stage: Step): SpineStep | null {
  return BY_STAGE.get(stage) ?? null;
}

/** "Step 6" or "Step 6 — <title>" once the skill supplies titles. Never a made-up name. */
export function stepLabel(n: number | null): string {
  if (n === null) return "no step (idle)";
  const s = spineStep(n);
  return s.title ? `Step ${s.n} — ${s.title}` : `Step ${s.n}`;
}

/** The gate a step must pass, for cards and ledger lines. */
export function gateLabel(n: number): string {
  const s = spineStep(n);
  return s.gate ?? `gate for step ${n} not yet named (ask Josh; the skill names it)`;
}

/** The step a lane moves to when this one is done. Null after 13. */
export function nextStep(n: number): number | null {
  return n < 13 ? n + 1 : null;
}
