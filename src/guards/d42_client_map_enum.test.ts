import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CLIENT_MAP_TAGS_SQL, clientTagSchema, loadClientTags } from "../mcp/recipe.js";

/** D42 — client_tag enum is topup.client_map, not a hardcoded twelve. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D42 — client_tag comes from topup.client_map", () => {
  it("CANON and the ledger name the live map — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const recipe = await readFile(new URL("src/mcp/recipe.ts", root), "utf8");
    const server = await readFile(new URL("src/mcp/server.ts", root), "utf8");
    const boot = await readFile(new URL("src/index.ts", root), "utf8");
    assert.match(canon, /Canon as of \*\*D42\*\*/);
    assert.match(canon, /topup\.client_map/);
    assert.match(canon, /not a service bump/);
    assert.match(ledger, /## D42 — client_tag comes from topup\.client_map/);
    assert.match(ledger, /hardcoded twelve/);
    assert.match(readme, /topup\.client_map/);
    assert.equal(CLIENT_MAP_TAGS_SQL, "select client_tag from topup.client_map order by 1");
    assert.ok(!recipe.includes("salesglider"), "D42: do not hardcode the twelve client tags. Ask Josh.");
    assert.match(server, /loadClientTags/);
    assert.match(server, /clientTagSchema/);
    assert.match(boot, /loadClientTags/);
  });

  it("a tag that is only in client_map is accepted — Ask Josh", async () => {
    const db = {
      query: async () => ({ rows: [{ client_tag: "deep_roots" }, { client_tag: "vector_energy" }] }),
    };
    const tags = await loadClientTags(db);
    const schema = clientTagSchema(tags);
    assert.equal(schema.parse("deep_roots"), "deep_roots");
    assert.equal(schema.parse("vector_energy"), "vector_energy");
    assert.throws(() => schema.parse("not_a_client"), /Invalid enum value|invalid_enum/);
  });
});
