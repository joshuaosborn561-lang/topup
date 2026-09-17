import type { CountCall } from "./validate.js";

const WRITE = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do)\b/i;
const ALLOWED_SCHEMAS = new Set([
  "topup",
  "public",
  "lp",
  "gc",
  "client_peterson",
  "client_basco",
  "client_goliath",
  "client_parlay",
  "client_insight",
  "client_salesglider",
  "client_techevo",
  "client_bcp",
  "client_vasco",
]);

export type SqlRead = (sql: string) => Promise<{ rows: number; note: string }>;

export type CountFn = (filters: Record<string, unknown>) => Promise<{ total_matching: number }>;

export type ReasonTools = {
  sql_read: (query: string) => Promise<{ rows: number; note: string }>;
  getleads_count: (filters: Record<string, unknown>) => Promise<{ total_matching: number; call_id: string }>;
  aiark_count?: (filters: Record<string, unknown>) => Promise<{ total_matching: number; call_id: string }>;
  discolike_count?: (seed: string, filters: Record<string, unknown>) => Promise<{ total_matching: number; call_id: string }>;
  maps_estimate?: (plan: Record<string, unknown>) => Promise<{ companies: number; call_id: string }>;
  permitstack_count?: (filters: Record<string, unknown>) => Promise<{ total_matching: number; call_id: string }>;
};

export function assertSelectOnly(sql: string): string {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed) && !/^with\b/i.test(trimmed)) {
    throw new Error("sql_read is select-only");
  }
  if (WRITE.test(trimmed)) throw new Error("sql_read refused a write or DDL");
  const schemas = [...trimmed.matchAll(/\b([a-z][a-z0-9_]*)\./gi)].map((m) => m[1]!.toLowerCase());
  const bad = schemas.filter((s) => !ALLOWED_SCHEMAS.has(s));
  if (bad.length) throw new Error(`sql_read refused schema ${[...new Set(bad)].join(", ")}`);
  return trimmed;
}

export function recordCount(calls: CountCall[], kind: string, filters: Record<string, unknown>, total: number): CountCall {
  const call: CountCall = { id: `${kind}:${calls.length + 1}`, kind, filters, total };
  calls.push(call);
  return call;
}

export function reasonTools(input: {
  sql: (sql: string) => Promise<{ rows: number; note: string }>;
  getleads?: CountFn;
  aiark?: CountFn;
  discolike?: (seed: string, filters: Record<string, unknown>) => Promise<{ total_matching: number }>;
  maps?: (plan: Record<string, unknown>) => Promise<{ companies: number }>;
  permitstack?: CountFn;
  calls: CountCall[];
}): ReasonTools {
  return {
    sql_read: async (query) => input.sql(assertSelectOnly(query)),
    getleads_count: async (filters) => {
      if (!input.getleads) throw new Error("getleads_count is not wired");
      const r = await input.getleads(filters);
      return { total_matching: r.total_matching, call_id: recordCount(input.calls, "getleads_count", filters, r.total_matching).id };
    },
    ...(input.aiark
      ? {
          aiark_count: async (filters: Record<string, unknown>) => {
            const r = await input.aiark!(filters);
            return { total_matching: r.total_matching, call_id: recordCount(input.calls, "aiark_count", filters, r.total_matching).id };
          },
        }
      : {}),
    ...(input.discolike
      ? {
          discolike_count: async (seed: string, filters: Record<string, unknown>) => {
            const r = await input.discolike!(seed, filters);
            return { total_matching: r.total_matching, call_id: recordCount(input.calls, "discolike_count", { seed, ...filters }, r.total_matching).id };
          },
        }
      : {}),
    ...(input.maps
      ? {
          maps_estimate: async (plan: Record<string, unknown>) => {
            const r = await input.maps!(plan);
            return { companies: r.companies, call_id: recordCount(input.calls, "maps_estimate", plan, r.companies).id };
          },
        }
      : {}),
    ...(input.permitstack
      ? {
          permitstack_count: async (filters: Record<string, unknown>) => {
            const r = await input.permitstack!(filters);
            return { total_matching: r.total_matching, call_id: recordCount(input.calls, "permitstack_count", filters, r.total_matching).id };
          },
        }
      : {}),
  };
}
