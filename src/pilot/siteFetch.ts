/**
 * Polite homepage fetch for the owner-name pilot. Respects robots.txt,
 * times out, stays on the same host. No paid proxy. No Apify.
 */

import { COMMON_OWNER_PATHS, discoverOwnerLinks, originOf } from "./ownerName.js";

export const PILOT_UA = "LeadtopupOwnerPilot/1.0 (+https://github.com/joshuaosborn561-lang/topup; research)";
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_PAGES_PER_SITE = 6;
export const HOST_GAP_MS = 400;
export const MAX_HTML_BYTES = 800_000;

export interface FetchedPage {
  url: string;
  status: number;
  html: string | null;
  error: string | null;
}

export interface RobotsRules {
  fetched: boolean;
  allowAll: boolean;
  disallows: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function pathAllowed(pathname: string, robots: RobotsRules): boolean {
  if (robots.allowAll) return true;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  for (const d of robots.disallows) {
    if (d === "/") return false;
    if (path === d || path.startsWith(d.endsWith("/") ? d : `${d}/`)) return false;
  }
  return true;
}

/** Parse User-agent: * Disallow lines. Empty / missing robots → allow. */
export function parseRobots(body: string): RobotsRules {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  let inStar = false;
  const disallows: string[] = [];
  let sawStar = false;
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [k, ...rest] = line.split(":");
    const key = (k ?? "").toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      inStar = val === "*";
      if (inStar) sawStar = true;
      continue;
    }
    if (inStar && key === "disallow" && val) disallows.push(val);
  }
  if (!sawStar) return { fetched: true, allowAll: true, disallows: [] };
  if (disallows.includes("/")) return { fetched: true, allowAll: false, disallows: ["/"] };
  return { fetched: true, allowAll: disallows.length === 0, disallows };
}

export async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchedPage> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: c.signal,
      headers: { "User-Agent": PILOT_UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1" },
    });
    if (!res.ok) return { url, status: res.status, html: null, error: `http_${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_HTML_BYTES) {
      return { url, status: res.status, html: buf.subarray(0, MAX_HTML_BYTES).toString("utf8"), error: "truncated" };
    }
    return { url, status: res.status, html: buf.toString("utf8"), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, status: 0, html: null, error: message.slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

const robotsCache = new Map<string, RobotsRules>();
const lastHostHit = new Map<string, number>();

async function pace(host: string): Promise<void> {
  const last = lastHostHit.get(host) ?? 0;
  const wait = HOST_GAP_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastHostHit.set(host, Date.now());
}

export async function robotsFor(origin: URL): Promise<RobotsRules> {
  const key = origin.origin;
  const cached = robotsCache.get(key);
  if (cached) return cached;
  await pace(origin.hostname);
  const page = await fetchText(new URL("/robots.txt", origin).toString(), 5_000);
  const rules = page.html ? parseRobots(page.html) : { fetched: false, allowAll: true, disallows: [] };
  robotsCache.set(key, rules);
  return rules;
}

export async function fetchSitePages(website: string): Promise<FetchedPage[]> {
  const origin = originOf(website);
  if (!origin) return [{ url: website, status: 0, html: null, error: "bad_url" }];
  const robots = await robotsFor(origin);
  if (!pathAllowed("/", robots) && robots.disallows.includes("/")) {
    return [{ url: origin.toString(), status: 0, html: null, error: "robots_disallow_all" }];
  }
  const pages: FetchedPage[] = [];
  const queued: string[] = [origin.toString()];
  for (const p of COMMON_OWNER_PATHS) queued.push(new URL(p, origin).toString());
  const seen = new Set<string>();
  for (const url of queued) {
    if (pages.length >= MAX_PAGES_PER_SITE) break;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    const key = u.origin + u.pathname.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (!pathAllowed(u.pathname, robots)) continue;
    await pace(u.hostname);
    const page = await fetchText(u.toString());
    pages.push(page);
    if (page.html && pages.length === 1) {
      for (const extra of discoverOwnerLinks(page.html, origin)) {
        if (queued.length > 20) break;
        queued.push(extra);
      }
    }
  }
  return pages;
}
