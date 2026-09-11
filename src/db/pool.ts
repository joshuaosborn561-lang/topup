import pg from "pg";
import { ALLOWED_SUPABASE_PROJECT_REF } from "../config.js";

export type Queryable = {
  query: <R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<R>>;
};

/**
 * Postgres access. Every lead-table write goes through `withRun`, which sets
 * `app.run_id` for the transaction so the write lock trigger
 * (topup.lead_write_lock) accepts it. Writes outside a run transaction are
 * rejected by the database while a run is open, on purpose.
 */
export class Db {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    if (!connectionString.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
      throw new Error(
        `DATABASE_URL does not reference ${ALLOWED_SUPABASE_PROJECT_REF}; refusing to connect to another project.`,
      );
    }
    this.pool = new pg.Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      application_name: "leadtopup",
    });
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /** Transaction with `app.run_id` set, for lead-table writes owned by a run. */
  async withRun<T>(runId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.run_id', $1, true)", [runId]);
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

/** Validate an lp table name built from a client tag; never interpolate raw input. */
export function ingestedTable(clientTag: string): string {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(clientTag)) {
    throw new Error(`client_tag must be snake_case: ${clientTag}`);
  }
  return `lp.${clientTag}_ingested_leads`;
}
