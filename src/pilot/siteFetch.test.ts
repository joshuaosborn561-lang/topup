import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRobots, pathAllowed } from "./siteFetch.js";

describe("EMCOR owner-name pilot robots", () => {
  it("parses User-agent: * Disallow and allows the rest", () => {
    const r = parseRobots("User-agent: *\nDisallow: /admin\nDisallow: /cgi-bin\n");
    assert.equal(r.allowAll, false);
    assert.equal(pathAllowed("/about", r), true);
    assert.equal(pathAllowed("/admin", r), false);
    assert.equal(pathAllowed("/admin/x", r), false);
    assert.equal(pathAllowed("/cgi-bin/x", r), false);
  });

  it("Disallow: / blocks the host; missing robots allows", () => {
    const blocked = parseRobots("User-agent: *\nDisallow: /\n");
    assert.equal(pathAllowed("/", blocked), false);
    const empty = parseRobots("");
    assert.equal(empty.allowAll, true);
    assert.equal(pathAllowed("/about", empty), true);
  });
});
