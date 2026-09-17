/**
 * D39 — inventory check in code, before reasoning. Unloaded verified rows
 * in our own tables for this lane. If they cover the target, skip the LLM
 * and card with action = repeat, basis = inventory.
 */

export type InventoryRow = { source_table: string; n: number; note: string };

export type InventoryHit = {
  enough: true;
  rows: InventoryRow[];
  n: number;
  source_table: string;
  note: string;
};

export type InventoryMiss = { enough: false; rows: InventoryRow[]; n: number };

export function inventoryCovers(rows: readonly InventoryRow[], target: number): InventoryHit | InventoryMiss {
  const n = rows.reduce((s, r) => s + r.n, 0);
  const best = [...rows].sort((a, b) => b.n - a.n)[0];
  if (best && n >= target && target > 0) {
    return { enough: true, rows: [...rows], n, source_table: best.source_table, note: best.note };
  }
  return { enough: false, rows: [...rows], n };
}

export async function loadInventory(
  query: <T extends Record<string, unknown>>(sql: string, params: unknown[]) => Promise<T[]>,
  clientTag: string,
  lane: string,
): Promise<InventoryRow[]> {
  const rows = await query<{ source_table: string; n: string | number; note: string }>(
    `select source_table, n::text as n, note from topup.unloaded_inventory($1, $2)`,
    [clientTag, lane],
  );
  return rows.map((r) => ({ source_table: r.source_table, n: Number(r.n), note: r.note }));
}
