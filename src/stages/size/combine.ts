/**
 * Several segment lists, sized apart. Businesses, permits, and people
 * stay in their own totals. A list that could not be counted stays out.
 * A total is reported only when every list was counted.
 */
export type CountUnit = "businesses" | "permits" | "people";

export interface SegmentMeasure {
  label: string;
  unit: CountUnit;
  counted: boolean;
  total: number;
  detail: string | null;
  reason: string | null;
}

export interface UnitTotal {
  unit: CountUnit;
  total: number;
  counted: number;
  lists: number;
}

const UNIT_WORD: Record<CountUnit, string> = {
  businesses: "businesses",
  permits: "permits",
  people: "matching",
};

const UNIT_ORDER: CountUnit[] = ["businesses", "permits", "people"];

export function listCountLine(segment: SegmentMeasure): string {
  if (!segment.counted) return `${segment.label}: ${segment.reason ?? "not counted"}`;
  const where = segment.detail ? ` ${segment.detail}` : "";
  return `${segment.label}: ${segment.total} ${UNIT_WORD[segment.unit]}${where}`;
}

export function combineByUnit(segments: SegmentMeasure[]): { allCounted: boolean; units: UnitTotal[] } {
  const buckets = new Map<CountUnit, UnitTotal>();
  let counted = 0;
  for (const segment of segments) {
    const bucket = buckets.get(segment.unit) ?? { unit: segment.unit, total: 0, counted: 0, lists: 0 };
    bucket.lists += 1;
    if (segment.counted) {
      bucket.counted += 1;
      bucket.total += segment.total;
      counted += 1;
    }
    buckets.set(segment.unit, bucket);
  }
  return {
    allCounted: segments.length > 0 && counted === segments.length,
    units: UNIT_ORDER.filter((unit) => buckets.has(unit)).map((unit) => buckets.get(unit)!),
  };
}

export function combineSizeLine(
  segments: SegmentMeasure[],
): { kind: "total"; units: UnitTotal[] } | { kind: "incomplete"; text: string } {
  const { allCounted, units } = combineByUnit(segments);
  const noun = segments.length === 1 ? "segment list" : "segment lists";
  const lines = segments.map(listCountLine);
  if (!allCounted) {
    const counted = units.reduce((n, unit) => n + unit.counted, 0);
    const countedUnits = units.filter((unit) => unit.counted > 0);
    const only = countedUnits.length === 1 ? countedUnits[0] : null;
    const head =
      counted === 0
        ? `Sized ${segments.length} ${noun} separately. None could be counted, so there is no combined TAM.`
        : only
          ? `Sized ${segments.length} ${noun} separately. ${counted} counted (${only.total} ${UNIT_WORD[only.unit]}). ${segments.length - counted} could not be counted, so the lists were not combined into one TAM.`
          : `Sized ${segments.length} ${noun} separately. ${counted} counted. ${segments.length - counted} could not be counted, so the lists were not combined.`;
    return { kind: "incomplete", text: `${head}\n${lines.join("\n")}` };
  }
  return { kind: "total", units };
}
