/**
 * tam-sizing "What to report" — always these five, in this order, then route.
 */
export interface SizeReportInput {
  number: number;
  filter: string;
  partition: { bands: number; others: number; all: number; diff: number; ok: boolean };
  secondVendor: string;
  agree: boolean | null;
  netNew: number;
  held: number;
  costUsd: string;
}

export function sizeReport(i: SizeReportInput): string {
  const partition = i.partition.ok
    ? `verified, ${i.partition.bands} + ${i.partition.others} = ${i.partition.all} (off by ${i.partition.diff})`
    : `FAILED, ${i.partition.bands} + ${i.partition.others} ≠ ${i.partition.all} (off by ${i.partition.diff})`;
  const second =
    i.agree === null
      ? i.secondVendor
      : `${i.secondVendor} — ${i.agree ? "agrees (within ~25%)" : "disagrees"}`;
  return [
    `1. Number: ${i.number} matching (${i.filter})`,
    `2. Partition: ${partition}`,
    `3. Second vendor: ${second}`,
    `4. Net-new: ${i.netNew} after ${i.held} already emailed to this ICP in the recycle window`,
    `5. Cost of sizing: ${i.costUsd}`,
  ].join("\n");
}
