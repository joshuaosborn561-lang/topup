import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { CardRow, Repo } from "../db/repo.js";
import type { Role, RunRow } from "../domain/runs.js";
import { HIDDEN_FROM_OPERATOR, MCP_TOOL_ROLE } from "../mcp/server.js";
import { MemoryPoster } from "../slack/client.js";
import { SlackConsole } from "../slack/console.js";
import { CHOICE_ROLE, COMMAND_ROLE, OWNER_SPEND_FLOOR_CENTS, requiredRole, Roles, spendAudience } from "../slack/roles.js";
import { spendAsk } from "../stages/common.js";

/**
 * D47 — the service never waits on Josh except for a spend gate whose worst
 * case is above $50. Every other card is Cayden's. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(u);
  }
  return out;
}

class FakeRepo {
  cards = new Map<string, CardRow>();
  runs = new Map<string, RunRow>();
  private n = 0;
  async openCard(input: { run_id: string | null; kind: string; audience: Role; payload: Record<string, unknown>; expires_at?: Date | null }): Promise<CardRow> {
    const card: CardRow = {
      card_id: `card-${++this.n}`,
      run_id: input.run_id,
      kind: input.kind,
      audience: input.audience,
      status: "open",
      payload: { ...input.payload },
      slack_channel: null,
      slack_ts: null,
      resolved_by: null,
      resolution: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      expires_at: input.expires_at?.toISOString() ?? null,
    };
    this.cards.set(card.card_id, card);
    return card;
  }
  async setCardBlocks(id: string, blocks: unknown[]) {
    this.cards.get(id)!.payload.blocks = blocks;
  }
  async setCardMessage(id: string, channel: string, ts: string) {
    Object.assign(this.cards.get(id)!, { slack_channel: channel, slack_ts: ts });
  }
  async getCard(id: string) {
    return this.cards.get(id) ?? null;
  }
  async openCardsForRun(runId: string) {
    return [...this.cards.values()].filter((c) => c.run_id === runId && c.status === "open");
  }
  async resolveCard(id: string, by: string, resolution: string) {
    const c = this.cards.get(id);
    if (!c || c.status !== "open") return null;
    Object.assign(c, { status: "resolved", resolved_by: by, resolution, resolved_at: new Date().toISOString() });
    return c;
  }
  async setRunThread(runId: string, channel: string, ts: string) {
    Object.assign(this.runs.get(runId)!, { slack_channel: channel, slack_thread_ts: ts });
  }
}

function run(): RunRow {
  return {
    run_id: "11111111-2222-3333-4444-555555555555",
    recipe_id: "powergryd.vciso.v1",
    client_tag: "powergryd",
    lane: "vciso",
    campaign_id: null,
    trigger: "manual",
    status: "resolving",
    current_step: "puzzle",
    counts_by_status: {},
    spend_cents_by_vendor: {},
    slack_channel: null,
    slack_thread_ts: null,
    opened_by: "U_CAYDEN",
    opened_at: new Date().toISOString(),
    closed_at: null,
    last_error: null,
  };
}

function setup() {
  const repo = new FakeRepo();
  const poster = new MemoryPoster();
  const roles = new Roles(["U_JOSH"], ["U_CAYDEN"]);
  const console_ = new SlackConsole(repo as unknown as Repo, poster, roles, { opsChannel: "#topup_ops", clientChannels: {} });
  const r = run();
  repo.runs.set(r.run_id, r);
  return { repo, poster, console_, r };
}

describe("D47 — never wait on Josh except a spend gate above $50", () => {
  it("CANON and the ledger name D47 and the $50 floor — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /never waits on Josh except for a spend gate above \$50/);
    assert.match(canon, /\(D47\)/);
    assert.match(ledger, /^## D47 — Never wait on Josh/m);
    assert.match(ledger, /^\| D47 \|/m);
  });

  it("the floor is $50; approve/split rise to Josh only above it; everything else is Cayden's", () => {
    assert.equal(OWNER_SPEND_FLOOR_CENTS, 5000, "D47: $50. Ask Josh before moving it.");
    assert.equal(spendAudience(5000), "operator");
    assert.equal(spendAudience(5001), "owner");
    for (const [choice, role] of Object.entries(CHOICE_ROLE)) {
      assert.equal(role, "operator", `D47: ${choice} must not be owner-only by default; only spend above $50 waits on Josh. Ask Josh.`);
    }
    for (const [cmd, role] of Object.entries(COMMAND_ROLE)) {
      assert.equal(role, "operator", `D47: ${cmd} must not need Josh. Ask Josh.`);
    }
    assert.equal(requiredRole("approve_spend", { worst_case_cents: 5001 }), "owner");
    assert.equal(requiredRole("split", { worst_case_cents: 5001 }), "owner");
    assert.equal(requiredRole("approve_spend", { worst_case_cents: 5000 }), "operator");
    assert.equal(requiredRole("approve_spend", {}), "owner", "D47: a spend card with no amount is never guessed down");
    assert.equal(requiredRole("decline_spend", { worst_case_cents: 1_000_000 }), "operator", "D47: declining spends nothing");
    assert.equal(requiredRole("topup_anyway", {}), "operator");
    assert.equal(requiredRole("continue_without", {}), "operator");
    assert.equal(requiredRole("scale_pilot", {}), "operator");
    const ownerTools = Object.entries(MCP_TOOL_ROLE).filter(([, r]) => r === "owner").map(([t]) => t);
    assert.deepEqual(ownerTools, ["sample_rows"], "D47: the only owner-only MCP tool is the lead-row dump. Ask Josh.");
    assert.deepEqual([...HIDDEN_FROM_OPERATOR], ["sample_rows"]);
  });

  it("no card is hard-wired to Josh: no literal owner audience and no bare awaiting_josh in src", async () => {
    const audienceOffenders: string[] = [];
    const statusOffenders: string[] = [];
    const askJoshParks: string[] = [];
    for (const f of await walk(new URL("src/", root))) {
      const p = f.pathname.replace(root.pathname, "");
      if (p === "src/domain/runs.ts") continue;
      const src = await readFile(f, "utf8");
      if (/audience:\s*"owner"/.test(src)) audienceOffenders.push(p);
      for (const line of src.split("\n")) {
        if (line.includes('"awaiting_josh"') && !/=== "owner" \? "awaiting_josh"/.test(line)) statusOffenders.push(`${p}: ${line.trim().slice(0, 100)}`);
      }
      if (/over the auto cap\. Ask Josh/.test(src)) askJoshParks.push(p);
    }
    assert.deepEqual(audienceOffenders, [], `D47: a card is posted to Josh by name in ${audienceOffenders.join(", ")}. Use spendAudience(worst) or "operator". Ask Josh.`);
    assert.deepEqual(statusOffenders, [], `D47: awaiting_josh is set without a spend amount deciding it:\n${statusOffenders.join("\n")}`);
    assert.deepEqual(askJoshParks, [], `D47: a stage still parks on "Ask Josh" instead of a spend card in ${askJoshParks.join(", ")}. Use spendAsk.`);
  });

  it("the console refuses the operator only above $50 and names the amount", async () => {
    const { console_, r } = setup();
    const big = await console_.ask({ run: r, kind: "spend_approval", audience: "owner", payload: { step: "puzzle", worst_case_cents: 6_000 }, text: "ask", blocks: () => [] });
    const refused = await console_.handleTap("U_CAYDEN", big.card_id, "approve_spend");
    assert.equal(refused.ok, false);
    assert.match(refused.ok === false ? refused.message : "", /Spend above \$50 needs Josh\. \(approve_spend on a \$60\.00 worst case\)/);
    assert.equal((await console_.handleTap("U_CAYDEN", big.card_id, "decline_spend")).ok, true, "D47: Cayden may decline any amount");
    const small = await console_.ask({ run: r, kind: "spend_approval", audience: "operator", payload: { step: "puzzle", worst_case_cents: 5_000 }, text: "ask", blocks: () => [] });
    assert.equal((await console_.handleTap("U_CAYDEN", small.card_id, "approve_spend")).ok, true, "D47: $50 exactly is Cayden's");
    for (const [kind, choice] of [
      ["not_working", "topup_anyway"],
      ["gate", "resume_run"],
      ["pending_campaign", "continue_without"],
      ["stall", "split"],
    ] as const) {
      const card = await console_.ask({ run: r, kind, audience: "operator", payload: { worst_case_cents: 100 }, text: "ask", blocks: () => [] });
      assert.equal((await console_.handleTap("U_CAYDEN", card.card_id, choice)).ok, true, `D47: ${choice} on ${kind} is Cayden's`);
    }
  });

  it("spendAsk posts one card to the right person and returns waiting; a second call does not post again", async () => {
    const { console_, repo, r } = setup();
    const base = { vendor: "apify", action: "export", rows: 400, quoteUsd: 7.5, spentTodayCents: 0, dailyCapCents: 2500 };
    const small = await spendAsk({ repo: repo as unknown as Repo, console: console_ }, r, "puzzle", { ...base, worstCaseCents: 1_200 });
    assert.deepEqual(small.kind === "waiting" ? small.on : null, "operator");
    const cards = [...repo.cards.values()].filter((c) => c.kind === "spend_approval");
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.audience, "operator");
    assert.equal(cards[0]!.payload.step, "puzzle");
    assert.equal(cards[0]!.payload.worst_case_cents, 1_200);
    const again = await spendAsk({ repo: repo as unknown as Repo, console: console_ }, r, "puzzle", { ...base, worstCaseCents: 1_200 });
    assert.equal(again.kind, "waiting");
    assert.equal([...repo.cards.values()].filter((c) => c.kind === "spend_approval").length, 1, "one open spend card per step");
    cards[0]!.status = "resolved";
    const big = await spendAsk({ repo: repo as unknown as Repo, console: console_ }, r, "find_emails", { ...base, worstCaseCents: 9_000 });
    assert.deepEqual(big.kind === "waiting" ? big.on : null, "owner", "D47: above $50 the card is Josh's");
  });
});
