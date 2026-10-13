import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectorsCheck, connectorSpecs, CONNECTORS_RULE } from "./connectors.js";

/** D99 — the session starts with the connectors check; a missing required one stops the top-up. */
describe("D99 — connectors", () => {
  it("names what is missing and how to attach it, with the custom MCPs' Railway addresses", () => {
    const a = connectorsCheck(["Supabase", "mcp__Context_Saver__lp_run", "getleads", "Top Up"], { smartlead: "https://smartlead.example.invalid/mcp" });
    assert.equal(a.ok, false);
    assert.deepEqual(a.missing_required.map((m) => m.name), ["Smartlead", "Email_Verifier_Progression"]);
    assert.match(a.missing_required[0]!.how, /https:\/\/smartlead\.example\.invalid\/mcp/);
    assert.ok(a.missing_optional.some((m) => m.name === "AI_Ark"));
    assert.equal(a.rule, CONNECTORS_RULE);
    assert.match(CONNECTORS_RULE, /LeadPipe/);
  });

  it("is satisfied when every required connector is present, whatever the spelling", () => {
    const a = connectorsCheck(["top_up", "supabase", "context-saver", "GetLeads", "SMARTLEAD", "Email Verifier Progression"]);
    assert.equal(a.ok, true);
    assert.deepEqual(a.missing_required, []);
    assert.equal(connectorSpecs().filter((s) => s.required === "always").length, 6);
  });
});
