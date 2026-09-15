import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D3 — secrets live in Railway. Nothing in the repo carries a real value.
 * If this fails, rotate the key first, then fix the file. Ask Josh.
 */

const root = new URL("../../", import.meta.url);
const SCAN_DIRS = ["src/", "recipes/", "supabase/", "scripts/", "skills/", "docs/"];
const SCAN_FILES = [".env.example", "railway.toml", "Dockerfile", "package.json"];

const PATTERNS: Array<[string, RegExp]> = [
  ["Slack bot token", /xox[abpors]-[A-Za-z0-9-]{10,}/],
  ["Supabase service role JWT", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^:\s]+:[^@\s]{4,}@/],
  ["Generic API key assignment", /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
];

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else out.push(u);
  }
  return out;
}

describe("D3 — no secrets in the repo", () => {
  it("no key-shaped string in any scanned file", async () => {
    const files: URL[] = [];
    for (const d of SCAN_DIRS) files.push(...(await walk(new URL(d, root)).catch(() => [])));
    for (const f of SCAN_FILES) files.push(new URL(f, root));
    const hits: string[] = [];
    for (const f of files) {
      const text = await readFile(f, "utf8").catch(() => "");
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f.pathname.replace(root.pathname, "")}: ${name}`);
    }
    assert.deepEqual(hits, [], "D3: a secret-shaped value is committed. Rotate it in Railway, then remove it here.");
  });

  it(".env.example has names only", async () => {
    const text = await readFile(new URL(".env.example", root), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (/KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(key)) assert.equal(value, "", `D3: .env.example sets a value for ${key}; it lists names only`);
    }
  });
});
