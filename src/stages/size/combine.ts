/**
 * Several segment lists, sized apart, then one total.
 * A list that could not be counted is not added in. The total is a TAM
 * only when every list was counted.
 */
export interface SegmentMeasure {
  label: string;
  counted: boolean;
  total: number;
  reason: string | null;
}

export function combineSegmentTotals(segments: SegmentMeasure[]): { allCounted: boolean; total: number; counted: number } {
  let total = 0;
  let counted = 0;
  for (const s of segments) {
    if (!s.counted) continue;
    counted += 1;
    total += s.total;
  }
  return { allCounted: segments.length > 0 && counted === segments.length, total, counted };
}

export function combineSizeLine(segments: SegmentMeasure[]): { kind: "total"; total: number } | { kind: "incomplete"; text: string } {
  const { allCounted, total, counted } = combineSegmentTotals(segments);
  const noun = segments.length === 1 ? "segment list" : "segment lists";
  const lines = segments.map((s) => (s.counted ? `${s.label}: ${s.total} matching` : `${s.label}: ${s.reason ?? "not counted"}`));
  if (!allCounted) {
    const head =
      counted === 0
        ? `Sized ${segments.length} ${noun} separately. None could be counted, so there is no combined TAM.`
        : `Sized ${segments.length} ${noun} separately. ${counted} counted (${total} matching). ${segments.length - counted} could not be counted, so the lists were not combined into one TAM.`;
    return { kind: "incomplete", text: `${head}\n${lines.join("\n")}` };
  }
  return { kind: "total", total };
}
