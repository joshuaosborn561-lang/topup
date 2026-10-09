import { z } from "zod";
import type { Queryable } from "../db/pool.js";

/** topup.client_map: the client tags and their Smartlead client ids. Adding a client is a row here. */
export const CLIENT_MAP_SQL = "select client_tag, smartlead_client_id from topup.client_map order by 1";

export interface ClientMapRow {
  client_tag: string;
  smartlead_client_id: number;
}

export async function loadClientMap(db: Queryable): Promise<ClientMapRow[]> {
  const { rows } = await db.query<{ client_tag: string; smartlead_client_id: string | number }>(CLIENT_MAP_SQL);
  return rows
    .map((r) => ({ client_tag: String(r.client_tag), smartlead_client_id: Number(r.smartlead_client_id) }))
    .filter((r) => r.client_tag.length > 0 && Number.isFinite(r.smartlead_client_id));
}

export async function loadClientTags(db: Queryable): Promise<string[]> {
  return (await loadClientMap(db)).map((r) => r.client_tag);
}

/** The client_tag input: the live list when it is known, snake_case otherwise. */
export function clientTagSchema(tags: readonly string[]): z.ZodType<string> {
  const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case client_tag");
  if (tags.length === 0) return snake;
  return snake.refine((t) => tags.includes(t), { message: `client_tag must be one of ${tags.join(", ")} (topup.client_map)` });
}
