/**
 * tam-sizing arithmetic, pure (D26, D48). count(bands) + count(other bands)
 * + unknown band == count(no filter). A gap is the unknown-band bucket, not
 * a broken filter; overlap past the tolerance means the band filter
 * double-counted and the count cannot be trusted.
 */
export interface Partition {
  bands: number;
  others: number;
  /** Records with a null, unknown, or unlisted band. They are in the unfiltered total and in neither bucket. */
  unknown: number;
  all: number;
  diff: number;
  ok: boolean;
}

export function partitionCheck(bands: number, others: number, all: number, tolerance: number): Partition {
  const unknown = all - bands - others;
  const overlap = Math.max(0, -unknown);
  const diff = Math.abs(unknown);
  const tol = all === 0 ? 0 : Math.max(1, Math.ceil(all * tolerance));
  const ok = all === 0 ? bands + others === 0 : overlap <= tol;
  return { bands, others, unknown, all, diff, ok };
}

/** A positive unknown bucket is part of the total, so the count stands. Overlap is a warning, not a park. */
export function bandMismatchReason(partition: Partition): string | null {
  if (partition.ok) return null;
  return `the band filter overlaps: ${partition.bands} (bands) + ${partition.others} (other bands) exceed ${partition.all} (no band filter) by ${partition.diff}. The count cannot be trusted (tam-sizing).`;
}

/** Records outside the in-ICP bands, including a null or unknown band: the unfiltered total minus the in-band count. */
export function outsideBandCount(all: number, inBand: number): number {
  return Math.max(0, all - inBand);
}

/** Size from the in-band count. Other bands are the rest of the total, so a null band sits inside "other" and the buckets add up. */
export function bandSizeDecision(inBand: number, all: number, tolerance: number): { total: number; partition: Partition; warning: string | null } {
  const others = outsideBandCount(all, inBand);
  const partition = partitionCheck(inBand, others, all, tolerance);
  return { total: inBand, partition, warning: bandMismatchReason(partition) };
}

export function sourcesAgree(a: number, b: number, within = 0.25): boolean {
  const hi = Math.max(a, b);
  return hi === 0 ? true : Math.abs(a - b) / hi <= within;
}

/** Rows the campaigns need to reach `target_days` of runway; null when the mirror has no send data. */
export function rowsNeeded(snaps: ReadonlyArray<{ untouched: number; sends_window: number }>, targetDays: number, windowDays: number): number | null {
  let need = 0;
  let anySends = false;
  for (const s of snaps) {
    if (s.sends_window <= 0) continue;
    anySends = true;
    const perDay = s.sends_window / windowDays;
    need += Math.max(0, Math.ceil(perDay * targetDays - s.untouched));
  }
  return anySends ? need : null;
}
