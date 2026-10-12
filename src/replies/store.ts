import type { Queryable } from "../db/pool.js";
import type { ClassSource, NegativeClass } from "./classify.js";

/**
 * D81 — write the class onto the lead store. Idempotent. Never overwrites
 * a set class. Never writes dl_status, sg_exclude, or skip_*. Counts only.
 */

export async function hasNegativeClassColumn(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'negative_class'`,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function writeNegativeClass(
  db: Queryable,
  leadId: string,
  cls: NegativeClass,
  source: Exclude<ClassSource, "ai"> | "ai",
): Promise<number> {
  if (!(await hasNegativeClassColumn(db))) {
    throw new Error("public.leads.negative_class is missing; apply 0025_d81_negative_class.sql first. Ask Josh.");
  }
  const { rowCount } = await db.query(
    `update public.leads
        set negative_class = $2,
            negative_class_source = $3,
            negative_classed_at = now(),
            updated_at = now()
      where id = $1::uuid
        and negative_class is null`,
    [leadId, cls, source],
  );
  return rowCount ?? 0;
}
