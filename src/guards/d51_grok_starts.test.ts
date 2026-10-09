import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { Repo } from "../db/repo.js";
import { evaluateCampaign } from "../policy/index.js";
import { MIN_NET_NEW, REPLY_BAR_PER_2000 } from "../policy/rules.js";
import { SPINE } from "../spine/steps.js";
import { railsConfigFrom, SpendRails } from "../spend/rails.js";

/**
 * D51 — nothing starts on its own (Grok bot starts), every paid call waits
 * for a named approval, and under 1,000 leads available the line says the
 * TAM for this campaign is exhausted. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D51 — Grok bot starts; spend is approved first", () => {
  it("CANON, the ledger, README and the babysitter name D51 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D5\d\*\*/);
    assert.match(canon, /## Nothing starts on its own; spend is approved first \(D51\)/);
    assert.match(canon, /Never open a run from the watch, and never spend before a named approval \(D51\)/);
    assert.match(canon, /the TAM for this campaign is exhausted/);
    assert.match(ledger, /## D51 — Nothing starts on its own/);
    assert.match(ledger, /^\| D51 \| Live/m);
    assert.match(readme, /auto cap \$0 on the service \(D51\)/);
    assert.match(babysitter, /Nothing starts on its own \(D51\)/);
    assert.match(babysitter, /the TAM for this\s+campaign is exhausted/);
  });

  it("the watch never opens a run: it logs what it would have started, with the count summary", async () => {
    const watch = await readFile(new URL("src/watch/index.ts", root), "utf8");
    assert.doesNotMatch(watch, /startTopup\(/, "D51: the watch does not start runs. Grok bot does. Ask Josh.");
    assert.match(watch, /"would start"/);
    assert.match(watch, /last_pull_counts/);
  });

  it("the auto cap can be zero, and then every paid call asks for a named approval", () => {
    const cfg = railsConfigFrom({ AUTO_SPEND_CAP_USD: 0, DAILY_VENDOR_CAP_USD: 25 });
    assert.equal(cfg.autoCapCents, 0);
    const repo = { spentTodayCents: async () => 0 } as unknown as Repo;
    const rails = new SpendRails(repo, cfg);
    const req = { runId: "r", clientTag: "bcp", step: "size" as const, vendor: "aiark", action: "people_preview", rows: 1, recipeAuthorised: true, worstCaseCents: 5 };
    assert.equal(rails.decide(req, 0).kind, "ask", "D51: a five-cent call waits for a tap when the cap is zero");
    assert.equal(rails.decide({ ...req, approvedCents: 5 }, 0).kind, "proceed", "D51: an approval lets it run");
    assert.equal(rails.decide({ ...req, rows: 0, worstCaseCents: 0 }, 0).kind, "proceed", "D51: a free call proceeds");
  });

  it("the reply bar is one per 2,000 and the exhausted-TAM line is the policy's words, in the skill too", async () => {
    assert.equal(REPLY_BAR_PER_2000, 1);
    assert.equal(MIN_NET_NEW, 1000);
    const verdict = evaluateCampaign({ client_tag: "bcp", campaign_id: 7, status: "ACTIVE", sends: 4000, positives: 3, sized: true, tam_total: 2094, tam_left: 835 });
    assert.equal(verdict.gate, "tam_filled");
    assert.match(verdict.reason, /the TAM for this campaign is exhausted/);
    assert.match(SPINE[1].gate, /the TAM for this campaign is exhausted/);
    assert.doesNotMatch(SPINE[1].gate, /never declare a pool exhausted/, "D51: the gate says exhausted when it is. Ask Josh.");
    const skill = await readFile(new URL("skills/lead-list-build/SKILL.md", root), "utf8");
    assert.doesNotMatch(skill, /never declare a pool exhausted/);
  });
});
