import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mailClassFromMxHost } from "./mx.js";
import { segmentFor, verdictFromCsvRow } from "./sendable.js";

/** D10 — sendable is mv ok, or catch_all + N2B confirmed. Nothing else. */

const row = (o: Record<string, string>) => ({ email: "Person@Example.com", mail_class: "direct", ...o });

describe("sendable rule (D10)", () => {
  it("MillionVerifier ok is sendable via mv_ok", () => {
    const v = verdictFromCsvRow(row({ verification_source: "millionverifier", verification_status: "ok" }), "sendable")!;
    assert.equal(v.sendable, true);
    assert.equal(v.verify_path, "mv_ok");
    assert.equal(v.ev_status, "sendable");
    assert.equal(v.email, "person@example.com");
    assert.equal(v.domain, "example.com");
  });

  it("catch-all confirmed by No2Bounce is sendable via catch_all_n2b", () => {
    const v = verdictFromCsvRow(row({ verification_source: "no2bounce", verification_status: "deliverable", confidence: "confirmed" }), "sendable")!;
    assert.equal(v.sendable, true);
    assert.equal(v.verify_path, "catch_all_n2b");
    assert.equal(v.mv_status, "catch_all_or_unknown");
    assert.equal(v.n2b_status, "deliverable");
  });

  it("an accept-all N2B could not confirm is ambiguous, and ambiguous means drop", () => {
    const v = verdictFromCsvRow(row({ verification_source: "no2bounce", verification_status: "unresolved_catchall", confidence: "unresolved" }), "unresolved")!;
    assert.equal(v.sendable, false);
    assert.equal(v.ev_status, "unresolved");
  });

  it("a row in the SENDABLE file without a qualifying source is still not sendable", () => {
    const v = verdictFromCsvRow(row({ verification_source: "millionverifier", verification_status: "catch_all" }), "sendable")!;
    assert.equal(v.sendable, false, "D10: 'passed' is not a verdict; only ok or N2B-confirmed sends");
  });

  it("rejected rows are rejected; never-verified rows are unresolved", () => {
    assert.equal(verdictFromCsvRow(row({ verification_source: "millionverifier", verification_status: "invalid" }), "rejected")!.ev_status, "rejected");
    assert.equal(verdictFromCsvRow(row({ verification_status: "never_verified" }), "rejected")!.ev_status, "unresolved");
  });

  it("rows without an address are skipped", () => {
    assert.equal(verdictFromCsvRow({ email: "" }, "sendable"), null);
  });

  it("SEG split comes from mail_class only", () => {
    assert.equal(segmentFor("seg"), "SEG");
    assert.equal(segmentFor("native_filter"), "OTHER");
    assert.equal(segmentFor(null), "OTHER");
  });
});

describe("D34 — MX fallback classifies gateway hosts", () => {
  it("proofpoint / mimecast / pphosted are SEG; empty is unknown; a random host is direct", () => {
    assert.equal(mailClassFromMxHost("mx1.pphosted.com"), "seg");
    assert.equal(mailClassFromMxHost("us-smtp-inbound-1.mimecast.com"), "seg");
    assert.equal(mailClassFromMxHost(""), "unknown");
    assert.equal(mailClassFromMxHost(null), "unknown");
    assert.equal(mailClassFromMxHost("aspmx.l.google.com"), "seg");
    assert.equal(mailClassFromMxHost("mx.example.com"), "direct");
  });
});
