/**
 * ICP-path filters on maps count / size / pull (D68). Lane E views
 * re-apply the receipt's categories on `main_category` (not
 * `source_category` — that is the scrape bucket and is always in the
 * list). Schools (preschool through high school) belong to lane D and
 * are dropped on lane E.
 */

const IDENT = /^[a-z][a-z0-9_]*$/;

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
}

/** Lane E ICP views. Lane D keeps schools. Ask Josh before adding a stem. */
export function isLaneEIcp(icpView: string | null | undefined): boolean {
  return typeof icpView === "string" && /^v_lane_e(_|$)/.test(icpView);
}

/** Google-type tokens for preschool through high school. Not college. */
export const LANE_E_SCHOOL_CATEGORIES: readonly string[] = [
  "private school",
  "preschool",
  "pre-school",
  "pre school",
  "elementary school",
  "middle school",
  "high school",
  "kindergarten",
  "charter school",
  "religious school",
  "primary school",
  "secondary school",
  "private educational institution",
];

/** Name-side keywords, same range. Not a bare "school" (flight school stays). */
export const LANE_E_SCHOOL_NAME_RE =
  "(pre[- ]?school|elementary school|middle school|high school|kindergarten|pre[- ]?k|montessori|charter school|junior high)";

/** Prefer main_category — source_category is the scrape request and does not filter. */
export function icpCategoryClause(alias: string, cols: Set<string>, categories: string[], param: string): string {
  if (categories.length === 0 || !param) return "";
  if (!IDENT.test(alias)) throw new Error(`not an identifier: ${alias}`);
  const col = cols.has("main_category") ? "main_category" : cols.has("category") ? "category" : null;
  if (!col) return "";
  return ` and lower(${alias}.${q(col)}) = any(${param}::text[])`;
}

export function schoolExcludeClause(alias: string, cols: Set<string>): string {
  if (!IDENT.test(alias)) throw new Error(`not an identifier: ${alias}`);
  const parts: string[] = [];
  if (cols.has("main_category")) {
    const list = LANE_E_SCHOOL_CATEGORIES.map((c) => `'${c.replace(/'/g, "''")}'`).join(", ");
    parts.push(`lower(${alias}.${q("main_category")}) in (${list})`);
  }
  if (cols.has("name")) {
    parts.push(`lower(${alias}.${q("name")}) ~ '${LANE_E_SCHOOL_NAME_RE}'`);
  }
  return parts.length ? ` and not (${parts.join(" or ")})` : "";
}
