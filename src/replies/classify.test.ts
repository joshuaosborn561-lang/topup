import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SMARTLEAD_DNC_CATEGORY_ID,
  classifyNegative,
  isNegativeLead,
} from "./classify.js";

/** D81 — text and category first; Smartlead DNC is not a class. Ask Josh. */

describe("D81 — classify negatives", () => {
  it("reads an explicit stop-ask from the reply text", () => {
    assert.deepEqual(classifyNegative({ body: "Please unsubscribe me from this list.", category_id: 4 }), {
      class: "unsubscribe",
      source: "text",
      needs_ai: false,
    });
    assert.deepEqual(classifyNegative({ body: "Take me off your list", category_id: 3 }), {
      class: "unsubscribe",
      source: "text",
      needs_ai: false,
    });
    assert.equal(classifyNegative({ body: "remove me" }).class, "unsubscribe");
  });

  it("reads not-interested from the reply text", () => {
    assert.deepEqual(classifyNegative({ body: "Not interested, thanks.", category_id: 4 }), {
      class: "not_interested",
      source: "text",
      needs_ai: false,
    });
    assert.equal(classifyNegative({ body: "no thanks" }).class, "not_interested");
  });

  it("treats Smartlead Not Interested as not_interested when the text is silent", () => {
    assert.deepEqual(classifyNegative({ category_id: 3, category: "Not Interested" }), {
      class: "not_interested",
      source: "category",
      needs_ai: false,
    });
  });

  it("does not treat Smartlead Do Not Contact as unsubscribe", () => {
    const hit = classifyNegative({ category_id: SMARTLEAD_DNC_CATEGORY_ID, category: "Do Not Contact", body: "" });
    assert.equal(hit.needs_ai, true, "D81: Smartlead DNC is every negative. Ask Josh.");
    assert.equal(hit.class, null);
    assert.equal(isNegativeLead({ category_id: 4 }), true);
  });

  it("treats Smartlead status unsubscribed as unsubscribe", () => {
    assert.deepEqual(classifyNegative({ status: "unsubscribed" }), {
      class: "unsubscribe",
      source: "status",
      needs_ai: false,
    });
  });

  it("prefers a stop-ask in the text over Not Interested category", () => {
    assert.equal(classifyNegative({ body: "unsubscribe please", category_id: 3 }).class, "unsubscribe");
  });
});
