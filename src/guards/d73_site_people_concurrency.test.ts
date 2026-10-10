import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PEOPLE_ASK_PARALLEL, PEOPLE_ASK_WORKERS, PEOPLE_EXTRACT_PARALLEL, PEOPLE_EXTRACT_WORKERS, PEOPLE_FETCH_PARALLEL, PEOPLE_FETCH_PER_HOST, PEOPLE_FETCH_WORKERS, PEOPLE_GEMINI_RPM } from "../stages/icp/loops.js";

/**
 * D73 — site_check(people) fans out. Defaults ~50 fetch (2 per host), ~28
 * Gemini and ~28 Jev, backoff on 429/5xx, a Gemini RPM limiter. A deploy
 * kills the HTTP call; Topup calls the same verb again. Nothing starts on
 * boot (D5). Already-extracted / already-answered domains are not paid
 * again. Ask Josh.
 */
const root = new URL("../../", import.meta.url);

describe("D73 — site-people concurrency and resume", () => {
  it("defaults are ~50 fetch workers, 2 per host, ~28 Gemini and ~28 Jev, 200 RPM", () => {
    assert.equal(PEOPLE_FETCH_PARALLEL * PEOPLE_FETCH_WORKERS, 50);
    assert.equal(PEOPLE_FETCH_PER_HOST, 2);
    assert.equal(PEOPLE_EXTRACT_PARALLEL * PEOPLE_EXTRACT_WORKERS, 28);
    assert.equal(PEOPLE_ASK_PARALLEL * PEOPLE_ASK_WORKERS, 28);
    assert.equal(PEOPLE_GEMINI_RPM, 200);
  });

  it("the people loops fan out, claim, back off, and resume by the same verb; boot stays dumb", async () => {
    const loops = await readFile(new URL("src/stages/icp/loops.ts", root), "utf8");
    assert.match(loops, /withBackoff/, "D73: 429/5xx retry with jitter");
    assert.match(loops, /o\.parallel/, "D73: fetch and grade take a parallel count");
    const client = await readFile(new URL("src/clients/sitePeople.ts", root), "utf8");
    assert.match(client, /SKIP LOCKED|claim/, "D73: extract and ask claim so fan-out cannot double-pay");
    const src = await readFile(new URL("src/canon/siteCheck.ts", root), "utf8");
    assert.match(src, /interval '2 minutes'/, "D73: stale fetch claims are released on resume");
    assert.match(src, /in_progress/, "D73: stale extract claims are released on resume");
    assert.match(src, /site_check\(question="people"/, "D73: next names the exact resume verb");
    assert.match(src, /does not resume/, "D73: a deploy does not auto-continue");
    assert.match(src, /siteCheckWorstCaseCents\("people", before\.unchecked\)/, "D73: the Gemini ceiling is still unchecked × the table");
    assert.match(src, /new RpmLimiter\(loops\.geminiRpm\)/, "D73: Gemini stays under the configured RPM");
    const boot = await readFile(new URL("src/index.ts", root), "utf8");
    assert.match(boot, /nothing is driven on boot/, "D5/D73: boot does not call site_check");
    assert.doesNotMatch(boot, /siteCheck\(/, "D5/D73: the process never fires site_check as it comes up");
    const env = await readFile(new URL(".env.example", root), "utf8");
    for (const k of ["SITE_PEOPLE_FETCH_PARALLEL", "SITE_PEOPLE_EXTRACT_PARALLEL", "SITE_PEOPLE_ASK_PARALLEL", "SITE_PEOPLE_GEMINI_RPM", "SITE_PEOPLE_FETCH_PER_HOST"]) {
      assert.match(env, new RegExp(`^${k}=`, "m"), `D3/D73: ${k} is named, never valued in the repo`);
    }
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D73\*\*/, "D73: fold into CANON. Ask Josh.");
    assert.match(canon, /~50 fetch workers/, "D73: CANON names the fetch default");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /does not resume|same verb again/, "D73: the babysitter tells Grok how to continue after a deploy");
  });
});
