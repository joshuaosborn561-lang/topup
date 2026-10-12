import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachSiteOwners,
  countSiteOwners,
  isSharedOwnerTable,
  refuseSharedOwnerTable,
  SITE_OWNERS_SOURCE,
  siteOwnersBatch,
  siteOwnersNeedJobId,
} from "./siteOwners.js";
import { DEFAULT_LOOKING_FOR, FOUND_VIEW, questionKey, siteCheckBatch } from "./siteCheck.js";
import type { RunRow } from "../domain/runs.js";

/** D94 — owners attach by this job's place_id or normalized domain. Counts and ids; never a name. Ask Josh or Cayden. */

const run: RunRow = {
  run_id: "11111111-2222-3333-4444-555555555555",
  recipe_id: "acme.job.v1",
  client_tag: "acme",
  lane: "lane_e",
  campaign_id: 1,
  status: "suppressing",
  current_step: "icp",
  trigger: "manual",
  opened_by: "mcp:operator",
  opened_at: "2026-10-12T17:46:08.601Z",
  closed_at: null,
  counts_by_status: { grok_job: 1 },
  spend_cents_by_vendor: {},
  slack_channel: null,
  slack_thread_ts: null,
  last_error: null,
};

function fakeDb(opts?: { counts?: Record<string, string>; applyN?: string }) {
  const seen: Array<{ text: string; params?: unknown[] }> = [];
  const counts = {
    job_rows: "80",
    job_domains: "80",
    job_places: "70",
    found_on_job: "59",
    cached_other_batch: "19",
    already_named: "0",
    attachable: "59",
    ...(opts?.counts ?? {}),
  };
  const db = {
    seen,
    query: async (text: string, params?: unknown[]) => {
      seen.push({ text, params });
      if (text.includes("from information_schema.tables")) return { rows: [{ n: "1" }] };
      if (text.includes("from information_schema.columns") && text.includes("$1")) {
        const schema = params?.[0];
        if (schema === "lp") {
          return {
            rows: ["id", "first_name", "last_name", "title", "email", "company_domain", "run_id"].map((column_name) => ({
              column_name,
            })),
          };
        }
        return { rows: ["place_id", "email", "domain"].map((column_name) => ({ column_name })) };
      }
      if (text.includes("as attachable")) return { rows: [counts] };
      if (text.includes("select count(*)::text as n from upd")) return { rows: [{ n: opts?.applyN ?? "59" }] };
      return { rows: [] };
    },
    withRun: async <T>(_runId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db),
  };
  return db;
}

describe("D94 — owners attach by this job's places", () => {
  it("refuses the shared owner view and client owner tables", () => {
    assert.equal(isSharedOwnerTable(FOUND_VIEW), true);
    assert.equal(isSharedOwnerTable("topup.site_people_found"), true);
    assert.equal(isSharedOwnerTable("topup.site_check_people"), true);
    assert.equal(isSharedOwnerTable("client_acme.owner_netnew_20261010"), true);
    assert.equal(isSharedOwnerTable("scratch.acme_owner_pilot"), true);
    assert.equal(isSharedOwnerTable("client_acme.dealers"), false);
    assert.equal(isSharedOwnerTable("lp.acme_ingested_leads"), false);
    const refused = refuseSharedOwnerTable(FOUND_VIEW);
    assert.match(refused!, /D94/);
    assert.match(refused!, /site_owners/);
    assert.match(refused!, /place_id or normalized domain/);
    assert.match(siteOwnersNeedJobId(), /job_id/);
    assert.equal(siteOwnersBatch(run.run_id), siteCheckBatch("people", run.run_id));
  });

  it("count is the dry-run: this job's place_id or normalized domain", async () => {
    const db = fakeDb();
    const out = await countSiteOwners({ db: db as never, repo: { getRun: async () => run } }, { job_id: run.run_id });
    assert.equal(out.status, "done");
    assert.equal(out.source, SITE_OWNERS_SOURCE);
    assert.equal(out.apply, false);
    assert.equal(out.looking_for, DEFAULT_LOOKING_FOR);
    assert.equal(out.question_key, questionKey(DEFAULT_LOOKING_FOR));
    assert.deepEqual(out.counts, {
      job_rows: 80,
      job_domains: 80,
      job_places: 70,
      found_on_job: 59,
      cached_other_batch: 19,
      already_named: 0,
      attached: 0,
    });
    assert.match(out.next!, /59/);
    assert.match(out.next!, /does not abort/);
    const sql = db.seen.map((s) => s.text).join("\n");
    assert.match(sql, /run_id = \$1/, "D94: the job is the scope");
    assert.match(sql, /place_id/, "D94: businesses may key by place_id");
    assert.match(sql, /a\.domain = p\.domain/, "D94: or by normalized domain");
    assert.match(sql, /topup\.site_answers/);
    assert.match(sql, /topup\.site_people/);
    assert.doesNotMatch(sql, /and f\.in_batch/, "D94: the text batch is not the attach filter");
    assert.doesNotMatch(sql, /where t\.batch = \(select batch from looking\)\s+\)/, "D94: found does not require this job's text batch");
    assert.doesNotMatch(sql, /site_people_found/, "D94: never the shared view");
    assert.doesNotMatch(sql, /owner_netnew|owner_pilot|_owner_/, "D94: never a client owner table");
    assert.doesNotMatch(sql, /dl_status|sg_exclude|skip_/);
    assert.ok(!JSON.stringify(out).includes("full_name"));
  });

  it("apply updates this job's own places only and does not reopen the job", async () => {
    const db = fakeDb({ applyN: "58" });
    const out = await attachSiteOwners(
      { db: db as never, repo: { getRun: async () => run } },
      { job_id: run.run_id, apply: true },
    );
    assert.equal(out.status, "done");
    assert.equal(out.counts.attached, 58);
    assert.match(out.next!, /unchanged/);
    const upd = db.seen.find((s) => s.text.includes("update lp.acme_ingested_leads"));
    assert.ok(upd);
    assert.match(upd!.text, /i\.run_id = \$1/);
    assert.doesNotMatch(upd!.text, /f\.in_batch/, "D94: cached owners on this job's places attach");
    assert.doesNotMatch(upd!.text, /site_people_found/);
    assert.doesNotMatch(upd!.text, /set lead_status|set icp_gate|abort/);
    assert.equal(upd!.params?.[0], run.run_id);
  });

  it("refuses a missing job, a tag mismatch, and a job with no ingest rows", async () => {
    const db = fakeDb();
    const missing = await countSiteOwners({ db: db as never, repo: { getRun: async () => null } }, { job_id: "nope" });
    assert.equal(missing.status, "refused");
    const tagged = await countSiteOwners(
      { db: db as never, repo: { getRun: async () => run } },
      { job_id: run.run_id, client_tag: "other" },
    );
    assert.equal(tagged.status, "refused");
    const empty = fakeDb({
      counts: {
        job_rows: "0",
        job_domains: "0",
        job_places: "0",
        found_on_job: "0",
        cached_other_batch: "0",
        already_named: "0",
        attachable: "0",
      },
    });
    const nothing = await countSiteOwners({ db: empty as never, repo: { getRun: async () => run } }, { job_id: run.run_id });
    assert.equal(nothing.status, "nothing");
  });
});
