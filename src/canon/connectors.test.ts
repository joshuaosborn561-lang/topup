import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectorsCheck, connectorSpecs, CONNECTORS_RULE } from "./connectors.js";

/** D99 — the session starts with the connectors check; a missing required one stops the top-up. */
describe("D99 — connectors", () => {
  it("names what is missing and how to attach it, with the custom MCPs' Railway addresses", () => {
    const a = connectorsCheck(["Supabase", "Top Up"], { smartlead: "https://smartlead.example.invalid/mcp" });
    assert.equal(a.ok, false);
    assert.deepEqual(a.missing_required.map((m) => m.name), ["getleads"]);
    assert.deepEqual(a.handled_by_service.map((m) => m.name), ["Context_Saver", "Smartlead", "Email_Verifier_Progression"], "D99: the service calls these itself; the bot attaches nothing for them");
    assert.ok(a.missing_optional.some((m) => m.name === "AI_Ark"));
    assert.equal(a.rule, CONNECTORS_RULE);
    assert.match(CONNECTORS_RULE, /LeadPipe/);
  });

  it("is satisfied when every required connector is present, whatever the spelling", () => {
    const a = connectorsCheck(["top_up", "supabase", "GetLeads"]);
    assert.equal(a.ok, true);
    assert.deepEqual(a.missing_required, []);
    assert.equal(connectorSpecs().filter((s) => s.required === "always").length, 3);
  });
});
