import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parseLaneMismatchArgs } from "../../scripts/retag-lane-mismatch.js";

/** D93 — lane-mismatch fixer is generic. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D93 — lane-mismatch retag is generic", () => {
  it("requires a client_tag and accepts optional lane filters", () => {
    assert.throws(() => parseLaneMismatchArgs([]), /client_tag/);
    const dry = parseLaneMismatchArgs(["--client_tag=acme"]);
    assert.deepEqual(dry, { client_tag: "acme", apply: false });
    const narrowed = parseLaneMismatchArgs([
      "--client_tag=acme",
      "--from_lane=lane_a",
      "--to_lane=lane_b",
      "--build_label=build_1",
      "--apply",
    ]);
    assert.equal(narrowed.apply, true);
    assert.equal(narrowed.from_lane, "lane_a");
    assert.equal(narrowed.to_lane, "lane_b");
    assert.equal(narrowed.build_label, "build_1");
    assert.throws(() => parseLaneMismatchArgs(["--client_tag=acme", "--from_lane=lane_a"]), /both --from_lane and --to_lane/);
    assert.throws(
      () => parseLaneMismatchArgs(["--client_tag=acme", "--from_lane=unassigned", "--to_lane=lane_b"]),
      /parking lot/,
    );
  });

  it("the script has no client, lane or build constants", async () => {
    const src = await readFile(new URL("scripts/retag-lane-mismatch.ts", root), "utf8");
    assert.match(src, /parseLaneMismatchArgs/, "D93: args come from the caller");
    assert.match(src, /if \(!args\.apply\) return/, "D93: dry-run first");
    assert.match(src, /ALLOWED_SUPABASE_PROJECT_REF/);
    assert.match(src, /campaign_builds is a view/);
    assert.match(src, /UNASSIGNED_LANE|isUnassignedLane/, "D96: unassigned is never a retag target");
    assert.doesNotMatch(src, /const CLIENT_TAG|const PE_LANE|const IT_LANE|const IT_BUILD/);
    assert.doesNotMatch(src, /["']bcp["']|["']emcor["']|["']pe_firms["']|["']it_dm_airpods["']/);
    assert.doesNotMatch(src, /\b(set|update)\s+dl_status|\b(set|update)\s+sg_exclude|\bskip_[a-z0-9_]+\s*=/);
  });
});
