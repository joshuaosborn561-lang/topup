/**
 * Step 1 cells: band × mail class × gift (× offer when the recipe has it).
 * A routing rule covers a cell when every `when` key matches. A rule that
 * omits a dimension (AirPods campaigns with no mail_class) covers every
 * value of that dimension.
 */

export function segmentCells(segments: Record<string, string[]>): Array<Record<string, string>> {
  const dims = Object.entries(segments).filter(([, values]) => values.length > 0);
  if (dims.length === 0) return [];
  return dims.reduce<Array<Record<string, string>>>((cells, [dim, values]) => {
    const next: Array<Record<string, string>> = [];
    for (const cell of cells) for (const value of values) next.push({ ...cell, [dim]: value });
    return next;
  }, [{}]);
}

export function ruleCoversCell(when: Record<string, string>, cell: Record<string, string>): boolean {
  return Object.entries(when).every(([key, value]) => cell[key] === value);
}

export function uncoveredCells(
  segments: Record<string, string[]>,
  routing: ReadonlyArray<{ when: Record<string, string> }>,
): Array<Record<string, string>> {
  return segmentCells(segments).filter((cell) => !routing.some((rule) => ruleCoversCell(rule.when, cell)));
}

export function cellLabel(cell: Record<string, string>): string {
  return Object.entries(cell)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
}
