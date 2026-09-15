import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D22 — docs/servers.md before pipeline code on a server. Every client under
 * src/clients/ names a server that has a section in the document, and every
 * server the addendum lists has a section, so a new client cannot land
 * against an undocumented server.
 */

const root = new URL("../../", import.meta.url);

/** Client file → the `## ` heading it depends on in docs/servers.md. Add a row when you add a client. */
const CLIENT_SERVER: Readonly<Record<string, string>> = {
  "leadpipe.ts": "LeadPipe",
  "verifier.ts": "Email Verifier Progression",
  "getleads.ts": "getleads",
  "smartlead.ts": "Smartlead server",
  "domainWaterfall.ts": "Domain Waterfall",
  "peopleWaterfall.ts": "Find Named Person",
  "emailWaterfall.ts": "Email Finder Waterfall",
  "nameToEmail.ts": "Name to Email",
};

/** The ten servers the addendum names (section 4). */
const SERVERS = [
  "LeadPipe",
  "Google Maps Scraper",
  "PermitStack",
  "Property Owners",
  "Domain Waterfall",
  "Find Named Person",
  "Email Finder Waterfall",
  "Name to Email",
  "Email Verifier Progression",
  "Smartlead server",
];

describe("servers doc — D22", () => {
  it("docs/servers.md has a section for each of the ten servers", async () => {
    const doc = await readFile(new URL("docs/servers.md", root), "utf8");
    for (const s of SERVERS) {
      assert.match(doc, new RegExp(`^## .*${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"), `D22: docs/servers.md has no "## … ${s}" section. Document the server from its code before the service calls it; Josh reviews the doc first.`);
    }
  });

  it("every vendor client names a documented server", async () => {
    const dir = new URL("src/clients/", root);
    const doc = await readFile(new URL("docs/servers.md", root), "utf8");
    for (const f of (await readdir(dir)).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "mcpHttp.ts")) {
      const server = CLIENT_SERVER[f];
      assert.ok(server, `D22: src/clients/${f} is not in CLIENT_SERVER. Name the server it talks to and make sure docs/servers.md covers it.`);
      assert.match(doc, new RegExp(`^## .*${server}`, "m"), `D22: src/clients/${f} depends on "${server}" but docs/servers.md has no such section.`);
    }
  });
});
