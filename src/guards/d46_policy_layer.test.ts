import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { evaluateCampaign, IGNORED_CLIENT_TAGS, MIN_NET_NEW, NEVER_TOPUP_CAMPAIGN_IDS, PARLAY_REFRESH_FIRST, PARLAY_REFRESH_LAST, PILOT_GATE_PERCENT, REPLY_BAR_PER_2000, spendAudience } from "../policy/index.js";
import { haltBeforeStep } from "../runs/halt.js";

/** D46 — one policy layer, judged per campaign. Ask Josh before changing a number here. */

const root = new URL("../../", import.meta.url);

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".ts")) out.push(u);
  }
  return out;
}

describe("D46 — the policy layer", () => {
  it("CANON and the ledger name D46 and the rules — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /## One policy layer \(D46\)/);
    assert.match(canon, /1,000 net new/);
    assert.match(canon, /zero positives never qualifies/);
    assert.match(canon, /Parking is per campaign, never per run/);
    assert.match(ledger, /## D46 — /);
    assert.match(ledger, /^\| D46 \| Live/m);
  });

  it("the numbers are the brief's — Ask Josh", () => {
    assert.equal(REPLY_BAR_PER_2000, 1);
    assert.equal(MIN_NET_NEW, 1000);
    assert.equal(PILOT_GATE_PERCENT, 80);
    assert.deepEqual([...NEVER_TOPUP_CAMPAIGN_IDS], [4085158, 3122546]);
    assert.deepEqual([...IGNORED_CLIENT_TAGS], ["goliath"]);
    assert.equal(PARLAY_REFRESH_FIRST, 4049046);
    assert.equal(PARLAY_REFRESH_LAST, 4049064);
    assert.equal(spendAudience(500), "owner", "D46/D9: $5 or above is Josh");
    assert.equal(spendAudience(499), "operator");
  });

  it("zero positives never qualifies; a paused, dropped, retired or excluded campaign never starts", () => {
    const base = { client_tag: "insight", status: "ACTIVE", sends: 50, positives: 0 };
    assert.equal(evaluateCampaign({ ...base, campaign_id: 1 }).gate, "under_reply_bar");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 2, positives: 1 }).gate, "ok");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 3, positives: 9, campaign_name: "Insight Google SADA" }).gate, "dropped");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 4, positives: 9, campaign_name: "Insight OEM Channel Reps" }).gate, "paused");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 4085158, positives: 9 }).gate, "excluded");
    assert.equal(evaluateCampaign({ ...base, client_tag: "parlay", campaign_id: 3705889, positives: 9 }).gate, "retired");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 5, positives: 9, sized: true, tam_total: 900, tam_left: 900 }).gate, "tam_filled");
  });

  it("a run with nothing to pull closes as sized; it does not page anyone", () => {
    assert.equal(haltBeforeStep("pull", { nothing_to_pull: 1 }, false), "sized");
    assert.equal(haltBeforeStep("pull", {}, false), null);
  });

  it("no other source file re-derives the reply bar, the minimum or the never-top-up ids", async () => {
    const offenders: string[] = [];
    for (const f of await walk(new URL("src/", root))) {
      const p = f.pathname.replace(root.pathname, "");
      if (p.startsWith("src/policy/") || p.endsWith(".test.ts")) continue;
      const text = await readFile(f, "utf8");
      if (/4085158|3122546/.test(text)) offenders.push(`${p} (never-top-up ids)`);
      if (/TAM_LEFT_FLOOR\s*=\s*\d/.test(text) || /MIN_NET_NEW\s*=\s*\d/.test(text)) offenders.push(`${p} (minimum net new)`);
      if (/PILOT_GATE\s*=\s*\d/.test(text)) offenders.push(`${p} (pilot gate)`);
    }
    assert.deepEqual(offenders, [], `D46: a rule lives outside src/policy in ${offenders.join(", ")}. Move it. Ask Josh.`);
  });
});
