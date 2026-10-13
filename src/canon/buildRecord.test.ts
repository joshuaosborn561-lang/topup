import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIST_BUILD_TRANSCRIPTS_BUCKET,
  TRANSCRIPT_PAGE_DEFAULT,
  TRANSCRIPT_PAGE_MAX,
  buildRecord,
  downloadListBuildTranscript,
  pageTranscript,
  pathsOnRecords,
  sanitizeTranscriptPath,
} from "./buildRecord.js";

/** D75 — build_record is a read: narrative, ids, a paged transcript. No DDL, no write, no spend. Ask Josh. */

const row = {
  id: 198,
  client_tag: "parlay",
  campaign_ids: [4049065],
  receipt_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
  lanes: ["it_dm"],
  narrative: "Pulled getleads on the stored titles. Receipts have the filters.",
  transcript_path: "parlay/parlay3_530c4781.md",
  transcript_paths: ["parlay/parlay3_530c4781.md"],
  transcript_format: "md",
  spend_cents: 0,
  yield_by_step: { pulled: 2000 },
  session_date: "2026-09-29",
  written_by: "claude",
  created_at: "2026-09-29T12:00:00Z",
  source_refs: { chat_id: "x" },
  provenance_confidence: "high",
  email: "stray@example.com",
};

function db(opts: { present?: boolean; rows?: Record<string, unknown>[]; name?: string | null } = {}) {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text);
      if (text.includes("from public.campaigns")) return { rows: [{ name: opts.name ?? "Parlay IT" }] };
      if (text.includes("to_regclass")) return { rows: [{ present: opts.present ?? true }] };
      if (text.includes("from topup.list_build_records")) return { rows: opts.rows ?? [row] };
      return { rows: [] };
    },
  };
}

describe("D75 — build_record", () => {
  it("returns matching rows (narrative, receipt_ids, campaign ids, transcript path) and drops a stray lead column", async () => {
    const fake = db();
    const r = await buildRecord({ db: fake as never }, { client_tag: "parlay", campaign_id: 4049065 });
    assert.ok(!("error" in r));
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0]?.narrative, row.narrative);
    assert.deepEqual(r.records[0]?.receipt_ids, row.receipt_ids);
    assert.deepEqual(r.records[0]?.campaign_ids, [4049065]);
    assert.equal(r.records[0]?.transcript_path, "parlay/parlay3_530c4781.md");
    assert.equal((r.records[0] as { email?: string }).email, undefined);
    assert.ok(!JSON.stringify(r).includes("@"), "D2/D75: a stray email column never reaches the answer");
    assert.equal(r.transcript, undefined, "D75: the transcript is opt-in");
    assert.match(r.how_to_read, /transcript is the method/);
    assert.ok(fake.sql.some((q) => q.includes("from topup.list_build_records") && q.includes("$2::int = any(campaign_ids)")));
    assert.ok(fake.sql.every((q) => !/\b(insert|update|delete|create|alter|drop|grant)\b/i.test(q)));
  });

  it("pages the transcript and refuses a path that is not on a matching row", async () => {
    const body = "abcdefghij".repeat(2000);
    const fake = db();
    const seen: string[] = [];
    const r = await buildRecord(
      { db: fake as never, readTranscript: async (path) => { seen.push(path); return body; } },
      { client_tag: "parlay", campaign_id: 4049065, fetch_transcript: true, offset: 0, limit: 20 },
    );
    assert.ok(!("error" in r));
    assert.ok(r.transcript && !("error" in r.transcript));
    assert.equal(r.transcript.path, "parlay/parlay3_530c4781.md");
    assert.equal(r.transcript.text, body.slice(0, 20));
    assert.equal(r.transcript.total_chars, body.length);
    assert.equal(r.transcript.next_offset, 20);
    assert.deepEqual(seen, ["parlay/parlay3_530c4781.md"]);

    const refused = await buildRecord(
      { db: fake as never, readTranscript: async () => { throw new Error("should not fetch"); } },
      { client_tag: "parlay", campaign_id: 4049065, fetch_transcript: true, transcript_path: "other/secret.md" },
    );
    assert.ok(!("error" in refused));
    assert.deepEqual(refused.transcript, {
      error: "transcript_path is not on a matching list_build_records row. The service does not fetch an arbitrary object.",
    });
  });

  it("refuses a cold-call campaign and a missing table, and does not invent a signed URL", async () => {
    const cold = await buildRecord({ db: db({ name: "Gabe Calls" }) as never }, { client_tag: "parlay", campaign_id: 1 });
    assert.ok("error" in cold);
    assert.match(cold.error, /cold call/);

    const missing = await buildRecord({ db: db({ present: false }) as never }, { client_tag: "parlay", campaign_id: 4049065 });
    assert.ok("error" in missing);
    assert.match(missing.error, /list_build_records is missing/);

    const empty = await buildRecord({ db: db({ rows: [] }) as never }, { client_tag: "parlay", campaign_id: 4049065 });
    assert.ok(!("error" in empty));
    assert.equal(empty.records.length, 0);
    assert.match(empty.note, /No list_build_records row/);
    assert.ok(!JSON.stringify(empty).includes("signed"));
    assert.ok(!JSON.stringify(empty).includes("https://"));
  });

  it("sanitizes paths, pages text, and downloads only GET object", async () => {
    assert.equal(sanitizeTranscriptPath("parlay/a.md"), "parlay/a.md");
    assert.equal(sanitizeTranscriptPath("../etc/passwd"), null);
    assert.equal(sanitizeTranscriptPath("https://example.com/x"), null);
    assert.deepEqual(pathsOnRecords([{ ...row, transcript_paths: ["a.md", "b.md"], transcript_path: "a.md" }]), ["a.md", "b.md"]);
    const page = pageTranscript("hello world", "a.md", 6, 5);
    assert.equal(page.text, "world");
    assert.equal(page.next_offset, null);
    assert.equal(TRANSCRIPT_PAGE_DEFAULT, 12_000);
    assert.equal(TRANSCRIPT_PAGE_MAX, 24_000);

    const calls: Array<{ url: string; method?: string }> = [];
    const text = await downloadListBuildTranscript({
      supabaseUrl: "https://project.example",
      serviceRoleKey: "test-key",
      path: "parlay/a.md",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), method: String(init?.method ?? "GET") });
        return new Response("page one", { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(text, "page one");
    assert.equal(calls[0]?.method, "GET");
    assert.match(calls[0]?.url ?? "", /\/storage\/v1\/object\/list-build-transcripts\/parlay\/a\.md$/);
    assert.ok(!calls[0]?.url.includes("sign"), "D2/D75: never a signed URL");
    assert.equal(LIST_BUILD_TRANSCRIPTS_BUCKET, "list-build-transcripts");
  });
});
