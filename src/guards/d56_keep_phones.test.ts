import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PHONE_HEADER_MAP } from "../stages/ingest/index.js";
import { LEAD_FIELD_KEYS } from "../lib/log.js";

/**
 * D56 — phones are kept. Every lane table and the staging table carry a
 * phone column; every step that can find a phone writes it there; the
 * stage carries it to Smartlead's phone_number. Nothing drops one. Ask
 * Josh before any of that changes.
 */

const root = new URL("../../", import.meta.url);

describe("D56 — phones are kept", () => {
  it("the lane tables and staging carry phone columns, installed at boot", async () => {
    const m = await readFile(new URL("supabase/migrations/0018_keep_phones.sql", root), "utf8");
    for (const c of ["phone text", "phone_type text", "wf_phone text", "wf_phone_type text"]) assert.ok(m.includes(`add column if not exists ${c}`), `D56: ensure_lead_columns adds ${c}`);
    assert.match(m, /alter table public\.leads_staging[\s\S]*add column if not exists phone text/, "D56: leads_staging carries phone");
    assert.match(m, /select topup\.install_lead_locks\(\)/, "D56: the installer runs so current tables get the columns");
  });

  it("ingest maps vendor phone headers, the waterfall steps keep what they find, the stage carries it", async () => {
    assert.equal(PHONE_HEADER_MAP.mobile_phone, "phone", "D56: getleads exports mobile_phone");
    const ingest = await readFile(new URL("src/stages/ingest/index.ts", root), "utf8");
    assert.match(ingest, /column_map: PHONE_HEADER_MAP/, "D56: ingest passes the phone header map to LeadPipe");
    assert.match(ingest, /with_phone/, "D56: ingest counts phones that landed");
    for (const f of ["src/stages/find_emails/index.ts", "src/stages/puzzle/index.ts"]) {
      const src = await readFile(new URL(f, root), "utf8");
      assert.match(src, /keepPhones\(/, `D56: ${f} keeps the phones the waterfall wrote back`);
    }
    const puzzle = await readFile(new URL("src/stages/puzzle/index.ts", root), "utf8");
    assert.match(puzzle, /cellphone/, "D56: the people waterfall's cellphone travels with the name");
    const stage = await readFile(new URL("src/stages/stage/index.ts", root), "utf8");
    assert.match(stage, /\["phone", lane\.has\("phone"\)/, "D56: staging gets the phone");
    assert.match(stage, /with_phone/, "D56: the stage counts phones staged");
    const common = await readFile(new URL("src/stages/common.ts", root), "utf8");
    assert.doesNotMatch(common, /set phone = null|phone = ''/, "D56: nothing blanks a phone");
  });

  it("phones never reach a log, and leftovers shows the phone gap", async () => {
    for (const k of ["phone", "cellphone", "wf_phone"]) assert.ok(LEAD_FIELD_KEYS.has(k), `D2/D56: ${k} is redacted in logs`);
    const left = await readFile(new URL("src/canon/leftovers.ts", root), "utf8");
    assert.match(left, /need_phone/, "D56: leftovers names rows that have a person but no phone");
    assert.match(left, /phone_column/, "D56: leftovers says when a store cannot hold a phone");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /phone/i, "D56: CANON.md says phones are kept");
  });
});
