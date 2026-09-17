import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSelectOnly } from "./tools.js";

describe("D39 reasoner tools", () => {
  it("sql_read is select-only on a schema whitelist", () => {
    assert.equal(assertSelectOnly("select count(*) from topup.pull_receipts"), "select count(*) from topup.pull_receipts");
    assert.throws(() => assertSelectOnly("delete from topup.pull_receipts"), /select-only|write/i);
    assert.throws(() => assertSelectOnly("select 1; delete from topup.pull_receipts"), /write/i);
    assert.throws(() => assertSelectOnly("select * from secret.leads"), /schema/i);
  });
});
