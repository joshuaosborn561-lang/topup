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
  page: number;
  size: number;
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
export function peoplePreviewBody(filters: GetleadsFilters, page = 0, size = 1): PreviewBuild {
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

  const body: PreviewBody = { page, size: Math.max(1, Math.min(100, Math.floor(size))) };
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

/** A preview person with the fields the pilot scorer reads. No address, no name. */
export interface PreviewPerson {
  title: string;
  industry: string;
  description: string;
  company_size: string;
  employees: number | null;
  country: string;
  state: string;
  city: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  const rec = asRecord(value);
  if (!rec) return "";
  return textOf(rec.name ?? rec.title ?? rec.content ?? rec.label);
}

function employeesOf(company: Record<string, unknown>): number | null {
  const raw = company.employeeCount ?? company.employees ?? company.staffCount ?? company.headcount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Map a People Preview page to scorer fields. The page itself is not returned. */
export function previewPeople(content: unknown): PreviewPerson[] {
  const list = Array.isArray(content) ? content : [];
  const out: PreviewPerson[] = [];
  for (const item of list) {
    const person = asRecord(item);
    if (!person) continue;
    const company = asRecord(person.company) ?? asRecord(person.account) ?? {};
    const location = asRecord(person.location) ?? asRecord(company.location) ?? {};
    const experience = asRecord(person.experience);
    const latest = asRecord(experience?.latest);
    const titleNode = asRecord(latest?.title);
    out.push({
      title: textOf(person.title) || textOf(person.headline) || textOf(titleNode?.content) || textOf(latest?.title),
      industry: textOf(company.industry) || textOf(company.industries),
      description: textOf(company.description) || textOf(company.summary) || textOf(company.about),
      company_size: textOf(company.employeeSize) || textOf(company.headcount),
      employees: employeesOf(company),
      country: textOf(location.country) || textOf(person.country),
      state: textOf(location.state) || textOf(person.state),
      city: textOf(location.city) || textOf(person.city),
    });
  }
  return out;
}

/** Titles, seniority, industries, bands, geography and description words, for the size report. */
export function previewFilterWords(filters: GetleadsFilters): string {
  const built = peoplePreviewBody(filters);
  if (!built.ok) return built.reason;
  const bits: string[] = [];
  const account = built.body.account ?? {};
  const contact = built.body.contact ?? {};
  const titles = (((contact.experience as { latest?: { title?: { any?: { include?: { content?: string[] } } } } } | undefined)?.latest?.title?.any?.include?.content) ?? []);
  if (titles.length) bits.push(`titles ${titles.join(", ")}`);
  const seniority = (contact.seniority as { any?: { include?: string[] } } | undefined)?.any?.include;
  if (seniority?.length) bits.push(`seniority ${seniority.join(", ")}`);
  const fn = (contact.departmentAndFunction as { any?: { include?: string[] } } | undefined)?.any?.include;
  if (fn?.length) bits.push(`function ${fn.join(", ")}`);
  const industries = (account.industries as { any?: { include?: { content?: string[] } } } | undefined)?.any?.include?.content;
  if (industries?.length) bits.push(`industries ${industries.join(", ")}`);
  const bands = (account.employeeSize as { range?: Array<{ start: number; end: number }> } | undefined)?.range;
  if (bands?.length) bits.push(`headcount ${bands.map((b) => `${b.start}-${b.end}`).join(", ")}`);
  const where = (account.location as { any?: { include?: string[] } } | undefined)?.any?.include;
  if (where?.length) bits.push(`geography ${where.join(", ")}`);
  const words = (account.keyword as { any?: { include?: { content?: string[] } } } | undefined)?.any?.include?.content;
  if (words?.length) bits.push(`description ${words.join(", ")}`);
  return bits.join("; ") || "no mapped filters";
}

export interface AiArkPreview {
  count(filters: GetleadsFilters): Promise<{ total_matching: number }>;
  preview?(filters: GetleadsFilters, page: number, size: number): Promise<{ total_matching: number; rows: PreviewPerson[] }>;
}

export class AiArkPreviewClient implements AiArkPreview {
  constructor(
    private readonly token: string,
    private readonly url = AI_ARK_PREVIEW_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(body: PreviewBody): Promise<{ total: number; content: unknown }> {
    if (!this.token) throw new Error(AI_ARK_TOKEN_MISSING);
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-TOKEN": this.token },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.url}: ${previewErrorDetail(text)}`);
    let json: { totalElements?: unknown; content?: unknown };
    try {
      json = JSON.parse(text) as { totalElements?: unknown; content?: unknown };
    } catch {
      throw new Error(`HTTP ${res.status} from ${this.url}: response was not JSON`);
    }
    const total = Number(json.totalElements);
    if (!Number.isFinite(total)) {
      const keys = Object.keys(json).slice(0, 12).join(", ") || "none";
      throw new Error(`HTTP ${res.status} from ${this.url}: no totalElements. Keys: ${keys}`);
    }
    return { total, content: json.content };
  }

  async count(filters: GetleadsFilters): Promise<{ total_matching: number }> {
    const built = peoplePreviewBody(filters, 0, 1);
    if (!built.ok) throw new Error(built.reason);
    const page = await this.post(built.body);
    return { total_matching: page.total };
  }

  /** One page of masked people for the pilot. The raw page is dropped after mapping. */
  async preview(filters: GetleadsFilters, page: number, size: number): Promise<{ total_matching: number; rows: PreviewPerson[] }> {
    const built = peoplePreviewBody(filters, page, size);
    if (!built.ok) throw new Error(built.reason);
    const result = await this.post(built.body);
    return { total_matching: result.total, rows: previewPeople(result.content) };
  }
}
