import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The booklet's reads and its one write (D113). Every fact comes live from
 * the database, through the Supabase function booklet-data (topup.bot_rules, client_map, campaign_registry,
 * list_build_records, process_changes, the Smartlead mirror) or from the
 * skills folder in this repo. Nothing about a client is written here.
 * Counts, ids, names of campaigns and plain-English text only: no lead row
 * is ever selected.
 */

export const TOOLKIT_RULE_ID = "52fe5a2f-9de6-4f29-a3b6-3ebb5843ae82";
export const FIRST_SKILL = "josh-judgment-calls";
/** Smartlead lead categories the mirror counts as a positive reply. Same as the retired service. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
const TAG = /^[a-z][a-z0-9_]{0,60}$/;

export const START_HERE = `Start here, every session, before any top-up or list build:

1. get_canon(): the shared rules every bot follows (Josh's and Cayden's). They win over skill text where they conflict.
2. get_skill("josh-judgment-calls"): Josh's judgment calls by client and lane.
3. get_skill("grok-bot-babysitter"): how a top-up runs, step by step, with your own connectors.
4. get_toolkit(): which connectors to use for what.
5. For the client: get_client(client_tag), then find_low_campaigns(client_tag) to pick the lane.

Then read the client's pull skill (list_skills() shows them) and the build transcript the client history points at, and replay it with your own connectors.

This server is the booklet, not the engine. It never pulls, spends, verifies or loads, and never touches a Smartlead campaign. Lead rows never come back from it.

When Josh or Cayden makes a new durable decision, save it with add_rule (pass supersedes to replace an older rule; old rules are marked superseded, never deleted). What the rules, skills and transcripts do not answer is one plain-English question to Josh.`;

export function skillsDir(root) {
  return join(root, "skills");
}

/** Every skill folder with a SKILL.md, josh-judgment-calls first, with its one-line description. */
export async function listSkills(root) {
  const dir = skillsDir(root);
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!SKILL_NAME.test(name)) continue;
    const file = join(dir, name, "SKILL.md");
    try {
      if (!(await stat(file)).isFile()) continue;
    } catch {
      continue;
    }
    const text = await readFile(file, "utf8");
    out.push({ name, description: frontMatter(text).description ?? null });
  }
  out.sort((a, b) => (a.name === FIRST_SKILL ? -1 : b.name === FIRST_SKILL ? 1 : a.name.localeCompare(b.name)));
  return out;
}

export async function getSkill(root, name) {
  if (!SKILL_NAME.test(name ?? "")) return null;
  try {
    return await readFile(join(skillsDir(root), name, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
}

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** The database half lives in the Supabase function booklet-data (D113), which needs no key: fixed actions only. */
export const DATA_URL = process.env.BOOKLET_DATA_URL || "https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1/booklet-data";

export function dataClient(url = DATA_URL, fetchImpl = fetch) {
  return async (action, args = {}) => {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, args }) });
    const body = await res.json().catch(() => ({ ok: false, error: `booklet-data answered ${res.status}` }));
    if (!body.ok) throw new Error(body.error ?? `booklet-data answered ${res.status}`);
    return body.data;
  };
}

export async function getCanon(data, { client, category } = {}) {
  return data("canon", { client, category });
}

export async function getToolkit(data) {
  return data("toolkit");
}

/** Insert a rule; with supersedes, the old row is marked superseded in the same transaction. Never deletes. */
export async function addRule(data, args) {
  return data("add_rule", args);
}

export async function listClients(data) {
  return data("clients");
}

/** Client context: who they are, their campaigns and lanes, their build history in words, process changes, rules and skills. */
export async function getClient(data, root, tag, { history = 10 } = {}) {
  if (!TAG.test(tag ?? "")) return null;
  const out = await data("client", { client_tag: tag, history });
  if (!out) return null;
  const skills = await listSkills(root);
  const word = tag.split("_")[0];
  return {
    ...out,
    skills: skills.filter((s) => s.name.startsWith(`${tag.replace(/_/g, "-")}-`) || s.name.startsWith(`${word}-`) || (s.description ?? "").toLowerCase().includes(tag.replace(/_/g, " "))).map((s) => s.name),
    next: "Read the build transcript at transcript_path for the lane you are topping up, and the client's pull skill with get_skill.",
  };
}

/**
 * Campaigns for a client with what is left to send and how they perform:
 * untouched leads, sends in the last 7 days, days of runway at that pace,
 * lifetime sends and positive replies, and the rate per 2,000 sends. Rolled
 * up by lane. Flags only; the bot applies the rules from get_canon.
 */
export async function findLowCampaigns(data, tag) {
  if (!TAG.test(tag ?? "")) return null;
  const rows = (await data("low_campaigns", { client_tag: tag })) ?? [];
  const campaigns = rows.map((r) => {
    const perDay = r.sends_7d / 7;
    return {
      ...r,
      runway_days: perDay > 0 ? Math.round((r.untouched / perDay) * 10) / 10 : null,
      positives_per_2000: r.sends > 0 ? Math.round((r.positives / r.sends) * 2000 * 100) / 100 : 0,
    };
  });
  const lanes = new Map();
  for (const c of campaigns) {
    const key = c.lane ?? "(no lane)";
    const lane = lanes.get(key) ?? { lane: key, campaigns: 0, stopped: 0, untouched: 0, sends_7d: 0, sends: 0, positives: 0 };
    lane.campaigns += 1;
    if ((c.status ?? "").toUpperCase() === "STOPPED") {
      lane.stopped += 1;
    } else {
      lane.untouched += c.untouched;
      lane.sends_7d += c.sends_7d;
    }
    lane.sends += c.sends;
    lane.positives += c.positives;
    lanes.set(key, lane);
  }
  const rollup = [...lanes.values()].map((l) => ({
    ...l,
    runway_days: l.sends_7d > 0 ? Math.round((l.untouched / (l.sends_7d / 7)) * 10) / 10 : null,
    positives_per_2000: l.sends > 0 ? Math.round((l.positives / l.sends) * 2000 * 100) / 100 : 0,
  }));
  rollup.sort((a, b) => (a.runway_days ?? Infinity) - (b.runway_days ?? Infinity));
  return {
    client_tag: tag,
    lanes: rollup,
    campaigns,
    note: "Runway is untouched leads divided by the last 7 days' daily send pace; null means nothing sent in 7 days. STOPPED campaigns are left out of lane runway. Which lanes qualify for a top-up (the reply bar, cold-call and never-top-up campaigns) is in get_canon, not here.",
  };
}
