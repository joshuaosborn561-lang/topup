/**
 * Net new is the lane TAM minus people in that TAM who are already held.
 * The client's whole contact count is not a stand-in for that overlap.
 */

export type HeldMethod = "overlap" | "sample" | "lane";

/** 1 overlap, 2 sample, 3 lane. Step counts are numbers. */
export function heldMethodCode(method: HeldMethod): number {
  if (method === "overlap") return 1;
  if (method === "sample") return 2;
  return 3;
}

export function netNewFromOverlap(tam: number, heldInTam: number): number {
  return Math.max(0, Math.floor(tam) - Math.max(0, Math.floor(heldInTam)));
}

/**
 * Campaigns that share one ICP repeat the same TAM. The lane total is that
 * number, not the sum. Different TAMs are different lists and are added.
 */
export function lanePeopleTam(tams: readonly number[]): number {
  if (tams.length === 0) return 0;
  const first = tams[0] ?? 0;
  if (tams.every((tam) => tam === first)) return first;
  return tams.reduce((sum, tam) => sum + tam, 0);
}

/**
 * A sample that covers the TAM is the overlap. A shorter sample is scaled.
 * `matched` is how many sample rows are already held.
 */
export function scaleOverlap(tam: number, sampleSize: number, matched: number): { held: number; method: "overlap" | "sample" } {
  const total = Math.max(0, Math.floor(tam));
  const size = Math.max(0, Math.floor(sampleSize));
  const hits = Math.max(0, Math.min(size, Math.floor(matched)));
  if (size === 0) return { held: 0, method: "sample" };
  if (size >= total) return { held: Math.min(total, hits), method: "overlap" };
  return { held: Math.min(total, Math.round((hits / size) * total)), method: "sample" };
}

/** Shares sum to `net` when the needs can absorb it, and never sum to more. */
export function planShares(net: number, needs: readonly number[]): number[] {
  const room = Math.max(0, Math.floor(net));
  const caps = needs.map((need) => Math.max(0, Math.floor(need)));
  const totalNeed = caps.reduce((sum, need) => sum + need, 0);
  if (caps.length === 0 || room === 0 || totalNeed === 0) return caps.map(() => 0);
  if (totalNeed <= room) return caps;
  const raw = caps.map((need) => (need / totalNeed) * room);
  const floors = raw.map((value) => Math.floor(value));
  let left = room - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] = (floors[item.index] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** Emails from an export page. The header must name an email column. */
export function emailsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase());
  const idx = header.findIndex((cell) => cell === "email" || cell === "work_email" || cell === "person_email");
  if (idx < 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines.slice(1)) {
    const email = (splitCsvLine(line)[idx] ?? "").trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
