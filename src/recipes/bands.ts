import { GETLEADS_BANDS } from "./schema.js";

export type Band = (typeof GETLEADS_BANDS)[number];

const BAND_ALIASES: Record<string, Band> = {
  "1 to 10": "1 to 10",
  "1-10": "1 to 10",
  "11 to 50": "11 to 50",
  "11-50": "11 to 50",
  "11_50": "11 to 50",
  "51 to 200": "51 to 200",
  "51-200": "51 to 200",
  "51_200": "51 to 200",
  "201 to 500": "201 to 500",
  "201-500": "201 to 500",
  "201_500": "201 to 500",
  "501 to 1000": "501 to 1000",
  "501-1000": "501 to 1000",
  "1001 to 5000": "1001 to 5000",
  "1001-5000": "1001 to 5000",
  "5001 to 10000": "5001 to 10000",
  "10001+": "10001+",
};

/** Consumer / free-mail hosts. Never treat these as a company domain. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "ymail.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
]);

export function normalizeBand(raw: string): Band | null {
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase().replace(/\s+employees?$/, "").replace(/–/g, "-");
  return BAND_ALIASES[trimmed] ?? BAND_ALIASES[key] ?? null;
}

export function inferBands(
  sizes: Array<{ value: string; n: number }>,
  fallback: string[] = [],
): Band[] {
  const fromList = new Set<Band>();
  for (const row of sizes) {
    const mapped = normalizeBand(row.value);
    if (mapped && row.n > 0) fromList.add(mapped);
  }
  if (fromList.size) return GETLEADS_BANDS.filter((b) => fromList.has(b));
  const fromFallback = new Set<Band>();
  for (const raw of fallback) {
    const mapped = normalizeBand(raw);
    if (mapped) fromFallback.add(mapped);
  }
  return GETLEADS_BANDS.filter((b) => fromFallback.has(b));
}

export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0] ?? d;
  d = d.split(":")[0] ?? d;
  if (d.includes("@")) d = (d.split("@")[1] ?? "").replace(/^www\./, "");
  if (!d.includes(".") || d.length < 3 || d.length > 253) return null;
  if (FREE_MAIL_DOMAINS.has(d)) return null;
  if (!/^[a-z0-9.-]+$/.test(d)) return null;
  return d;
}

/** Pick the band with the most matching contacts. Zero everywhere → unknown. */
export function pickBandFromCounts(rows: Array<{ band: Band; n: number }>): Band | null {
  const ranked = [...rows].sort((a, b) => b.n - a.n || GETLEADS_BANDS.indexOf(a.band) - GETLEADS_BANDS.indexOf(b.band));
  const best = ranked[0];
  return best && best.n > 0 ? best.band : null;
}

/** Map a raw headcount onto a getleads band label. */
export function bandFromHeadcount(n: number): Band | null {
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 10) return "1 to 10";
  if (n <= 50) return "11 to 50";
  if (n <= 200) return "51 to 200";
  if (n <= 500) return "201 to 500";
  if (n <= 1000) return "501 to 1000";
  if (n <= 5000) return "1001 to 5000";
  if (n <= 10000) return "5001 to 10000";
  return "10001+";
}

/** "51-200", "51 to 200 employees", "201–500". */
export function bandFromUnknownSize(raw: unknown): Band | null {
  if (typeof raw === "number") return bandFromHeadcount(raw);
  if (typeof raw !== "string") return null;
  const asBand = normalizeBand(raw);
  if (asBand) return asBand;
  const nums = raw.replace(/,/g, "").match(/\d+/g);
  if (!nums?.length) return null;
  if (nums.length >= 2) {
    const hi = Number(nums[1]);
    return bandFromHeadcount(hi);
  }
  if (/\+|plus|over|more/i.test(raw)) {
    const n = Number(nums[0]);
    return bandFromHeadcount(n + 1);
  }
  return bandFromHeadcount(Number(nums[0]));
}
