import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Repo } from "../db/repo.js";
import type { RunRow } from "../domain/runs.js";
import type { Block } from "./cards.js";
import { MemoryPoster } from "./client.js";
import { SlackConsole } from "./console.js";
import { Roles } from "./roles.js";

/** A deleted or archived channel must not stop a run; the console opens a new thread instead. */

class FlakyPoster extends MemoryPoster {
  constructor(private readonly dead: Set<string>) {
    super();
  }
  override async post(channel: string, text: string, blocks?: Block[], threadTs?: string) {
    if (this.dead.has(channel)) {
      throw Object.assign(new Error(`An API error occurred: ${"channel_not_found"}`), { data: { error: "channel_not_found" } });
    }
    return super.post(channel, text, blocks, threadTs);
  }
}

class FakeRepo {
  threads: Array<{ runId: string; channel: string; ts: string }> = [];
  async setRunThread(runId: string, channel: string, ts: string) {
    this.threads.push({ runId, channel, ts });
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
    slack_channel: "#old_parlay",
    slack_thread_ts: "1.000001",
    opened_by: "U_JOSH",
    opened_at: new Date().toISOString(),
    closed_at: null,
    last_error: null,
  };
}

function setup(dead: string[]) {
  const repo = new FakeRepo();
  const poster = new FlakyPoster(new Set(dead));
  const console_ = new SlackConsole(repo as unknown as Repo, poster, new Roles(["U_JOSH"], ["U_CAYDEN"]), {
    opsChannel: "#topup_ops",
    clientChannels: { parlay: "#parlay" },
  });
  return { repo, poster, console_ };
}

describe("SlackConsole.postInThread with a dead thread", () => {
  it("a stored dead thread falls through to a new thread in the client channel", async () => {
    const { repo, poster, console_ } = setup(["#old_parlay"]);
    const res = await console_.postInThread(run(), "hello");
    assert.equal(res.channel, "#parlay");
    assert.equal(poster.posts.length, 2, "new thread header + message");
    assert.equal(poster.posts[0].channel, "#parlay");
    assert.equal(poster.posts[1].text, "hello");
    assert.equal(poster.posts[1].threadTs, poster.posts[0].ts);
    assert.deepEqual(repo.threads, [{ runId: run().run_id, channel: "#parlay", ts: poster.posts[0].ts }]);
  });

  it("if the client channel is also gone, posts in ops and records the ops thread", async () => {
    const { repo, poster, console_ } = setup(["#old_parlay", "#parlay"]);
    const res = await console_.postInThread(run(), "hello");
    assert.equal(res.channel, "#topup_ops");
    assert.equal(poster.posts.length, 2, "ops header + message");
    assert.equal(poster.posts[0].channel, "#topup_ops");
    assert.equal(poster.posts[1].text, "hello");
    assert.equal(poster.posts[1].threadTs, poster.posts[0].ts);
    assert.deepEqual(repo.threads, [{ runId: run().run_id, channel: "#topup_ops", ts: poster.posts[0].ts }]);
  });
});
