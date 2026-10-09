import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leftoversRead } from "./leftovers.js";

/** D55 — leftovers: where past pulls left rows, as counts. Never a row, never a value. Ask Josh. */

function fakeDb() {
  const seen: string[] = [];
  const db = {
    seen,
    query: async (text: string, params?: unknown[]) => {
      seen.push(text);
      if (text.includes("from topup.client_map")) return { rows: [{ client_tag: "bcp", smartlead_client_id: "542838" }] };
      if (text.includes("from information_schema.tables")) {
        assert.equal(params?.[0], "bcp");
        return {
          rows: [
            { table_schema: "lp", table_name: "bcp_ingested_leads", n_live_tup: "900" },
            { table_schema: "lp", table_name: "bcp_it_scoped", n_live_tup: "12000" },
            { table_schema: "client_bcp", table_name: "contacts", n_live_tup: "400" },
            { table_schema: "public", table_name: "bcp_wf_contacts", n_live_tup: "50" },
          ],
        };
      }
      if (text.includes("from information_schema.columns")) {
        return {
          rows: [
            { table_schema: "lp", table_name: "bcp_ingested_leads", column_name: "email" },
            { table_schema: "lp", table_name: "bcp_ingested_leads", column_name: "lead_status" },
            { table_schema: "lp", table_name: "bcp_ingested_leads", column_name: "source_label" },
            { table_schema: "client_bcp", table_name: "contacts", column_name: "email" },
            { table_schema: "client_bcp", table_name: "contacts", column_name: "domain" },
            { table_schema: "public", table_name: "bcp_wf_contacts", column_name: "wf_email" },
            { table_schema: "public", table_name: "bcp_wf_contacts", column_name: "wf_status" },
          ],
        };
      }
      if (text.includes("from public.wf_people_status")) return { rows: [{ k: "people_unresolved", n: "7" }] };
      if (text.startsWith("select count(*)::text as n")) return { rows: [{ n: "901", with_email: "880", with_domain: "901" }] };
      if (text.includes("group by 1")) return { rows: [{ k: "needs_verify", n: "600" }, { k: "suppressed", n: "301" }] };
      return { rows: [] };
    },
  };
  return db;
}

describe("D55 — leftovers", () => {
  it("counts the lane table, the client schema, the waterfall tables and the people status; scratch tables are estimates", async () => {
    const db = fakeDb();
    const out = await leftoversRead(db as never, "bcp");
    assert.ok(!("error" in out));
    if ("error" in out) return;
    assert.equal(out.clients.length, 1);
    const stores = out.clients[0]!.stores;
    const lane = stores.find((s) => s.kind === "leadpipe_lane")!;
    assert.equal(lane.rows, 901);
    assert.equal(lane.exact, true);
    assert.equal(lane.with_email, 880);
    assert.deepEqual(lane.by_status, { "lead_status=needs_verify": 600, "lead_status=suppressed": 301 });
    assert.ok(lane.by_label && Object.keys(lane.by_label)[0]?.startsWith("source_label="));
    const wf = stores.find((s) => s.kind === "waterfall")!;
    assert.equal(wf.table, "bcp_wf_contacts");
    assert.equal(wf.with_email, 880);
    assert.ok(stores.find((s) => s.kind === "client_schema" && s.table === "contacts"));
    const scratch = stores.find((s) => s.kind === "scratch")!;
    assert.equal(scratch.rows, 12000);
    assert.equal(scratch.exact, false);
    assert.ok(stores.find((s) => s.kind === "people_status" && s.rows === 7));
    assert.match(out.rule, /never rows/);
    assert.equal(out.not_reachable.length, 3);
    for (const sql of db.seen) assert.doesNotMatch(sql, /select\s+(?!count)[^\n]*\b(email|first_name|last_name|phone|linkedin_url)\b/i, `D2/D55: a leftovers query selects a lead column: ${sql.slice(0, 80)}`);
    assert.ok(!JSON.stringify(out).includes("@"));
  });

  it("refuses an unmapped client", async () => {
    const out = await leftoversRead(fakeDb() as never, "nobody");
    assert.ok("error" in out && /not in topup.client_map/.test(out.error));
  });
});
