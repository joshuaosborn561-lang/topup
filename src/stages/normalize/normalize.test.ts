import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCompany } from "./company.js";
import { normalizeLead, type NormalizeRefs } from "./index.js";
import { conversationalLocation, metroKey } from "./location.js";
import { normalizeCity, normalizeFirstName, normalizeState } from "./names.js";
import { assignTeam } from "./team.js";

/** D16 — the normalize rules from design 3.3 F, each one a test. */

const refs: NormalizeRefs = {
  acronyms: new Set(["ACFCU", "IEEE", "AAA"]),
  suffixes: new Set(["inc", "llc", "corp", "corporation", "ltd", "co", "holdings"]),
  metros: new Map([
    [metroKey("Naperville", "IL"), "Chicagoland"],
    [metroKey("Chicago", "IL"), "Chicagoland"],
    [metroKey("Plano", "TX"), "DFW"],
    [metroKey("Cleveland", "OH"), "Cleveland"],
    [metroKey("Portland", "OR"), "Portland"],
    [metroKey("Portland", "ME"), "Portland"],
  ]),
  teams: [
    { team: "Bears", league: "NFL", metro: "Chicagoland", pro: true },
    { team: "Bulls", league: "NBA", metro: "Chicagoland", pro: true },
    { team: "Cowboys", league: "NFL", metro: "DFW", pro: true },
    { team: "Cavaliers", league: "NBA", metro: "Cleveland", pro: true },
    { team: "Trail Blazers", league: "NBA", metro: "Portland", pro: true },
  ],
  ambiguous: new Set(["cavaliers"]),
};

describe("first names (D16)", () => {
  it("title-cases shouting and whispering, leaves McKenzie alone", () => {
    assert.equal(normalizeFirstName("JOHN").value, "John");
    assert.equal(normalizeFirstName("john").value, "John");
    assert.equal(normalizeFirstName("McKenzie").value, "McKenzie");
  });
  it("strips honorifics and credentials, keeps the first given name", () => {
    assert.equal(normalizeFirstName("Dr. John A.").value, "John");
    assert.equal(normalizeFirstName("Mary Ann, MBA").value, "Mary");
    assert.equal(normalizeFirstName("Mary-Ann").value, "Mary-Ann");
  });
  it("a quoted nickname wins", () => {
    assert.equal(normalizeFirstName('Robert "Bob"').value, "Bob");
    assert.equal(normalizeFirstName("Robert (Bob)").value, "Bob");
  });
  it("an initial or nothing usable is null with a flag, never a letter greeting", () => {
    assert.equal(normalizeFirstName("J.").value, null);
    assert.ok(normalizeFirstName("J.").flags.includes("initial_only"));
    assert.equal(normalizeFirstName("").value, null);
    assert.equal(normalizeFirstName("J. Robert").value, "Robert");
  });
  it("pipes are stripped", () => {
    assert.equal(normalizeFirstName("John | Acme").value, "John");
  });
});

describe("cities and states (D16)", () => {
  it("never overwrites the raw city: returns a new cleaned value", () => {
    const raw = "Greater Chicago Area";
    const c = normalizeCity(raw, null);
    assert.equal(c.city, "Chicago");
    assert.equal(raw, "Greater Chicago Area");
  });
  it("splits a state out of the city field and abbreviates full names", () => {
    const c = normalizeCity("Naperville, Illinois", null);
    assert.equal(c.city, "Naperville");
    assert.equal(c.state, "IL");
    assert.equal(normalizeState("texas"), "TX");
    assert.equal(normalizeState("tx"), "TX");
    assert.equal(normalizeState("Narnia"), null);
  });
  it("Ft. becomes Fort and St stays St.", () => {
    assert.equal(normalizeCity("Ft Worth", "TX").city, "Fort Worth");
    assert.equal(normalizeCity("st louis", "MO").city, "St. Louis");
  });
});

describe("company names (D16)", () => {
  it("strips pipes, taglines, parentheticals and legal suffixes", () => {
    assert.equal(normalizeCompany("Acme | IT Services for SMBs", refs).value, "Acme");
    assert.equal(normalizeCompany("Acme Holdings, Inc.", refs).value, "Acme");
    assert.equal(normalizeCompany("Acme (formerly Beta) LLC", refs).value, "Acme");
    assert.equal(normalizeCompany("Acme - Managed IT", refs).value, "Acme");
  });
  it("ALL CAPS words are title-cased unless they are a listed acronym or have no vowel", () => {
    assert.equal(normalizeCompany("ACFCU", refs).value, "ACFCU", "vowel acronyms from the ref list stay upper");
    assert.equal(normalizeCompany("XYZ Networks", refs).value, "XYZ Networks");
    assert.equal(normalizeCompany("SUNRISE DENTAL", refs).value, "Sunrise Dental");
    assert.equal(normalizeCompany("IEEE Computer Society", refs).value, "IEEE Computer Society");
  });
  it("never truncates mid-word; long names are flagged instead", () => {
    const long = "Northwestern Mutual Life Insurance Company of the Greater Midwest";
    const r = normalizeCompany(long, refs);
    assert.ok(r.value!.length > 40);
    assert.ok(r.flags.includes("long_name"));
    assert.ok(long.startsWith(r.value!.split(" ")[0]));
  });
  it("a bare acronym is flagged for a QA hold", () => {
    assert.ok(normalizeCompany("ACFCU", refs).flags.includes("acronym"));
  });
  it("missing is null with a flag", () => {
    assert.deepEqual(normalizeCompany(null, refs), { value: null, flags: ["missing"] });
  });
});

describe("conversational location (D16)", () => {
  it("a metro hit is the answer", () => {
    assert.equal(conversationalLocation("Naperville", "IL", refs).location, "Chicagoland");
    assert.equal(conversationalLocation("Naperville, IL", null, refs).location, "Chicagoland");
  });
  it("no hit but a city: the cleaned city", () => {
    const r = conversationalLocation("Peoria", "IL", refs);
    assert.equal(r.location, "Peoria");
    assert.ok(r.flags.includes("no_metro_ref"));
  });
  it("NO_GEOCODE / no city: blank, never a broken sentence", () => {
    const r = conversationalLocation(null, "IL", refs);
    assert.equal(r.location, "");
    assert.ok(r.flags.includes("no_geocode"));
  });
  it("a city with no state only matches when exactly one state has it", () => {
    assert.equal(conversationalLocation("Naperville", null, refs).location, "Chicagoland");
    assert.equal(conversationalLocation("Portland", null, refs).metro, null, "Portland OR vs ME is ambiguous");
  });
});

describe("sports team (D16)", () => {
  it("NFL first, then NBA", () => {
    assert.equal(assignTeam("Chicagoland", refs, { league: "all", pro_only: false }).team, "Bears");
    assert.equal(assignTeam("Chicagoland", refs, { league: "nba", pro_only: false }).team, "Bulls");
    assert.equal(assignTeam("Chicagoland", refs, { league: "both", pro_only: false }).team, "Bears");
  });
  it("an ambiguous nickname yields no team and the AirPods tier", () => {
    const r = assignTeam("Cleveland", refs, { league: "all", pro_only: false });
    assert.equal(r.team, null);
    assert.equal(r.gift, "airpods");
    assert.ok(r.flags.includes("ambiguous_nickname"));
  });
  it("no metro or no team: AirPods", () => {
    assert.equal(assignTeam(null, refs, { league: "all", pro_only: false }).gift, "airpods");
    assert.equal(assignTeam("Peoria", refs, { league: "all", pro_only: false }).gift, "airpods");
  });
});

describe("normalizeLead (D16)", () => {
  it("produces the four merge fields and flags without touching raw values", () => {
    const lead = { id: "1", first_name: "JOHN", company_name: "Acme Holdings, Inc.", city: "Naperville", state: "IL" };
    const out = normalizeLead(lead, refs, { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } });
    assert.equal(out.first_name_n, "John");
    assert.equal(out.company_n, "Acme");
    assert.equal(out.location, "Chicagoland");
    assert.equal(out.local_sports_team, "Bears");
    assert.equal(out.gift_tier, "team");
    assert.equal(lead.first_name, "JOHN");
    assert.equal(lead.city, "Naperville");
  });
  it("a disabled step passes the raw value through", () => {
    const out = normalizeLead({ id: "1", first_name: "JOHN", company_name: "ACME INC", city: null, state: null }, refs, { names_cities: false, company: false, location: false, sports_team: null });
    assert.equal(out.first_name_n, "JOHN");
    assert.equal(out.company_n, "ACME INC");
    assert.equal(out.local_sports_team, null);
    assert.equal(out.gift_tier, "airpods");
  });
});
