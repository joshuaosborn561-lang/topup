import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_READS } from "../grok/allowlist.js";
import { GROK_READS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";

/**
 * D75 — build_record is a read-only read of list_build_records plus an
 * optional paged transcript. Narrative first; receipts stay the
 * at-a-glance source of record. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D75 — build_record is read-only", () => {
  it("is a read on the surface, not a spend or a write", () => {
    assert.ok((CANON_READS as readonly string[]).includes("build_record"), "D75: build_record is a read. Ask Josh.");
    assert.ok((GROK_READS as readonly string[]).includes("build_record"));
    assert.equal(MCP_TOOL_ROLE.build_record, "operator");
  });

  it("the impl is SELECT-only, pages the transcript, and never signs a URL", async () => {
    const src = await readFile(new URL("src/canon/buildRecord.ts", root), "utf8");
    assert.match(src, /from topup\.list_build_records/, "D75: the existing table");
    assert.match(src, /list-build-transcripts/, "D75: the existing bucket");
    assert.match(src, /\$2::int = any\(campaign_ids\)/, "D75: match this campaign");
    assert.match(src, /sanitizeTranscriptPath/, "D75: a path not on the row is refused");
    assert.match(src, /pageTranscript/, "D75: the transcript is paged");
    assert.doesNotMatch(src, /\b(insert|update|delete|create |alter |drop |grant )\b/i, "D75: no DDL and no write. Ask Josh.");
    assert.doesNotMatch(src, /signed|createSignedUrl|getPublicUrl/, "D2/D75: never a file URL");
    assert.doesNotMatch(src, /select\s+[^;]*\bemail\b/i, "D2/D75: never SELECT email");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /build_record/, "D75: registered on the MCP surface");
    assert.match(grok, /fetch_transcript/, "D75: the transcript is opt-in");
  });

  it("CANON and the babysitter tell Grok to read the narrative first", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D75\*\*/, "D75: fold into CANON. Ask Josh.");
    assert.match(canon, /`build_record\(client_tag, campaign_id\)`/, "D75: CANON names the read");
    assert.match(canon, /narrative first/, "D75: narrative first");
    assert.match(canon, /transcript only for an edge case/, "D75: transcript is the edge case");
    assert.match(canon, /Receipts stay the at-a-glance source of record/, "D75: receipts stay the glance");
    assert.match(canon, /no DDL, no write, no spend/, "D75: read-only");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /`build_record\(client_tag, campaign_id\)`/, "D75: the babysitter names the read");
    assert.match(skill, /narrative first/, "D75: the babysitter reads the narrative first");
  });
});
