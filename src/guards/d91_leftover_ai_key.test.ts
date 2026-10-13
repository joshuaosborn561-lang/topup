import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D91 — leftover AI key is the definer function. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D91 — leftover AI key path", () => {
  it("CANON names the definer and forbids a vault SELECT", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D(91|92|[9][3-9]|[0-9]{3,})\*\*/, "D91: fold into CANON. Ask Josh.");
    assert.match(canon, /jev_openrouter_key/, "D91: the definer is on the page. Ask Josh.");
    assert.match(canon, /never SELECTs `vault\.decrypted_secrets`/, "D91. Ask Josh.");
    assert.match(canon, /not granted on schema vault/, "D91. Ask Josh.");
  });

  it("the client calls the definer and never SELECTs vault", async () => {
    const client = await readFile(new URL("src/clients/jevClassify.ts", root), "utf8");
    assert.match(client, /topup\.jev_openrouter_key\(\)/, "D91: load the key via the definer. Ask Josh.");
    assert.doesNotMatch(client, /from vault\.decrypted_secrets/, "D91: no direct vault SELECT. Ask Josh.");
    const mig = await readFile(new URL("supabase/migrations/0026_d91_jev_openrouter_key.sql", root), "utf8");
    assert.match(mig, /security definer/, "D91. Ask Josh.");
    assert.match(mig, /grant execute on function topup\.jev_openrouter_key\(\) to leadtopup_app/, "D91. Ask Josh.");
    assert.match(mig, /revoke usage on schema vault from leadtopup_app/, "D91. Ask Josh.");
    assert.doesNotMatch(mig, /grant usage on schema vault/, "D91: never grant vault to the app. Ask Josh.");
  });
});
