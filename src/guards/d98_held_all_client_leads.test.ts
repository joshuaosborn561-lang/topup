import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D98 — held is every lead this client already has. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D98 — held is every client lead", () => {
  it("CANON and the ledger name the all-held join", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D98\*\*/, "D98: fold into CANON. Ask Josh or Cayden.");
    assert.match(
      canon,
      /every lead this client already has|EVERY lead this client already has/,
      "D98: held is every client lead, not only suppressions. Ask Josh or Cayden.",
    );
    assert.match(canon, /LinkedIn URL or normalized name\+company/, "D98: no-email match. Ask Josh or Cayden.");
    assert.match(canon, /has.email|needs.enrich/, "D98: net new splits has-email vs needs-enrich. Ask Josh or Cayden.");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D98 \|/m, "D98 index row. Ask Josh or Cayden.");
    assert.match(ledger, /^## D98 — /m, "D98 entry. Ask Josh or Cayden.");
  });

  it("held loads the client lead stores and identifier columns", async () => {
    const held = await readFile(new URL("src/canon/held.ts", root), "utf8");
    const keys = await readFile(new URL("src/canon/heldKeys.ts", root), "utf8");
    assert.match(keys, /loadHeldKeys/, "D98: held keys are loaded generically. Ask Josh or Cayden.");
    assert.match(keys, /lead_provenance/, "D98: provenance is in the held set. Ask Josh or Cayden.");
    assert.match(keys, /leads_staging/, "D98: staging is in the held set. Ask Josh or Cayden.");
    assert.match(keys, /linkedin/, "D98: LinkedIn is a match key. Ask Josh or Cayden.");
    assert.match(keys, /normalizeNameCompany/, "D98: name+company is a match key. Ask Josh or Cayden.");
    assert.match(keys, /discoverStores/, "D98: client stores are discovered, not hardcoded. Ask Josh or Cayden.");
    assert.match(held, /has_email/, "D98: held reports has_email. Ask Josh or Cayden.");
    assert.match(held, /needs_enrich/, "D98: held reports needs_enrich. Ask Josh or Cayden.");
    assert.match(held, /HELD_EXPORT_COLUMNS/, "D98: the pool export carries identifier columns. Ask Josh or Cayden.");
    assert.doesNotMatch(held, /columns: \["email"\]/, "D97/D98: email is gone from the GetLeads catalog. Ask Josh or Cayden.");
    assert.doesNotMatch(held, /search_contacts/, "D97: held never pages the paid search. Ask Josh or Cayden.");
    assert.match(
      keys,
      /maps_raw/,
      "D98: maps_raw is named so the scrape pool is skipped, not treated as held. Ask Josh or Cayden.",
    );
  });
});
