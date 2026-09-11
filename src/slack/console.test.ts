import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CardRow, Repo } from "../db/repo.js";
import type { Role, RunRow } from "../domain/runs.js";
import { spendApprovalCard } from "./cards.js";
import { MemoryPoster } from "./client.js";
import { SlackConsole } from "./console.js";
import { Roles } from "./roles.js";

/** D2 / D9 — cards live in the database, resolve exactly once, and only the right role can tap. */

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
    recipe_id: "parlay.it_dm.v3",
    client_tag: "parlay",
    lane: "it_dm",
    campaign_id: null,
    trigger: "manual",
    status: "verifying",
    current_step: "verify",
    counts_by_status: {},
    spend_cents_by_vendor: {},
    slack_channel: null,
    slack_thread_ts: null,
    opened_by: "U_JOSH",
    opened_at: new Date().toISOString(),
    closed_at: null,
    last_error: null,
  };
}

function setup() {
  const repo = new FakeRepo();
  const poster = new MemoryPoster();
  const roles = new Roles(["U_JOSH"], ["U_CAYDEN"]);
  const console_ = new SlackConsole(repo as unknown as Repo, poster, roles, { opsChannel: "#topup_ops", clientChannels: { parlay: "#parlay" } });
  const r = run();
  repo.runs.set(r.run_id, r);
  return { repo, poster, console_, r };
}

describe("SlackConsole", () => {
  it("opens one thread per run in the client channel and posts the card into it", async () => {
    const { repo, poster, console_, r } = setup();
    const card = await console_.ask({
      run: r,
      kind: "spend_approval",
      audience: "owner",
      payload: { rows: 10_000, worst_case_cents: 2000 },
      text: "Spend ask",
      blocks: (id) => spendApprovalCard({ cardId: id, runId: r.run_id, clientTag: "parlay", step: "verify", vendor: "millionverifier", action: "verify", rows: 10_000, worstCaseCents: 2000, projectedUseful: null, spentTodayCents: 0, dailyCapCents: 2500 }),
    });
    assert.equal(poster.posts.length, 2, "thread header + card");
    assert.equal(poster.posts[0].channel, "#parlay");
    assert.equal(poster.posts[1].threadTs, poster.posts[0].ts);
    assert.ok(JSON.stringify(poster.posts[1].blocks).includes("$20.00"), "worst case is shown in dollars");
    assert.equal(repo.cards.get(card.card_id)!.slack_ts, poster.posts[1].ts);
    await console_.postInThread(r, "again");
    assert.equal(poster.posts.length, 3, "a second post reuses the thread");
  });

  it("an operator cannot approve spend; the reply says it needs Josh", async () => {
    const { console_, r } = setup();
    const card = await console_.ask({ run: r, kind: "spend_approval", audience: "owner", payload: {}, text: "ask", blocks: () => [] });
    const res = await console_.handleTap("U_CAYDEN", card.card_id, "approve_spend");
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "forbidden");
    assert.match(res.ok === false ? res.message : "", /This needs Josh/);
    const stranger = await console_.handleTap("U_NOBODY", card.card_id, "resume");
    assert.equal(stranger.ok === false && stranger.reason, "forbidden");
  });

  it("the owner resolves a card exactly once; a second tap is refused and the message loses its buttons", async () => {
    const { console_, poster, r } = setup();
    const card = await console_.ask({ run: r, kind: "spend_approval", audience: "owner", payload: {}, text: "ask", blocks: (id) => [{ type: "section", text: { type: "mrkdwn", text: id } }, { type: "actions", elements: [] }] });
    const first = await console_.handleTap("U_JOSH", card.card_id, "approve_spend");
    assert.equal(first.ok, true);
    const second = await console_.handleTap("U_JOSH", card.card_id, "decline_spend");
    assert.equal(second.ok === false && second.reason, "already_resolved");
    assert.equal(poster.updates.length, 1);
    assert.ok(!poster.updates[0].blocks!.some((b) => b.type === "actions"), "buttons removed on resolution");
  });

  it("awaitCard returns the resolved card and null on expiry", async () => {
    const { console_, repo, r } = setup();
    const card = await console_.ask({ run: r, kind: "stall", audience: "operator", payload: {}, text: "ask", blocks: () => [] });
    setTimeout(() => void console_.handleTap("U_CAYDEN", card.card_id, "resume"), 5);
    const resolved = await console_.awaitCard(card.card_id, { pollMs: 1, timeoutMs: 1000 });
    assert.equal(resolved?.resolution, "resume");
    const other = await console_.ask({ run: r, kind: "stall", audience: "operator", payload: {}, text: "ask", blocks: () => [] });
    repo.cards.get(other.card_id)!.status = "expired";
    assert.equal(await console_.awaitCard(other.card_id, { pollMs: 1, timeoutMs: 50 }), null);
  });

  it("resolveAs lets an MCP owner token take an owner action under the same rules", async () => {
    const { console_, r } = setup();
    const card = await console_.ask({ run: r, kind: "spend_approval", audience: "owner", payload: {}, text: "ask", blocks: () => [] });
    assert.equal((await console_.resolveAs("mcp:operator", "operator", card.card_id, "approve_spend")).ok, false);
    assert.equal((await console_.resolveAs("mcp:owner", "owner", card.card_id, "approve_spend")).ok, true);
  });
});
