import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEFTOVER_CRITERIA,
  LEFTOVER_INSTRUCTIONS,
  leftoverJevBody,
  parseLeftoverChoice,
} from "./leftoverPrompt.js";

/** D90 — fixed leftover prompt. Ask Josh. */

describe("D90 — leftover prompt", () => {
  it("treats an explicit stop or remove as unsubscribe and anything else as not_interested", () => {
    assert.match(LEFTOVER_INSTRUCTIONS, /explicitly asks to stop|be removed|unsubscribed/);
    assert.match(LEFTOVER_INSTRUCTIONS, /not_interested: anything else/);
    assert.match(LEFTOVER_CRITERIA.unsubscribe, /stop or remove/);
    assert.match(LEFTOVER_CRITERIA.not_interested, /Anything else/);
  });

  it("parses Jev's choice and rejects anything else", () => {
    assert.equal(parseLeftoverChoice({ answers: { class: { choice: "unsubscribe" } } }), "unsubscribe");
    assert.equal(parseLeftoverChoice({ answers: { class: { choice: "not_interested" } } }), "not_interested");
    assert.equal(parseLeftoverChoice({ answers: { class: { choice: "do_not_contact" } } }), null);
    assert.equal(parseLeftoverChoice({}), null);
  });

  it("sends the inbound body as state and no other lead fields", () => {
    const body = leftoverJevBody("typesafe/jev-1.13", "please stop");
    assert.equal(body.model, "typesafe/jev-1.13");
    assert.deepEqual(Object.keys(body.state), ["body"]);
    assert.equal(body.questions.class.type, "choice");
  });
});
