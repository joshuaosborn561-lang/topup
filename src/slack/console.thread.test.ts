import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Repo } from "../db/repo.js";
import type { RunRow } from "../domain/runs.js";
import { MemoryPoster } from "./client.js";
import { SlackConsole } from "./console.js";
import { Roles } from "./roles.js";

function run(): RunRow {
  return {
    run_id: "11111111-2222-3333-4444-555555555555",
    recipe_id: "peterson.c1_general_contractors.v0",
    client_tag: "peterson",
    lane: "c1_general_contractors",
    campaign_id: null,
    trigger: "manual",
    status: "open",
    current_step: null,
    counts_by_status: {},
    spend_cents_by_vendor: {},
    slack_channel: null,
    slack_thread_ts: null,
    opened_by: "mcp:operator",
    opened_at: new Date().toISOString(),
    closed_at: null,
    last_error: null,
  };
}

describe("a run starts without Slack", () => {
  it("openRunThread and postInThread do not call the poster", async () => {
    const poster = new MemoryPoster();
    const console_ = new SlackConsole({} as Repo, poster, new Roles([], []), {
      opsChannel: "#topup_ops",
      clientChannels: { peterson: "#peterson" },
    });
    const opened = await console_.openRunThread(run(), "Top-up run started");
    assert.equal(opened.slack_thread_ts, null);
    const posted = await console_.postInThread(run(), "step line");
    assert.equal(posted.ts, "unposted");
    assert.equal(poster.posts.length, 0);
  });
});
