import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { MCP_TOOL_ROLE, roleForToken } from "../mcp/server.js";
import { CHOICE_ROLE, COMMAND_ROLE, Roles } from "./roles.js";
import { slackSignatureValid } from "./signature.js";

/** D2 / D9 — owner and operator by id; operator taps never spend or change a recipe. */

describe("roles", () => {
  const roles = new Roles(["U_JOSH"], ["U_CAYDEN"]);

  it("resolves by Slack user id and nobody else", () => {
    assert.equal(roles.roleOf("U_JOSH"), "owner");
    assert.equal(roles.roleOf("U_CAYDEN"), "operator");
    assert.equal(roles.roleOf("U_STRANGER"), null);
    assert.equal(roles.roleOf(undefined), null);
  });

  it("owner may do everything; operator only operator-level; strangers nothing", () => {
    assert.equal(Roles.allows("owner", "owner"), true);
    assert.equal(Roles.allows("owner", "operator"), true);
    assert.equal(Roles.allows("operator", "operator"), true);
    assert.equal(Roles.allows("operator", "owner"), false);
    assert.equal(Roles.allows(null, "operator"), false);
  });

  it("D9 — every choice that spends or changes a recipe is owner-only", () => {
    for (const c of ["approve_spend", "decline_spend", "split", "topup_anyway", "leave_it", "approve_segment", "decline_segment", "clone_campaign"]) {
      assert.equal(CHOICE_ROLE[c], "owner", `${c} must need Josh`);
    }
    for (const c of ["resume", "abort", "accept", "purge", "reroute", "resume_run"]) assert.equal(CHOICE_ROLE[c], "operator", `${c} is operator-level`);
    assert.equal(COMMAND_ROLE["/working"], "owner");
    for (const c of ["/topup", "/holds", "/runs", "/suppress"]) assert.equal(COMMAND_ROLE[c], "operator");
  });

  it("MCP: the operator token gets the narrow set", () => {
    const operatorTools = Object.entries(MCP_TOOL_ROLE).filter(([, r]) => r === "operator").map(([t]) => t).sort();
    assert.deepEqual(operatorTools, ["list_holds", "list_runs", "resolve_hold", "run_status", "start_topup"]);
    for (const t of ["sample_rows", "variant_stats", "campaign_registry", "recipe_get", "missing_piece_groups"]) assert.equal(MCP_TOOL_ROLE[t], "owner");
    const d = { ownerToken: "owner-tok-1", operatorToken: "operator-tok-2" };
    assert.equal(roleForToken(`Bearer ${d.ownerToken}`, d), "owner");
    assert.equal(roleForToken(`Bearer ${d.operatorToken}`, d), "operator");
    assert.equal(roleForToken("Bearer nope", d), null);
    assert.equal(roleForToken(undefined, d), null);
    assert.equal(roleForToken("Bearer ", { ownerToken: "", operatorToken: "" }), null, "an empty configured token never matches");
  });
});

describe("slack signature", () => {
  const secret = "signing-secret";
  const body = "command=%2Ftopup&text=parlay+it_dm";
  const now = 1_700_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;

  it("accepts a fresh, correctly signed request", () => {
    assert.equal(slackSignatureValid(secret, body, ts, sig, now), true);
  });
  it("rejects a bad signature, a stale timestamp, and missing headers", () => {
    assert.equal(slackSignatureValid(secret, body + "x", ts, sig, now), false);
    assert.equal(slackSignatureValid(secret, body, ts, sig, now + 6 * 60_000), false);
    assert.equal(slackSignatureValid(secret, body, undefined, sig, now), false);
    assert.equal(slackSignatureValid("", body, ts, sig, now), false);
  });
});
