import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Repo } from "../db/repo.js";
import type { RunRow } from "../domain/runs.js";
import type { Recipe } from "../recipes/schema.js";
import { anthropicReasoner, type ReasonerFn } from "./call.js";
import { loadInventory } from "./inventory.js";
import { idsFromTargetCounts, recipeCampaignIds } from "../recipes/campaigns.js";
import { loadLanePicture } from "./picture.js";
import { proposeLane, type ProposeResult } from "./propose.js";
import { reasonTools } from "./tools.js";
import type { CountCall } from "./validate.js";

async function readIf(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

export async function loadProse(root: string, clientTag: string, companySource: string): Promise<{
  merged_list: string;
  servers: string;
  client_skill: string;
  source_skills: string[];
}> {
  const skills = path.join(root, "skills");
  const clientFile = path.join(skills, `${clientTag}-lead-pulls`, "SKILL.md");
  const sourceFile = path.join(skills, companySource === "getleads" ? "tam-sizing" : companySource === "maps" ? "tam-sizing" : "first-pull-receipt", "SKILL.md");
  return {
    merged_list: await readIf(path.join(skills, "merged-list", "SKILL.md")),
    servers: await readIf(path.join(root, "docs", "servers.md")),
    client_skill: await readIf(clientFile),
    source_skills: [await readIf(sourceFile)].filter(Boolean),
  };
}

export function makeProposer(opts: {
  repo: Repo;
  root: string;
  getleadsCount?: (filters: Record<string, unknown>) => Promise<{ total_matching: number }>;
  reasoner?: ReasonerFn;
  anthropicKey?: string;
  model?: string;
  target?: number;
}): (recipe: Recipe, run: RunRow) => Promise<ProposeResult> {
  return async (recipe, run) => {
    const query = async <T extends Record<string, unknown>>(sql: string, params: unknown[]) => {
      const { rows } = await opts.repo.raw().query<T>(sql, params);
      return rows;
    };
    const siblingIds = [...new Set([...recipeCampaignIds(recipe), ...idsFromTargetCounts(run.counts_by_status)])];
    const inventory = await loadInventory(query, recipe.client_tag, recipe.lane);
    const receipts = await opts.repo.listPullReceipts(recipe.client_tag, recipe.lane);
    const source = receipts.find((r) => r.granularity === "lane")?.company_source ?? "getleads";
    const prose = await loadProse(opts.root, recipe.client_tag, source);
    const picture = await loadLanePicture(query, recipe.client_tag, recipe.lane, prose, inventory, siblingIds);
    const calls: CountCall[] = [];
    const tools = reasonTools({
      sql: async (sql) => {
        const { rows } = await opts.repo.raw().query(sql);
        return { rows: rows.length, note: `${rows.length} rows` };
      },
      getleads: opts.getleadsCount,
      calls,
    });
    const reasoner = opts.reasoner ?? (opts.anthropicKey ? anthropicReasoner({ apiKey: opts.anthropicKey, model: opts.model }) : undefined);
    const result = await proposeLane(picture, {
      target: opts.target ?? recipe.size.useful_floor,
      tools,
      calls,
      reasoner,
      inventory,
    });
    await opts.repo.insertRunReasoning({
      run_id: run.run_id,
      client_tag: recipe.client_tag,
      lane: recipe.lane,
      prompt_hash: result.prompt_hash,
      tool_calls: calls,
      proposal: result.proposal,
      validation: result.kind === "proposal" ? { ok: true, worst_case_usd: result.validation.worst_case_usd } : { ok: false, message: result.message },
      dry_run: false,
    });
    return result;
  };
}
