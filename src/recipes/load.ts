import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseRecipe, type Recipe } from "./schema.js";
import type { Repo } from "../db/repo.js";
import { logger } from "../lib/log.js";

const log = logger("recipes");

/** Read every recipes/<client_tag>/<lane>.json and validate it. Throws on the first bad file. */
export async function loadRecipeFiles(root: string): Promise<Recipe[]> {
  const out: Recipe[] = [];
  let clients: string[] = [];
  try {
    clients = await readdir(root);
  } catch {
    return out;
  }
  for (const client of clients) {
    const dir = path.join(root, client);
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      const raw = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      const recipe = parseRecipe(raw);
      if (recipe.client_tag !== client) {
        throw new Error(`${client}/${f}: client_tag ${recipe.client_tag} does not match folder ${client}`);
      }
      if (`${recipe.lane}.json` !== f) {
        throw new Error(`${client}/${f}: lane ${recipe.lane} does not match filename`);
      }
      out.push(recipe);
    }
  }
  return out;
}

/** Mirror validated recipe files into topup.lane_recipes on deploy. */
export async function syncRecipes(repo: Repo, root: string): Promise<number> {
  const recipes = await loadRecipeFiles(root);
  for (const r of recipes) {
    const version = Number(r.recipe_id.split(".v").pop());
    await repo.upsertRecipe({
      recipe_id: r.recipe_id,
      client_tag: r.client_tag,
      lane: r.lane,
      version,
      body: r,
      owner_approved_at: r.owner_approved_at,
    });
  }
  log.info("recipes synced", { count: recipes.length, ids: recipes.map((r) => r.recipe_id) });
  return recipes.length;
}
