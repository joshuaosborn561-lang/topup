import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { LIST_BUILD_TRANSCRIPTS_BUCKET } from "./buildRecord.js";
import { CLIENT_PLAYBOOK, PLAYBOOK_HOW_TO_READ, clientPlaybook } from "./playbook.js";

/** D100 — playbook is a read: the client's list builds and method changes, in order. No write, no spend. Ask Josh. */

const buildRow = {
  id: 1,
  client_tag: "aa",
  campaign_ids: [1001],
  lanes: ["it_dm"],
  body: "Pulled the stored titles. Do not include role inboxes.",
  transcript_path: "aa/t1.md",
  transcript_paths: ["aa/t1.md"],
  transcript_format: "md",
  spend_cents: 0,
  yield_by_step: { pulled: 2000 },
  session_date: "2026-09-01",
  written_by: "claude",
  created_at: "2026-09-01T12:00:00Z",
  receipt_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
  provenance_confidence: "high",
  email: "stray@example.com",
};

const changeRow = {
  id: 7,
  client_tag: null,
  body: "Website ICP check runs after the quote is approved.",
  transcript_path: "all/process.md",
  transcript_format: "md",
  written_by: "claude",
  created_at: "2026-10-01T12:00:00Z",
};

function db(opts: {
  view?: boolean;
  builds?: boolean;
  changes?: boolean;
  viewRows?: Record<string, unknown>[];
  buildRows?: Record<string, unknown>[];
  changeRows?: Record<string, unknown>[];
} = {}) {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text);
      if (text.includes("to_regclass('topup.client_playbook')")) return { rows: [{ present: opts.view ?? false }] };
      if (text.includes("to_regclass('topup.list_build_records')")) {
        return { rows: [{ builds: opts.builds ?? true, changes: opts.changes ?? true }] };
      }
      if (text.includes("from topup.client_playbook")) return { rows: opts.viewRows ?? [] };
      if (text.includes("from topup.list_build_records")) return { rows: opts.buildRows ?? [buildRow] };
      if (text.includes("from topup.process_changes")) return { rows: opts.changeRows ?? [changeRow] };
      return { rows: [] };
    },
  };
}

describe("D100 — playbook", () => {
  it("gathers list builds and method changes in chronological order and drops a stray lead column", async () => {
    const fake = db();
    const r = await clientPlaybook(fake as never, "aa");
    assert.ok(!("error" in r));
    assert.equal(r.client_tag, "aa");
    assert.equal(r.list_build_count, 1);
    assert.equal(r.process_change_count, 1);
    assert.equal(r.event_count, 2);
    assert.deepEqual(r.events.map((e) => e.kind), ["list_build", "process_change"]);
    assert.equal(r.events[0]?.body, buildRow.body);
    assert.equal(r.events[1]?.scope, "all");
    assert.deepEqual(r.events[0]?.transcript_links, [`${LIST_BUILD_TRANSCRIPTS_BUCKET}/aa/t1.md`]);
    assert.equal(r.events[0]?.transcript_bucket, LIST_BUILD_TRANSCRIPTS_BUCKET);
    assert.equal((r.events[0] as { email?: string }).email, undefined);
    assert.ok(!JSON.stringify(r).includes("@"), "D2/D100: a stray email column never reaches the answer");
    assert.ok(!JSON.stringify(r).includes("https://"), "D75/D100: never a signed URL");
    assert.match(r.how_to_read, /before a top-up/);
    assert.equal(r.how_to_read, PLAYBOOK_HOW_TO_READ);
    assert.ok(fake.sql.every((q) => !/\b(insert|update|delete|create|alter|drop|grant)\b/i.test(q)));
    assert.ok(fake.sql.every((q) => !/\b(dl_status|sg_exclude|skip_)/.test(q)));
  });

  it("reads the grouped view when it exists", async () => {
    const fake = db({
      view: true,
      viewRows: [
        {
          client_tag: "aa",
          list_build_count: 1,
          process_change_count: 1,
          event_count: 2,
          first_at: "2026-09-01T12:00:00Z",
          last_at: "2026-10-01T12:00:00Z",
          timeline: [
            {
              kind: "list_build",
              scope: "client",
              source_id: 1,
              at: "2026-09-01T12:00:00Z",
              session_date: "2026-09-01",
              campaign_ids: [1001],
              lanes: ["it_dm"],
              body: buildRow.body,
              written_by: "claude",
              transcript_bucket: LIST_BUILD_TRANSCRIPTS_BUCKET,
              transcript_path: "aa/t1.md",
              transcript_paths: ["aa/t1.md"],
              transcript_links: ["list-build-transcripts/aa/t1.md"],
              spend_cents: 0,
            },
            {
              kind: "process_change",
              scope: "all",
              source_id: 7,
              at: "2026-10-01T12:00:00Z",
              body: changeRow.body,
              written_by: "claude",
              transcript_path: "all/process.md",
              transcript_paths: ["all/process.md"],
            },
          ],
        },
      ],
    });
    const r = await clientPlaybook(fake as never, "aa");
    assert.ok(!("error" in r));
    assert.equal(r.event_count, 2);
    assert.ok(fake.sql.some((q) => q.includes("from topup.client_playbook") && q.includes("where client_tag = $1")));
    assert.ok(fake.sql.every((q) => !q.includes("from topup.list_build_records")));
  });

  it("returns an empty playbook for a client with no records, and fails if the tables are missing", async () => {
    const empty = await clientPlaybook(db({ buildRows: [], changeRows: [] }) as never, "aa");
    assert.ok(!("error" in empty));
    assert.equal(empty.event_count, 0);
    assert.match(empty.note, /No list_build_records/);

    const missing = await clientPlaybook(db({ builds: false }) as never, "aa");
    assert.ok("error" in missing);
    assert.match(missing.error, /list_build_records is missing/);
  });

  it("refuses a traversal path as a transcript link", async () => {
    const r = await clientPlaybook(
      db({
        buildRows: [{ ...buildRow, transcript_path: "../secret.md", transcript_paths: ["../secret.md"] }],
        changeRows: [],
      }) as never,
      "aa",
    );
    assert.ok(!("error" in r));
    assert.deepEqual(r.events[0]?.transcript_links, []);
    assert.equal(r.events[0]?.transcript_path, null);
  });

  it("the migration view groups by client_tag and updates when a record is appended", async () => {
    const sql = await readFile(new URL("../../supabase/migrations/0027_client_playbook.sql", import.meta.url), "utf8");
    const pg = new PGlite();
    await pg.exec(`
      create schema topup;
      create role leadtopup_app;
      create role service_role;
      create role anon;
      create role authenticated;
      create table topup.list_build_records (
        id bigint primary key,
        client_tag text not null,
        campaign_ids bigint[] not null,
        lanes text[],
        narrative text not null,
        transcript_path text,
        transcript_format text not null default 'jsonl',
        spend_cents int,
        yield_by_step jsonb,
        session_date date not null default current_date,
        written_by text not null default 'claude',
        created_at timestamptz not null default now(),
        receipt_ids uuid[],
        transcript_paths text[],
        source_refs jsonb,
        provenance_confidence text
      );
      create table topup.process_changes (
        id bigint primary key,
        client_tag text,
        summary text not null,
        transcript_path text not null,
        transcript_format text not null default 'md',
        written_by text not null default 'claude',
        created_at timestamptz not null default now()
      );
    `);
    await pg.exec(sql);
    await pg.query(
      `insert into topup.list_build_records (id, client_tag, campaign_ids, narrative, transcript_path, transcript_paths, session_date, created_at)
       values (1, 'aa', array[1001]::bigint[], 'first build', 'aa/t1.md', array['aa/t1.md'], '2026-09-01', '2026-09-01T12:00:00Z')`,
    );
    await pg.query(
      `insert into topup.process_changes (id, client_tag, summary, transcript_path, created_at)
       values (2, null, 'method change for every client', 'all/p.md', '2026-09-15T12:00:00Z')`,
    );
    const before = await pg.query<{ event_count: number; timeline: unknown }>(
      `select event_count, timeline from topup.client_playbook where client_tag = 'aa'`,
    );
    assert.equal(Number(before.rows[0]?.event_count), 2);
    await pg.query(
      `insert into topup.list_build_records (id, client_tag, campaign_ids, narrative, transcript_path, session_date, created_at)
       values (3, 'aa', array[1001]::bigint[], 'second build', 'aa/t2.md', '2026-10-01', '2026-10-01T12:00:00Z')`,
    );
    const after = await pg.query<{ list_build_count: number; process_change_count: number; event_count: number; timeline: unknown }>(
      `select list_build_count, process_change_count, event_count, timeline from topup.client_playbook where client_tag = 'aa'`,
    );
    assert.equal(Number(after.rows[0]?.list_build_count), 2, "D100: a new list_build_records row appears without a batch job");
    assert.equal(Number(after.rows[0]?.process_change_count), 1);
    assert.equal(Number(after.rows[0]?.event_count), 3);
    const timeline = after.rows[0]?.timeline as Array<{ kind: string; transcript_links: string[] }>;
    assert.deepEqual(timeline.map((e) => e.kind), ["list_build", "process_change", "list_build"]);
    assert.ok(timeline[0]?.transcript_links.includes("list-build-transcripts/aa/t1.md"));
    assert.equal(CLIENT_PLAYBOOK, "topup.client_playbook");
    await pg.close();
  });
});
