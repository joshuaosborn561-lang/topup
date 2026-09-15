import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D4 — never call a vendor in a test; mock it and assert on the ledger.
 * Tests drive fakes (MemoryPoster, fake Verifier/LeadPipe) and pure
 * functions. A test that reaches the network is a test that spends money.
 */

const srcRoot = new URL("../", import.meta.url);

// Host names only: vendor *names* appear legitimately in tests (recipe tiers, price rows).
const VENDOR_HOSTS = /millionverifier\.com|no2bounce\.com|leadmagic\.io|prospeo\.io|fullenrich\.com|aiark\.(com|io|ai)|apify\.com|getleads\.(io|com)|smartlead\.ai|slack\.com\/api|supabase\.co\b|railway\.app/i;

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".test.ts")) out.push(u);
  }
  return out;
}

describe("D4 — tests never touch a vendor", () => {
  it("no test file names a vendor host or constructs a live client", async () => {
    const files = await walk(srcRoot);
    const offenders: string[] = [];
    for (const f of files) {
      if (f.pathname.endsWith("no_vendor_in_tests.test.ts")) continue;
      const src = await readFile(f, "utf8");
      if (VENDOR_HOSTS.test(src)) offenders.push(`${f.pathname}: names a vendor host`);
      if (/new (VerifierClient|LeadPipeClient|GetleadsClient|SmartleadClient|McpHttpClient|SlackPoster|WebClient|Db)\(/.test(src)) offenders.push(`${f.pathname}: constructs a live client`);
      if (/\bfetch\(\s*["'`]https?:/.test(src)) offenders.push(`${f.pathname}: fetches a URL`);
    }
    assert.deepEqual(offenders, [], "D4: a test would call a vendor. Fake the client and assert on the ledger. Ask Josh if you think this one is different.");
  });
});
