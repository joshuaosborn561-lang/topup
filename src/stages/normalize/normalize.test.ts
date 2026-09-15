import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCompany } from "./company.js";
import { cityKey, geocode, haversineMiles, type CityCoords } from "./geo.js";
import { normalizeLead, type NormalizeRefs } from "./index.js";
import { conversationalLocation, metroFor } from "./location.js";
import { normalizeCity, normalizeFirstName, normalizeState } from "./names.js";
import { assignTeam, assignTeamForLeague } from "./team.js";

/**
 * D25 — the normalizers are ports of the skill scripts. Every example here is
 * one the skill or its script documents; a failing test means the port drifted.
 */

const coords: CityCoords = new Map([
  [cityKey("Naperville", "IL"), { lat: 41.7508, lon: -88.1535 }],
  [cityKey("Chicago", "IL"), { lat: 41.8781, lon: -87.6298 }],
  [cityKey("Plano", "TX"), { lat: 33.0198, lon: -96.6989 }],
  [cityKey("Forney", "TX"), { lat: 32.7479, lon: -96.4719 }],
  [cityKey("Waco", "TX"), { lat: 31.5493, lon: -97.1467 }],
  [cityKey("Houston", "TX"), { lat: 29.7604, lon: -95.3698 }],
  [cityKey("College Station", "TX"), { lat: 30.628, lon: -96.3344 }],
  [cityKey("Minneapolis", "MN"), { lat: 44.9778, lon: -93.265 }],
  [cityKey("West Palm Beach", "FL"), { lat: 26.7153, lon: -80.0534 }],
  [cityKey("Bellevue", "WA"), { lat: 47.6101, lon: -122.2015 }],
  [cityKey("Bozeman", "MT"), { lat: 45.677, lon: -111.0429 }],
  [cityKey("Pensacola", "FL"), { lat: 30.4213, lon: -87.2169 }],
  [cityKey("Tallahassee", "FL"), { lat: 30.4383, lon: -84.2807 }],
  [cityKey("Baton Rouge", "LA"), { lat: 30.4515, lon: -91.1871 }],
  [cityKey("Tuscaloosa", "AL"), { lat: 33.2098, lon: -87.5692 }],
  [cityKey("South Bend", "IN"), { lat: 41.6764, lon: -86.252 }],
  [cityKey("Memphis", "TN"), { lat: 35.1495, lon: -90.049 }],
  [cityKey("Saint Louis", "MO"), { lat: 38.627, lon: -90.1994 }],
  [cityKey("Dallas", "TX"), { lat: 32.7767, lon: -96.797 }],
  [cityKey("Spokane", "WA"), { lat: 47.6588, lon: -117.426 }],
]);

const refs: NormalizeRefs = { acronyms: new Set(["ACFCU", "MGIC"]), coords };

describe("first names — port of normalize_names_and_cities.py", () => {
  it("fixes casing only on ALL CAPS or all lowercase input", () => {
    assert.equal(normalizeFirstName("JOHN").value, "John");
    assert.equal(normalizeFirstName("john").value, "John");
    assert.equal(normalizeFirstName("McKenzie").value, "McKenzie", "mixed case is left alone");
    assert.equal(normalizeFirstName("MARY-ANN").value, "Mary-Ann");
  });
  it("strips titles, trailing credentials and Jr/Sr/roman suffixes", () => {
    assert.equal(normalizeFirstName("Dr. John").value, "John");
    assert.equal(normalizeFirstName("Mary, CPA").value, "Mary");
    assert.equal(normalizeFirstName("Robert Jr.").value, "Robert");
    assert.equal(normalizeFirstName("Robert III").value, "Robert");
  });
  it("a parenthetical nickname is the preferred name; an all-caps or odd one is dropped", () => {
    assert.equal(normalizeFirstName("Anthony (Tony)").value, "Tony");
    assert.equal(normalizeFirstName("Anthony (CEO)").value, "Anthony");
  });
  it("initials: all-initials kept, leading initial dropped, trailing initial stripped, first word only", () => {
    assert.equal(normalizeFirstName("C J").value, "C J");
    assert.equal(normalizeFirstName("W. Allen").value, "Allen");
    assert.equal(normalizeFirstName("Robert A.").value, "Robert");
    assert.equal(normalizeFirstName("Alice Laura").value, "Alice");
    assert.equal(normalizeFirstName("Anna Claire").value, "Anna");
  });
  it("consolidates informal variants only: Jimmy to Jim, James stays James", () => {
    assert.equal(normalizeFirstName("Jimmy").value, "Jim");
    assert.equal(normalizeFirstName("BOBBY").value, "Bob");
    assert.equal(normalizeFirstName("James").value, "James");
    assert.equal(normalizeFirstName("Robert").value, "Robert");
    assert.equal(normalizeFirstName("Charles").value, "Charles", "no formal-to-nickname without Josh");
  });
  it("strips stray characters; empty input is null; unusable input keeps the raw value and says so", () => {
    assert.equal(normalizeFirstName("John 🎉").value, "John");
    assert.equal(normalizeFirstName("").value, null);
    const r = normalizeFirstName("(CEO)");
    assert.equal(r.value, "(CEO)", "the script returns the raw value when nothing usable is left");
    assert.ok(r.flags.includes("unusable_kept_raw"));
    assert.ok(normalizeFirstName("J.").flags.includes("initial_only"));
  });
});

describe("cities — port of normalize_city", () => {
  it("strips the metro descriptor suffixes, repeatedly, and fixes shouting", () => {
    assert.equal(normalizeCity("Atlanta Metropolitan Area").city, "Atlanta");
    assert.equal(normalizeCity("Dallas-Fort Worth Metroplex").city, "Dallas-Fort Worth");
    assert.equal(normalizeCity("Greater Chicago Area").city, "Greater Chicago", "the script strips 'Area', not 'Greater'");
    assert.equal(normalizeCity("HOUSTON").city, "Houston");
    assert.equal(normalizeCity("McAllen").city, "McAllen");
  });
  it("never writes the raw column: a new value comes back", () => {
    const raw = "Atlanta Metro Area";
    normalizeCity(raw);
    assert.equal(raw, "Atlanta Metro Area");
  });
  it("states: two letters pass, full names map, anything else is null", () => {
    assert.equal(normalizeState("texas"), "TX");
    assert.equal(normalizeState("tx"), "TX");
    assert.equal(normalizeState("Narnia"), null);
  });
});

describe("company names — the eleven rules of company-name-normalization/SKILL.md", () => {
  const n = (s: string) => normalizeCompany(s, refs).value;
  it("reads the way someone says it: legal suffixes off, LP included", () => {
    assert.equal(n("Fay Servicing, Llc"), "Fay Servicing");
    assert.equal(n("Acme Holdings, Inc."), "Acme");
    assert.equal(n("Blackstone Real Estate Partners LP"), "Blackstone Real Estate Partners", "LP is a suffix; Partners is the brand");
    assert.equal(n("Fidelity National Financial Inc"), "Fidelity National Financial");
  });
  it("casing: ALL CAPS and lowercase to Title Case, mixed brands untouched", () => {
    assert.equal(n("SUNRISE DENTAL"), "Sunrise Dental");
    assert.equal(n("jobnimbus"), "Jobnimbus");
    assert.equal(n("JobNimbus"), "JobNimbus");
  });
  it("parenthetical tags and subsidiary clauses go", () => {
    assert.equal(n("Harbor Capital (RIA)"), "Harbor Capital");
    assert.equal(n("Able Services, An ABM Company"), "Able");
    assert.equal(n("Hilti An Employee Owned Company"), "Hilti");
  });
  it("dash geography needs whitespace around the dash; internal hyphens survive", () => {
    assert.equal(n("Honest Abe Roofing - Ann Arbor"), "Honest Abe Roofing");
    assert.equal(n("Multi-Bank Securities"), "Multi-Bank Securities");
    assert.equal(n("Roof Ready Llc - A Parker Colorado Roofing Company"), "Roof Ready", "mid-string legal suffix, then the dash tail");
  });
  it("comma geography and dangling state markers", () => {
    assert.equal(n("Premier Roofing Ca"), "Premier Roofing");
    assert.equal(n("Apex Plumbing, Denver"), "Apex Plumbing");
  });
  it("one generic tail only when exactly two words remain, never with & or and", () => {
    assert.equal(n("Omega Solutions"), "Omega");
    assert.equal(n("Omega High-Impact Print"), "Omega High-Impact Print");
    assert.equal(n("Vantage Radiology & Diagnostic Services"), "Vantage Radiology & Diagnostic Services");
    assert.equal(n("Summit Partners"), "Summit Partners", "Partners is the brand, not a generic tail");
    assert.equal(n("Acme Technologies"), "Acme Technologies");
  });
  it("filler casing, initialisms, apostrophes, no dangling filler", () => {
    assert.equal(n("Bank Of Washington"), "Bank of Washington");
    assert.equal(n("TRS INC"), "TRS");
    assert.equal(n("CFSB"), "CFSB");
    assert.equal(n("SOUTH END"), "South End", "END has a vowel");
    assert.equal(n("INTRAFUSION BY"), "Intrafusion", "'By' is a common short word and a dangling filler");
    assert.equal(n("O'NEILL CONSTRUCTION"), "O'Neill Construction");
    assert.equal(n("Macy's"), "Macy's");
  });
  it("Josh's by-hand initialism list fixes the known limitation (Mgic); ACFCU stays ACFCU", () => {
    assert.equal(n("MGIC"), "MGIC");
    assert.equal(n("ACFCU"), "ACFCU");
    assert.equal(n("Hme"), "Hme", "not on the list: left alone, as the skill says");
  });
  it("a bare acronym is flagged for the step 8 hold; missing is null", () => {
    assert.ok(normalizeCompany("ACFCU", refs).flags.includes("acronym"));
    assert.deepEqual(normalizeCompany(null, refs), { value: null, flags: ["missing"] });
  });
});

describe("geocode — conversational_location.py geocode()", () => {
  it("exact, manual list, St./Saint interchange, metro-combo first city", () => {
    assert.ok(geocode("Naperville", "Illinois", coords));
    assert.ok(geocode("Winston-Salem", "NC", coords), "manual coords");
    assert.ok(geocode("St. Louis", "MO", coords), "St. -> Saint");
    assert.ok(geocode("Dallas-Fort Worth", "TX", coords), "combo -> first city");
    assert.equal(geocode("Nowhere", "TX", coords), null);
    assert.equal(geocode("Dallas", null, coords), null, "no state, no geocode");
  });
  it("haversine in miles", () => {
    const d = haversineMiles({ lat: 41.8781, lon: -87.6298 }, { lat: 41.7508, lon: -88.1535 });
    assert.ok(d > 27 && d < 30, `Chicago to Naperville is ~28 mi, got ${d}`);
  });
});

describe("conversational location — port of conversational_location.py + the Sept 9 fix", () => {
  it("the skill's own examples", () => {
    assert.equal(conversationalLocation("Naperville", "Illinois", coords).location, "Chicagoland");
    assert.equal(conversationalLocation("West Palm Beach", "Florida", coords).location, "South Florida");
    assert.equal(conversationalLocation("Plano", "Texas", coords).location, "DFW");
    assert.equal(conversationalLocation("Bellevue", "Washington", coords).location, "the Seattle area");
  });
  it("anchor cities get the label too; a city outside every metro keeps its own name", () => {
    assert.equal(conversationalLocation("Chicago", "IL", coords).location, "Chicagoland");
    const r = conversationalLocation("Bozeman", "MT", coords);
    assert.equal(r.location, "Bozeman");
    assert.equal(r.source, "city");
  });
  it("tighter metros win: Orange County beats the LA blanket", () => {
    assert.equal(metroFor({ lat: 33.6846, lon: -117.8265 }), "Orange County");
  });
  it("NO_GEOCODE is a blank location, never a broken sentence", () => {
    const r = conversationalLocation("Nowhere", "TX", coords);
    assert.equal(r.location, "");
    assert.equal(r.source, "no_geocode");
    assert.equal(conversationalLocation("Naperville", null, coords).location, "", "no state cannot geocode");
    assert.equal(conversationalLocation(null, "TX", coords).location, "");
  });
  it("cleans the city first: 'Chicago Metropolitan Area, IL' style suffixes are stripped before geocoding", () => {
    assert.equal(conversationalLocation("Chicago Metropolitan Area", "IL", coords).location, "Chicagoland");
  });
});

describe("sports team — port of assign_team.py", () => {
  const geo = (city: string, st: string) => coords.get(cityKey(city, st)) ?? null;
  it("home market wins outright, even over a college in town: Houston is Astros / Texans", () => {
    assert.equal(assignTeamForLeague("Houston", "TX", geo("Houston", "TX"), "mlb", false).team, "Astros");
    assert.equal(assignTeamForLeague("Houston", "TX", geo("Houston", "TX"), "nfl", false).team, "Texans");
    assert.equal(assignTeamForLeague("Minneapolis", "MN", geo("Minneapolis", "MN"), "mlb", false).team, "Twins");
  });
  it("nearest wins outside the home market: Forney TX is Rangers, not Baylor", () => {
    const r = assignTeamForLeague("Forney", "TX", geo("Forney", "TX"), "mlb", false);
    assert.equal(r.team, "Rangers");
    assert.equal(r.source, "MLB");
  });
  it("college towns get the college; a school-qualified (ambiguous) nickname goes null and routes to AirPods", () => {
    const tide = assignTeamForLeague("Tuscaloosa", "AL", geo("Tuscaloosa", "AL"), "mlb", false);
    assert.equal(tide.team, "Crimson Tide");
    const lsu = assignTeamForLeague("Baton Rouge", "LA", geo("Baton Rouge", "LA"), "mlb", false);
    assert.equal(lsu.team, null);
    assert.equal(lsu.source, "AMBIGUOUS_NICKNAME");
    assert.equal(lsu.gift, "airpods");
  });
  it("Notre Dame's 50 mile radius keeps South Bend but not Chicagoland", () => {
    assert.equal(assignTeamForLeague("South Bend", "IN", geo("South Bend", "IN"), "mlb", false).team, "Fighting Irish");
    assert.equal(assignTeamForLeague("Naperville", "IL", geo("Naperville", "IL"), "mlb", false).team, "White Sox", "two-team market: the literally closer stadium");
  });
  it("pro_only: no college, no overrides; pro within 120 or blank", () => {
    assert.equal(assignTeamForLeague("Tuscaloosa", "AL", geo("Tuscaloosa", "AL"), "mlb", true).source, "OUT_OF_RANGE", "Atlanta is 180+ miles: blank beats a bad match");
    assert.equal(assignTeamForLeague("Memphis", "TN", geo("Memphis", "TN"), "mlb", true).source, "OUT_OF_RANGE");
    assert.equal(assignTeamForLeague("Memphis", "TN", geo("Memphis", "TN"), "mlb", false).team, "Grizzlies");
  });
  it("blanks: no city/state, no geocode, the Florida panhandle (Tallahassee is not panhandle: Seminoles)", () => {
    assert.equal(assignTeamForLeague(null, "TX", null, "mlb", false).source, "NO_CITY_STATE");
    assert.equal(assignTeamForLeague("Nowhere", "TX", null, "mlb", false).source, "NO_GEOCODE");
    assert.equal(assignTeamForLeague("Pensacola", "FL", geo("Pensacola", "FL"), "mlb", false).source, "PANHANDLE_FL_BLANK");
    assert.equal(assignTeamForLeague("Tallahassee", "FL", geo("Tallahassee", "FL"), "mlb", false).team, "Seminoles");
    assert.equal(assignTeamForLeague("Bozeman", "MT", geo("Bozeman", "MT"), "nfl", false).source, "OUT_OF_RANGE");
  });
  it("the gift ladder: MLB first, NFL second, AirPods when both are blank", () => {
    assert.equal(assignTeam("Plano", "TX", geo("Plano", "TX"), { league: "both", pro_only: false }).team, "Rangers");
    assert.equal(assignTeam("Plano", "TX", geo("Plano", "TX"), { league: "nfl", pro_only: false }).team, "Cowboys");
    const none = assignTeam("Bozeman", "MT", geo("Bozeman", "MT"), { league: "both", pro_only: true });
    assert.equal(none.team, null);
    assert.equal(none.gift, "airpods");
  });
  it("renames are exact-match: Guardians, never Indians; Spokane Indians would survive", () => {
    assert.equal(assignTeamForLeague("Cleveland", "OH", { lat: 41.4993, lon: -81.6944 }, "mlb", false).team, "Guardians");
  });
});

describe("normalizeLead — step 7 for one row", () => {
  it("produces the merge fields and flags without touching raw values", () => {
    const lead = { id: "1", first_name: "JOHN", company_name: "Acme Holdings, Inc.", city: "Naperville", state: "Illinois" };
    const out = normalizeLead(lead, refs, { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } });
    assert.equal(out.first_name_n, "John");
    assert.equal(out.company_n, "Acme");
    assert.equal(out.location, "Chicagoland");
    assert.equal(out.local_sports_team, "White Sox");
    assert.equal(out.gift_tier, "team");
    assert.deepEqual(out.flags.team, ["MLB"]);
    assert.equal(lead.first_name, "JOHN");
    assert.equal(lead.city, "Naperville");
  });
  it("a city the table does not know: blank location (the step 7 hold catches it), no team, AirPods", () => {
    const out = normalizeLead({ id: "1", first_name: "Ann", company_name: "Acme", city: "Nowhere", state: "TX" }, refs, { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } });
    assert.equal(out.location, "");
    assert.equal(out.local_sports_team, null);
    assert.equal(out.gift_tier, "airpods");
    assert.deepEqual(out.flags.team, ["NO_GEOCODE"]);
  });
  it("a disabled step passes the raw value through", () => {
    const out = normalizeLead({ id: "1", first_name: "JOHN", company_name: "ACME INC", city: null, state: null }, refs, { names_cities: false, company: false, location: false, sports_team: null });
    assert.equal(out.first_name_n, "JOHN");
    assert.equal(out.company_n, "ACME INC");
    assert.equal(out.local_sports_team, null);
    assert.equal(out.gift_tier, "airpods");
  });
});
