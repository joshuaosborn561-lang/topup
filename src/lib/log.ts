/**
 * Structured logger that refuses to emit lead rows.
 *
 * Rule (brief section 8): no lead rows in chat, Slack, or logs. Data moves
 * server to server; humans see counts, job ids, statuses and spend. Every
 * log call passes through `redact`, which strips email addresses and any
 * object key that names a person or a lead field. The guard in
 * src/guards/lead_rows.test.ts asserts this behaviour so nobody can log a row
 * by accident (D2).
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Keys that identify a lead. Values under these keys are never logged. */
export const LEAD_FIELD_KEYS = new Set([
  "email",
  "first_name",
  "last_name",
  "first_name_n",
  "full_name",
  "name",
  "phone",
  "cellphone",
  "mobile",
  "linkedin_url",
  "linkedin_profile",
  "company_name",
  "company_n",
  "company_domain",
  "domain",
  "rows",
  "leads",
  "sample",
  "samples",
  "records",
  "items",
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") {
    return value.replace(EMAIL_RE, "[email]");
  }
  if (Array.isArray(value)) {
    // Arrays of objects are almost always rows. Log the count, not the rows.
    if (value.length > 0 && value.every((v) => v && typeof v === "object")) {
      return `[${value.length} rows redacted]`;
    }
    return value.map((v) => redact(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (LEAD_FIELD_KEYS.has(k.toLowerCase())) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, tag: string, msg: string, fields?: Record<string, unknown>): void {
  const line = {
    t: new Date().toISOString(),
    level,
    tag,
    msg: redact(msg),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export function logger(tag: string) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", tag, msg, fields),
    info: (msg: string, fields?: Record<string, unknown>) => emit("info", tag, msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", tag, msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => emit("error", tag, msg, fields),
  };
}

export type Logger = ReturnType<typeof logger>;
