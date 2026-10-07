import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailsFromCsv, lanePeopleTam, netNewFromOverlap, planShares, scaleOverlap } from "./overlap.js";

describe("lane net new is the TAM overlap, not the client total", () => {
  it("sizes 750 when 50 of 800 are held and the client total is 6658", () => {
    const clientHeld = 6658;
    const tam = 800;
    const sample = Array.from({ length: tam }, (_, i) => `person${i}@example.com`);
    const held = new Set(sample.slice(0, 50));
    const matched = sample.filter((email) => held.has(email)).length;
    const overlap = scaleOverlap(tam, sample.length, matched);
    assert.equal(overlap.held, 50);
    assert.equal(overlap.method, "overlap");
    assert.equal(netNewFromOverlap(tam, overlap.held), 750);
    assert.ok(clientHeld > tam);
    assert.notEqual(overlap.held, clientHeld);
    assert.equal(lanePeopleTam([tam, tam, tam, tam]), tam);
  });

  it("splits one lane net across campaigns so the plan does not exceed it", () => {
    const shares = planShares(1247, [10_000, 10_000, 10_000, 10_000]);
    assert.equal(shares.reduce((sum, share) => sum + share, 0), 1247);
    assert.ok(shares.every((share) => share < 1247));
    const small = planShares(750, [100, 100, 100, 100]);
    assert.equal(small.reduce((sum, share) => sum + share, 0), 400);
  });

  it("scales a short sample and reads emails from a csv page", () => {
    const scaled = scaleOverlap(800, 100, 6);
    assert.equal(scaled.method, "sample");
    assert.equal(scaled.held, 48);
    assert.equal(netNewFromOverlap(800, scaled.held), 752);
    const emails = emailsFromCsv('name,email\n"A, B",one@example.com\nC,two@example.com\n');
    assert.deepEqual(emails, ["one@example.com", "two@example.com"]);
  });
});
