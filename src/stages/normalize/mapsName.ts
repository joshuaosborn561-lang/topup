import { clientSchema } from "../../canon/mapsPool.js";

const IDENT = /^[a-z][a-z0-9_]*$/;

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
}

/**
 * Join from ingest to client_<tag>.maps_raw on lower(email). Ingest has
 * no place_id / source_url_hash (job 46b1c941). maps_raw.company and
 * title are empty; `name` is the Maps business name (D67).
 */
export function mapsNameJoinSql(clientTag: string, ingestAlias: string, mapsCols: Set<string>): string | null {
  if (!IDENT.test(ingestAlias)) throw new Error(`not an identifier: ${ingestAlias}`);
  if (!mapsCols.has("email") || !mapsCols.has("name")) return null;
  const schema = clientSchema(clientTag);
  return `left join (
    select distinct on (lower(email)) lower(email) as email_key, nullif(btrim(name), '') as maps_name
      from ${q(schema)}.${q("maps_raw")}
     where email is not null and coalesce(btrim(name), '') <> ''
     order by lower(email)
  ) maps_nm on maps_nm.email_key = lower(${ingestAlias}.email)`;
}
