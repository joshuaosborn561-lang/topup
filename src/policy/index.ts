/**
 * The policy layer (D46): every top-up rule, evaluated in one place.
 * Import from here; never re-derive a rule from a stage.
 */
export * from "./rules.js";
export * from "./campaign.js";
export * from "./spend.js";
