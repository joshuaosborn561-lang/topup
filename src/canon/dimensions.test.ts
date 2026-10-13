import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDimension, computeDimensions, dimensionSegments, md5Parity, parseDimension, parseDimensions } from "./dimensions.js";

/** D106 — derived routing dimensions are data off the record, computed from a row's own columns. Ask Josh. */
describe("D106 — derived dimensions", () => {
  it("parses the four kinds and refuses a reserved name, a column outside the lane, or a bad pattern", () => {
    assert.ok(parseDimension({ name: "title_class", kind: "match", column: "title", cases: [{ value: "junior", pattern: "assistant|intern" }], else: "senior" }));
    assert.ok(parseDimension({ name: "size", kind: "set", column: "company_size", cases: [{ value: "under_1k", values: ["1 to 10", "11 to 50"] }], else: "over_1k" }));
    assert.ok(parseDimension({ name: "greeting", kind: "present", column: "first_name_n", present: "named", absent: "team" }));
    assert.ok(parseDimension({ name: "arm", kind: "hash_parity", column: "company_domain", even: "scope", odd: "backup" }));
    assert.equal(parseDimension({ name: "band", kind: "present", column: "title", present: "a", absent: "b" }), null, "band is built in");
    assert.equal(parseDimension({ name: "x", kind: "present", column: "email", present: "a", absent: "b" }), null, "email is not a routing column");
    assert.equal(parseDimension({ name: "x", kind: "match", column: "title", cases: [{ value: "a", pattern: "(" }], else: "b" }), null, "bad regex");
    assert.equal(parseDimension({ name: "x", kind: "match", column: "title", cases: [{ value: "a", pattern: "(a+)+" }], else: "b" }), null, "runaway regex");
    assert.equal(parseDimension({ name: "x", kind: "magic", column: "title" }), null);
    assert.deepEqual(parseDimensions({ dimensions: [{ name: "x", kind: "present", column: "title", present: "a", absent: "b" }, { name: "x", kind: "present", column: "title", present: "a", absent: "b" }] }), [], "a duplicate name is not usable");
    assert.equal(parseDimensions({ routing: [] }), null, "absent is absent");
  });

  it("computes each kind the way the recorded builds did", () => {
    const title = parseDimension({ name: "title_class", kind: "match", column: "title", cases: [{ value: "junior", pattern: "assistant|coordinator|admin|intern|associate|technician|specialist" }], else: "senior" })!;
    assert.equal(computeDimension(title, { title: "Assistant Property Manager" }), "junior");
    assert.equal(computeDimension(title, { title: "Director of Facilities" }), "senior");
    assert.equal(computeDimension(title, { title: null }), "senior");
    const sub = parseDimension({ name: "sublane", kind: "match", column: "industry", cases: [{ value: "senior_living", pattern: "nursing|residential care|elderly" }], else: "hospitals" })!;
    assert.equal(computeDimension(sub, { industry: "Nursing Homes and Residential Care Facilities" }), "senior_living");
    assert.equal(computeDimension(sub, { industry: "Hospitals and Health Care" }), "hospitals");
    const size = parseDimension({ name: "size", kind: "set", column: "company_size", cases: [{ value: "under_1k", values: ["1 to 10", "11 to 50", "51 to 200", "201 to 500", "501 to 1000"] }], else: "over_1k" })!;
    assert.equal(computeDimension(size, { company_size: "11 to 50" }), "under_1k");
    assert.equal(computeDimension(size, { company_size: "1001 to 5000" }), "over_1k");
    const greet = parseDimension({ name: "greeting", kind: "present", column: "first_name_n", present: "named", absent: "team" })!;
    assert.equal(computeDimension(greet, { first_name_n: "Ann" }), "named");
    assert.equal(computeDimension(greet, { first_name_n: " " }), "team");
    const arm = parseDimension({ name: "arm", kind: "hash_parity", column: "company_domain", even: "scope", odd: "backup" })!;
    assert.equal(computeDimension(arm, { company_domain: "" }), null);
    assert.equal(computeDimension(arm, { company_domain: "Example.com" }), computeDimension(arm, { company_domain: "example.com " }), "same company, same side");
    // ('x' || left(md5('example.com'), 8))::bit(32)::int % 2 in Postgres: md5 starts 5ababd60 → 0x5ababd60 is even.
    assert.equal(md5Parity("example.com"), "even");
    assert.deepEqual(computeDimensions([greet, arm], { first_name_n: "Bo", company_domain: "example.com" }), { greeting: "named", arm: "scope" });
    assert.deepEqual(dimensionSegments([greet, size]), { greeting: ["named", "team"], size: ["under_1k", "over_1k"] });
  });
});
