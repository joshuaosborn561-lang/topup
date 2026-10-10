import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverOwnerLinks,
  extractOwnerFromHtml,
  extractOwnerFromReviewsPayload,
  extractOwnerFromReviewText,
  htmlToText,
  namesAgree,
  normalizeOwnerName,
} from "./ownerName.js";

describe("EMCOR owner-name pilot extractors (free, rule-based)", () => {
  it("pulls founded-by / owner / json-ld and rejects junk", () => {
    assert.equal(normalizeOwnerName("Jane Smith"), "Jane Smith");
    assert.equal(normalizeOwnerName("Our Team"), null);
    assert.equal(extractOwnerFromHtml("<p>Founded by Jane Smith in 1998.</p>")?.name, "Jane Smith");
    assert.equal(extractOwnerFromHtml("<p>Founded by Jane Smith in 1998.</p>")?.title, "founder");
    assert.equal(extractOwnerFromHtml("<p>Owner: Alex Rivera</p>")?.name, "Alex Rivera");
    assert.equal(extractOwnerFromHtml("<p>Meet the owner: Pat Nguyen</p>")?.pattern, "meet_the_owner");
    assert.equal(extractOwnerFromHtml("<p>Chris Lee, President</p>")?.title, "president");
    assert.equal(extractOwnerFromHtml("<p>Welcome to our team. Click here to learn more.</p>"), null);
    const ld = extractOwnerFromHtml(
      `<script type="application/ld+json">{"@type":"Organization","founder":{"@type":"Person","name":"Riley Cohen","jobTitle":"Owner"}}</script>`,
    );
    assert.equal(ld?.name, "Riley Cohen");
    assert.equal(ld?.pattern, "jsonld_founder");
    assert.match(htmlToText("<script>var x=1</script><p>Hi</p>"), /Hi/);
  });

  it("reads owner-reply signatures and stored review JSON, ignores a count", () => {
    assert.equal(extractOwnerFromReviewText("Thanks, Dave, Owner")?.name, "Dave");
    assert.equal(extractOwnerFromReviewText("- Sam Jones, Owner\nWe appreciate it.")?.name, "Sam Jones");
    assert.equal(extractOwnerFromReviewsPayload(42), null);
    assert.equal(extractOwnerFromReviewsPayload("128"), null);
    assert.equal(extractOwnerFromReviewsPayload({ ownerAnswer: { text: "Thanks, Morgan Lee, Owner" } })?.name, "Morgan Lee");
    assert.equal(namesAgree("Jane Smith", "Jane Smith"), true);
    assert.equal(namesAgree("Jane A Smith", "Jane Smith"), true);
    assert.equal(namesAgree("Jane Smith", "Pat Nguyen"), false);
    assert.equal(namesAgree("Jane Smith", null), null);
  });

  it("discovers same-host about/team/owner links", () => {
    const html = `<a href="/about">About</a><a href="https://other.test/team">no</a><a href="/contact-us">Contact</a>`;
    const links = discoverOwnerLinks(html, new URL("https://example.test/"));
    assert.ok(links.some((u) => u.endsWith("/about")));
    assert.ok(links.some((u) => u.endsWith("/contact-us")));
    assert.ok(!links.some((u) => u.includes("other.test")));
  });
});
