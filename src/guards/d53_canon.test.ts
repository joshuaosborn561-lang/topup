import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_TOOLS, GROK_MAY } from "../grok/allowlist.js";
import { GROK_READS, GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE, RETIRED_MCP_TOOLS } from "../mcp/server.js";
import { SERVICE_VERSION } from "../version.js";

/**
 * D53 — the service is the dumb half. Grok reads, Grok runs the verbs, a
 * person approves every spend, Josh flips ACTIVE. The old size_client
 * planner is gone; `size` is a free dry-run read (D64). Nothing here
 * plans, watches, infers a recipe or posts to Slack. Ask Josh before any
 * of that comes back.
 */

const root = new URL("../../", import.meta.url);

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".ts")) out.push(u);
  }
  return out;
}

const GONE = ["src/watch/", "src/plan/", "src/slack/", "src/commands.ts", "src/policy/campaign.ts", "src/policy/spend.ts", "src/recipes/infer.ts", "src/recipes/resolve.ts", "src/recipes/parlay.ts", "src/recipes/bcp.ts", "src/recipes/powergryd.ts", "src/recipes/registry.ts", "src/mcp/queue.ts", "src/mcp/overview.ts", "src/mcp/sizeClient.ts", "src/stages/size/", "src/stages/trigger/", "src/stages/flip/", "src/ledger/digest.ts", "src/ledger/render.ts", "src/ledger/client_runway.ts", "recipes/"];

describe("D53 — the dumb half", () => {
  it("the MCP surface is exactly the canon tools, and Grok may call every one", () => {
    assert.deepEqual([...Object.keys(MCP_TOOL_ROLE)].sort(), [...CANON_TOOLS].sort(), "D53: a tool is on the surface that the canon does not name, or one the canon names is missing. Ask Josh.");
    for (const t of CANON_TOOLS) assert.ok((GROK_MAY as readonly string[]).includes(t), `D53: ${t} is on the surface but not on Grok's allow list`);
    for (const t of [...GROK_READS, ...GROK_VERBS]) assert.ok((CANON_TOOLS as readonly string[]).includes(t), `D53: ${t} is registered by grok.ts but not named in CANON_TOOLS`);
    for (const t of RETIRED_MCP_TOOLS) assert.equal(MCP_TOOL_ROLE[t], undefined, `D53: ${t} is retired and must not come back`);
  });

  it("the reasoning half is gone and nothing imports it", async () => {
    const present: string[] = [];
    for (const g of GONE) {
      const ok = await readFile(new URL(g, root), "utf8").then(() => true).catch(() => false);
      const dir = g.endsWith("/") ? await readdir(new URL(g, root)).then(() => true).catch(() => false) : false;
      if (ok || dir) present.push(g);
    }
    assert.deepEqual(present, [], `D53: the reasoning half is back on disk: ${present.join(", ")}. Grok does the reasoning; ask Josh.`);
    const offenders: string[] = [];
    for (const f of await walk(new URL("src/", root))) {
      const p = f.pathname.replace(root.pathname, "");
      if (p === "src/guards/d53_canon.test.ts") continue;
      const src = await readFile(f, "utf8");
      if (
        /from "[^"]*\/(watch|plan|slack)\/[^"]*"|from "[^"]*\/recipes\/(infer|resolve|parlay|bcp|powergryd|registry|trim|icpSource|start|load|dedupe)\.js"|from "[^"]*\/mcp\/(queue|overview|sizeClient|recipe)\.js"|from "[^"]*\/ledger\/(digest|render|client_runway)\.js"|from "[^"]*\/size\/[^"]*"|from "[^"]*\/(trigger|flip)\/[^"]*"|from "[^"]*\/runs\/(halt|resume)\.js"|from "[^"]*\/policy\/(campaign|spend)\.js"|from "[^"]*\/builds\/(record|choose)\.js"|from "node-cron"|from "@slack\/web-api"/.test(src)
      )
        offenders.push(p);
    }
    assert.deepEqual(offenders, [], `D53: a file imports the reasoning half: ${offenders.join(", ")}`);
  });

  it("nothing opens a run but a verb, and nothing drives one", async () => {
    const openers: string[] = [];
    const drivers: string[] = [];
    for (const f of await walk(new URL("src/", root))) {
      const p = f.pathname.replace(root.pathname, "");
      if (p.endsWith(".test.ts")) continue;
      const src = await readFile(f, "utf8");
      if (/repo\.openRun\(/.test(src) && p !== "src/jobs/runner.ts") openers.push(p);
      if (/startTopup|resumeOpenRuns|\bdrive\(|cron\.schedule/.test(src)) drivers.push(p);
    }
    assert.deepEqual(openers, [], `D51/D53: a run is opened outside the pull verb in ${openers.join(", ")}`);
    assert.deepEqual(drivers, [], `D51/D53: something drives or schedules a run in ${drivers.join(", ")}. Grok calls the next verb; nothing chains.`);
  });

  it("the canon names the rules, every read and every verb, and the version is 1.0.0", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /one positive reply (per|for every) 2,000 sends/i, "D53: CANON.md states the reply bar");
    assert.match(canon, /at least 1,000/i, "D53: CANON.md states the 1,000 net-new floor");
    assert.match(canon, /the TAM for this campaign is exhausted/, "D53: CANON.md uses Josh's wording for an exhausted TAM");
    assert.match(canon, /1 to 2,000/, "D53: CANON.md states the 1 to 2,000 rows per job rule");
    for (const t of CANON_TOOLS) assert.ok(new RegExp(`\`${t}[(\`]`).test(canon), `D53: CANON.md does not name \`${t}\``);
    assert.match(canon, /never (sets|flips) a campaign ACTIVE|Josh flips ACTIVE/i, "D53: Josh flips ACTIVE by hand");
    const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version: string };
    assert.equal(pkg.version, SERVICE_VERSION, "D53: package.json and SERVICE_VERSION drift");
    assert.equal(SERVICE_VERSION, "1.0.0", "D53: the rebuild ships as 1.0.0");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /`canon`/, "D53: the babysitter skill points Grok at the canon read");
    const readme = await readFile(new URL("README.md", root), "utf8");
    for (const t of CANON_TOOLS) assert.ok(new RegExp(`\`${t}[(\`]`).test(readme), `D53: README.md does not name \`${t}\``);
  });
});
