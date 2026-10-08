import type { GetleadsFilters } from "./getleads.js";

/**
 * AI Ark People Preview (docs.ai-ark.com people-preview). One credit per page.
 * `size: 1` and `page: 0` is the count. Read `totalElements` and drop the page.
 * Unknown keys are not sent: AI Ark returns HTTP 200 and an unfiltered count
 * when a key is one it does not know.
 */
export const AI_ARK_PREVIEW_URL = "https://api.ai-ark.com/api/developer-portal/v1/people/preview";

/** Written on the size step when the service has no key. No request is sent. */
export const AI_ARK_TOKEN_MISSING =
  "AI_ARK_TOKEN is not set. No request was sent. Endpoint POST https://api.ai-ark.com/api/developer-portal/v1/people/preview. Header X-TOKEN.";

/** Recipe seniority labels to the twelve values People Preview allows. */
const SENIORITY: Readonly<Record<string, string>> = {
  "c-team": "c_suite",
  "c team": "c_suite",
  "c-suite": "c_suite",
  c_suite: "c_suite",
  vp: "vp",
  director: "director",
  head: "head",
  manager: "manager",
  founder: "founder",
  owner: "owner",
  partner: "partner",
  senior: "senior",
  "mid-level": "mid-level",
  entry: "entry",
  intern: "intern",
};

/**
 * getleads job_function to a value in departments-and-functions.csv.
 * Anything else is left unmapped so the count is not silently widened.
 */
const JOB_FUNCTION: Readonly<Record<string, string>> = {
  operations: "operations",
  "information technology": "information_technology",
};

/** Closed getleads bands. The open "10001+" band has no documented end, so it is not sent. */
const BANDS: Readonly<Record<string, { start: number; end: number }>> = {
  "1 to 10": { start: 1, end: 10 },
  "11 to 50": { start: 11, end: 50 },
  "51 to 200": { start: 51, end: 200 },
  "201 to 500": { start: 201, end: 500 },
  "501 to 1000": { start: 501, end: 1000 },
  "1001 to 5000": { start: 1001, end: 5000 },
  "5001 to 10000": { start: 5001, end: 10000 },
};

export type PreviewBody = {
  page: 0;
  size: 1;
  account?: Record<string, unknown>;
  contact?: Record<string, unknown>;
};

export type PreviewBuild = { ok: true; body: PreviewBody } | { ok: false; reason: string };

function locations(filters: GetleadsFilters): string[] | null {
  if (filters.cities?.length) return [...filters.cities];
  if (filters.states?.length) return [...filters.states];
  if (filters.countries?.length) return [...filters.countries];
  return [];
}

/**
 * The People Search body for these getleads filters. A filter this schema
 * cannot express returns ok: false. The caller must not send a partial body.
 */
export function peoplePreviewBody(filters: GetleadsFilters): PreviewBuild {
  if (filters.geo_fence) {
    return { ok: false, reason: "AI Ark People Preview is not called for a geo fence; the city list is not on this filter" };
  }
  const account: Record<string, unknown> = {};
  const contact: Record<string, unknown> = {};

  if (filters.company_size?.length) {
    const range = [];
    for (const band of filters.company_size) {
      const mapped = BANDS[band];
      if (!mapped) return { ok: false, reason: `headcount band ${band} has no AI Ark employeeSize range` };
      range.push(mapped);
    }
    account.employeeSize = { type: "RANGE", range };
  }

  const where = locations(filters);
  if (where == null) return { ok: false, reason: "location could not be mapped" };
  if (where.length) account.location = { any: { include: where } };

  if (filters.industries?.length) {
    account.industries = {
      any: { include: { mode: "WORD", content: filters.industries.map((name) => name.toLowerCase()) } },
    };
  }

  if (filters.company_description) {
    const content = filters.company_description
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (content.length) {
      account.keyword = {
        any: { include: { sources: [{ mode: "WORD", source: "DESCRIPTION" }], content } },
      };
    }
  }

  if (filters.job_titles?.length) {
    contact.experience = {
      latest: { title: { any: { include: { mode: "STRICT", content: [...filters.job_titles] } } } },
    };
  }

  if (filters.seniority?.length) {
    const include = [];
    for (const label of filters.seniority) {
      const mapped = SENIORITY[label.trim().toLowerCase()];
      if (!mapped) return { ok: false, reason: `seniority ${label} is not an AI Ark seniority value` };
      include.push(mapped);
    }
    contact.seniority = { any: { include } };
  }

  if (filters.job_function) {
    const mapped = JOB_FUNCTION[filters.job_function.trim().toLowerCase()];
    if (!mapped) return { ok: false, reason: `job_function ${filters.job_function} has no AI Ark departmentAndFunction value` };
    contact.departmentAndFunction = { any: { include: [mapped] } };
  }

  const body: PreviewBody = { page: 0, size: 1 };
  if (Object.keys(account).length) body.account = account;
  if (Object.keys(contact).length) body.contact = contact;
  return { ok: true, body };
}

function previewErrorDetail(text: string): string {
  const clipped = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").slice(0, 400);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const bits = ["message", "error", "status", "code", "detail"].flatMap((key) =>
      parsed[key] == null ? [] : [`${key}: ${String(parsed[key]).slice(0, 160)}`],
    );
    return bits.join("; ") || `keys ${Object.keys(parsed).filter((key) => key !== "content").slice(0, 8).join(", ") || "none"}`;
  } catch {
    return clipped;
  }
}

export interface AiArkPreview {
  count(filters: GetleadsFilters): Promise<{ total_matching: number }>;
}

export class AiArkPreviewClient implements AiArkPreview {
  constructor(
    private readonly token: string,
    private readonly url = AI_ARK_PREVIEW_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async count(filters: GetleadsFilters): Promise<{ total_matching: number }> {
    if (!this.token) throw new Error(AI_ARK_TOKEN_MISSING);
    const built = peoplePreviewBody(filters);
    if (!built.ok) throw new Error(built.reason);
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-TOKEN": this.token },
      body: JSON.stringify(built.body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.url}: ${previewErrorDetail(text)}`);
    let json: { totalElements?: unknown };
    try {
      json = JSON.parse(text) as { totalElements?: unknown };
    } catch {
      throw new Error(`HTTP ${res.status} from ${this.url}: response was not JSON`);
    }
    const total = Number(json.totalElements);
    if (!Number.isFinite(total)) {
      const keys = Object.keys(json).slice(0, 12).join(", ") || "none";
      throw new Error(`HTTP ${res.status} from ${this.url}: no totalElements. Keys: ${keys}`);
    }
    return { total_matching: total };
  }
}
