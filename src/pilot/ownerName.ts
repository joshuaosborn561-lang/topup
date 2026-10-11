/**
 * Free, rule-based owner/founder extraction for the EMCOR lane E pilot
 * (2026-10-10). No LLM. No paid vendor. Counts go in the PR; names stay
 * in the scratch table / local artifact.
 */

export interface OwnerHit {
  name: string;
  title: string | null;
  pattern: string;
}

const NAME = "([A-Z][a-z]{1,20}(?:[\\s'\\-][A-Z][a-z]{1,20}){1,2})";
const TITLE = "([Oo]wner|[Cc]o-?[Oo]wner|[Ff]ounder|[Cc]o-?[Ff]ounder|[Pp]roprietor|[Pp]resident|[Mm]anaging [Pp]artner|[Pp]rincipal)";

const STOP = new Set([
  "about", "us", "our", "the", "team", "contact", "learn", "more", "click", "here",
  "welcome", "home", "privacy", "cookie", "book", "now", "call", "today", "schedule",
  "appointment", "read", "view", "meet", "staff", "family", "company", "business",
  "church", "clinic", "hotel", "owner", "founder", "president", "proprietor",
]);

const PATTERNS: Array<{ id: string; re: RegExp; name: number; title?: number | string }> = [
  { id: "founded_by", re: new RegExp(`[Ff]ounded\\s+[Bb]y\\s+${NAME}`, "g"), name: 1, title: "founder" },
  { id: "owned_by", re: new RegExp(`[Oo]wned\\s+[Bb]y\\s+${NAME}`, "g"), name: 1, title: "owner" },
  { id: "proprietor", re: new RegExp(`[Pp]roprietors?\\s*[:\\-–]?\\s+${NAME}`, "g"), name: 1, title: "proprietor" },
  { id: "meet_the_owner", re: new RegExp(`[Mm]eet(?:\\s+[Tt]he)?\\s+[Oo]wner\\s*[:\\-–]?\\s+${NAME}`, "g"), name: 1, title: "owner" },
  { id: "owner_colon", re: new RegExp(`\\b[Oo]wner\\s*[:\\-–]\\s*${NAME}`, "g"), name: 1, title: "owner" },
  { id: "co_founder", re: new RegExp(`[Cc]o-?[Ff]ounders?\\s*[:\\-–]?\\s+${NAME}`, "g"), name: 1, title: "co-founder" },
  { id: "name_comma_title", re: new RegExp(`${NAME}\\s*,\\s*${TITLE}`, "g"), name: 1, title: 2 },
  { id: "title_name", re: new RegExp(`\\b${TITLE}\\s+${NAME}`, "g"), name: 2, title: 1 },
  { id: "im_the_owner", re: new RegExp(`[Ii](?:'m| am)\\s+${NAME}\\s*,?\\s*(?:the\\s+)?${TITLE}`, "g"), name: 1, title: 2 },
];

const FIRST = "([A-Z][a-z]{1,20}(?:[\\s'\\-][A-Z][a-z]{1,20}){0,2})";

const REVIEW_PATTERNS: Array<{ id: string; re: RegExp; name: number; title?: number | string }> = [
  { id: "thanks_name_title", re: new RegExp(`(?:thanks|thank you|best|regards|sincerely)[,\\s]+${FIRST}\\s*,\\s*${TITLE}`, "gi"), name: 1, title: 2 },
  { id: "dash_name_owner", re: new RegExp(`[-–—~]\\s*${FIRST}\\s*,\\s*${TITLE}`, "gi"), name: 1, title: 2 },
  { id: "thanks_name", re: new RegExp(`(?:thanks|thank you)[,\\s]+${FIRST}\\s*$`, "gim"), name: 1, title: "owner" },
  { id: "response_from_owner", re: new RegExp(`response from the owner[:\\s]+${FIRST}`, "gi"), name: 1, title: "owner" },
];

function titleCaseName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().split(" ").map((p) =>
    p.replace(/[A-Za-z]+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()),
  ).join(" ");
}

export function normalizeOwnerName(raw: string, opts: { allowFirstOnly?: boolean } = {}): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  const parts = cleaned.split(" ");
  const min = opts.allowFirstOnly ? 1 : 2;
  if (parts.length < min || parts.length > 3) return null;
  if (parts.some((p) => STOP.has(p.toLowerCase()) || !/^[A-Z][A-Za-z]/.test(p))) return null;
  return titleCaseName(cleaned);
}

function titleOf(v: string | number | undefined, match: RegExpExecArray): string | null {
  if (v == null) return null;
  if (typeof v === "number") return (match[v] ?? "").toLowerCase().replace(/^coowner$/, "co-owner");
  return v;
}

function runPatterns(text: string, patterns: typeof PATTERNS, allowFirstOnly = false): OwnerHit[] {
  const hits: OwnerHit[] = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text))) {
      const name = normalizeOwnerName(m[p.name] ?? "", { allowFirstOnly });
      if (!name) continue;
      hits.push({ name, title: titleOf(p.title, m), pattern: p.id });
    }
  }
  return hits;
}

/** Strip tags / scripts so regex sees words. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function personName(node: unknown): string | null {
  if (typeof node === "string") return normalizeOwnerName(node);
  if (node && typeof node === "object") {
    const n = (node as { name?: unknown }).name;
    return typeof n === "string" ? normalizeOwnerName(n) : null;
  }
  return null;
}

function personTitle(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const t = (node as { jobTitle?: unknown; role?: unknown }).jobTitle
    ?? (node as { role?: unknown }).role;
  return typeof t === "string" && t.trim() ? t.trim().slice(0, 40) : null;
}

function walkJsonLd(node: unknown, hits: OwnerHit[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) walkJsonLd(x, hits);
    return;
  }
  const o = node as Record<string, unknown>;
  const type = String(o["@type"] ?? "").toLowerCase();
  for (const key of ["founder", "founders", "owner", "employee"]) {
    for (const person of asArray(o[key])) {
      const name = personName(person);
      if (name) hits.push({ name, title: personTitle(person) ?? (key === "founder" || key === "founders" ? "founder" : key === "owner" ? "owner" : null), pattern: `jsonld_${key}` });
    }
  }
  if (type.includes("person")) {
    const name = personName(o);
    const title = personTitle(o);
    if (name && title && /owner|founder|proprietor|president/i.test(title)) {
      hits.push({ name, title: title.toLowerCase(), pattern: "jsonld_person" });
    }
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") walkJsonLd(v, hits);
  }
}

export function extractJsonLd(html: string): OwnerHit[] {
  const hits: OwnerHit[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      walkJsonLd(JSON.parse(m[1] ?? "null"), hits);
    } catch {
      /* ignore broken json-ld */
    }
  }
  return hits;
}

export function extractMicrodata(html: string): OwnerHit[] {
  const hits: OwnerHit[] = [];
  const blocks = html.match(/itemprop=["'](?:founder|owner)["'][^>]*>[\s\S]{0,400}?<(?:\/span|\/a|\/div)/gi) ?? [];
  for (const b of blocks) {
    const name = personName((b.match(/itemprop=["']name["'][^>]*>([^<]+)/i) ?? [])[1] ?? "");
    if (name) hits.push({ name, title: /founder/i.test(b) ? "founder" : "owner", pattern: "microdata" });
  }
  return hits;
}

/** Best website hit: json-ld first, then the first regex/microdata match. */
export function extractOwnerFromHtml(html: string): OwnerHit | null {
  const json = extractJsonLd(html);
  if (json[0]) return json[0];
  const micro = extractMicrodata(html);
  if (micro[0]) return micro[0];
  const text = htmlToText(html);
  return runPatterns(text, PATTERNS)[0] ?? null;
}

export function extractOwnerFromReviewText(text: string): OwnerHit | null {
  return runPatterns(text, REVIEW_PATTERNS, true)[0] ?? null;
}

/**
 * Typical Maps-scraper review shapes (Apify / compass). Looks for owner
 * reply text or an owner author. Does not call a vendor.
 */
export function extractOwnerFromReviewsPayload(raw: unknown): OwnerHit | null {
  if (raw == null) return null;
  if (typeof raw === "number" || (typeof raw === "string" && /^\s*\d+\s*$/.test(raw))) return null;
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return extractOwnerFromReviewText(raw);
    }
  }
  const texts: string[] = [];
  const walk = (v: unknown): void => {
    if (!v) return;
    if (typeof v === "string") {
      if (v.length > 8) texts.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const ownerish = ["ownerAnswer", "owner_answer", "ownerReply", "owner_reply", "ownerResponse", "responseFromOwner"];
      for (const k of ownerish) {
        if (o[k]) walk(o[k]);
      }
      if (typeof o.text === "string" && /owner/i.test(String(o.author ?? o.authorName ?? o.name ?? ""))) {
        texts.push(o.text);
      }
      if (typeof o.name === "string" && /owner/i.test(String(o.role ?? o.title ?? ""))) {
        const n = normalizeOwnerName(o.name);
        if (n) texts.push(`- ${n}, Owner`);
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  walk(data);
  for (const t of texts) {
    const hit = extractOwnerFromReviewText(t);
    if (hit) return hit;
  }
  return null;
}

export function namesAgree(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  const na = a.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  const nb = b.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (na === nb) return true;
  const as = na.split(/\s+/);
  const bs = nb.split(/\s+/);
  return as[0] === bs[0] && as[as.length - 1] === bs[bs.length - 1];
}

export const COMMON_OWNER_PATHS = [
  "/about",
  "/about-us",
  "/about.html",
  "/our-story",
  "/ourstory",
  "/team",
  "/our-team",
  "/meet-the-owner",
  "/meet-the-team",
  "/contact",
  "/contact-us",
  "/founder",
];

const DISCOVER_RE = /\b(about|our-story|ourstory|team|meet-the-owner|meet-the-team|contact|founder|our-team|about-us)\b/i;

export function discoverOwnerLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1] ?? "";
    if (!DISCOVER_RE.test(href) && !DISCOVER_RE.test(m[0])) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (abs.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    const key = abs.origin + abs.pathname.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs.toString());
  }
  return out;
}

export function originOf(website: string): URL | null {
  try {
    const u = new URL(website.includes("://") ? website : `https://${website}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}
