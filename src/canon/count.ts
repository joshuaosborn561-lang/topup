import type { Getleads, GetleadsFilters } from "../clients/getleads.js";
import type { MapsStats } from "../clients/mapsStats.js";
import type { PermitCounts } from "../clients/permits.js";
import { getleadsParamsFromFilters } from "../recipes/infer.js";
import type { SpendRails } from "../spend/rails.js";
import { MIN_NET_NEW } from "../policy/rules.js";

/**
 * A count on one source with the filters Grok supplies (D52). The service
 * sends the call, logs it and reports the number and the cost. It does not
 * decide whether the number is enough; the rule is stated on the answer
 * and Grok applies it. An AI Ark count costs money and needs an approver.
 */
export type CountSource = "getleads" | "ai_ark" | "maps" | "permits";

export interface CountDeps {
  getleads: Getleads;
  aiArk: { count(filters: GetleadsFilters): Promise<{ total_matching: number }> } | null;
  maps: MapsStats | null;
  permits: PermitCounts | null;
  rails: SpendRails;
}

export interface CountCall {
  vendor: string;
  action: string;
  ok: boolean;
  count: number | null;
  message: string | null;
}

export interface CountRead {
  source: CountSource;
  filters_used: Record<string, unknown>;
  count: number | null;
  calls: CountCall[];
  cost_cents: number;
  rule: string;
  note: string | null;
}

export const COUNT_RULE = `This is the total available on the source for these filters, before what the client already holds. Subtract held, then: under ${MIN_NET_NEW} more, the TAM for this campaign is exhausted.`;

function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}

export async function countSource(
  d: CountDeps,
  input: { client_tag: string; source: CountSource; filters: Record<string, unknown>; approved_by?: string | null },
): Promise<CountRead> {
  const calls: CountCall[] = [];
  const base = { source: input.source, calls, rule: COUNT_RULE };
  switch (input.source) {
    case "getleads": {
      const params = getleadsParamsFromFilters(input.filters);
      if (!params) return { ...base, filters_used: input.filters, count: null, cost_cents: 0, note: "getleads needs job_titles, or job_function plus seniority; company_size as band labels when given." };
      const { max_per_company: _cap, ...countFilters } = params as GetleadsFilters & { max_per_company?: number };
      try {
        const r = await d.getleads.count(countFilters as GetleadsFilters);
        calls.push({ vendor: "getleads", action: "count_contacts", ok: true, count: r.total_matching, message: null });
        return { ...base, filters_used: countFilters, count: r.total_matching, cost_cents: 0, note: r.exportable_rows != null && r.exportable_rows !== r.total_matching ? `exportable_rows ${r.exportable_rows}` : null };
      } catch (err) {
        calls.push({ vendor: "getleads", action: "count_contacts", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
        return { ...base, filters_used: countFilters, count: null, cost_cents: 0, note: "getleads count failed; see calls" };
      }
    }
    case "ai_ark": {
      const params = getleadsParamsFromFilters(input.filters);
      if (!params) return { ...base, filters_used: input.filters, count: null, cost_cents: 0, note: "AI Ark takes the same filters as getleads: job_titles, company_size, countries, industries." };
      if (!d.aiArk) return { ...base, filters_used: params, count: null, cost_cents: 0, note: "AI_ARK_TOKEN is not set on the service." };
      const decision = await d.rails.gate({ runId: "canon", clientTag: input.client_tag, step: "size", vendor: "aiark", action: "people_preview", rows: 1, recipeAuthorised: true, approvedCents: input.approved_by ? 100 : 0 });
      if (decision.kind !== "proceed") {
        calls.push({ vendor: "aiark", action: "people_preview", ok: false, count: null, message: decision.reason });
        return { ...base, filters_used: params, count: null, cost_cents: 0, note: `Not sent: ${decision.reason}. An AI Ark count costs about five cents; pass approved_by with the name of the person who said yes.` };
      }
      try {
        const r = await d.aiArk.count(params as GetleadsFilters);
        calls.push({ vendor: "aiark", action: "people_preview", ok: true, count: r.total_matching, message: null });
        await d.rails.record({ runId: null, clientTag: input.client_tag, step: "size", vendor: "aiark", action: "people_preview", rows: 0, credits: 1, worstCaseCents: decision.worstCaseCents, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: input.approved_by ?? null }).catch(() => undefined);
        return { ...base, filters_used: params, count: r.total_matching, cost_cents: decision.worstCaseCents, note: null };
      } catch (err) {
        calls.push({ vendor: "aiark", action: "people_preview", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
        return { ...base, filters_used: params, count: null, cost_cents: 0, note: "AI Ark count failed; see calls" };
      }
    }
    case "maps": {
      const categories = strings(input.filters.categories ?? input.filters.maps ?? input.filters.category);
      const states = strings(input.filters.states);
      if (!d.maps) return { ...base, filters_used: { categories, states }, count: null, cost_cents: 0, note: "MAPS_MCP_URL is not set on the service." };
      if (categories.length === 0) return { ...base, filters_used: input.filters, count: null, cost_cents: 0, note: "maps needs categories." };
      let total = 0;
      for (const category of categories) {
        for (const state of states.length ? states : [undefined]) {
          try {
            const n = await d.maps.scopedBusinesses({ category, ...(state ? { state } : {}), clientTag: input.client_tag });
            calls.push({ vendor: "maps", action: "pipeline_stats", ok: true, count: n, message: `${category}${state ? ` / ${state}` : ""}` });
            total += n;
          } catch (err) {
            calls.push({ vendor: "maps", action: "pipeline_stats", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
          }
        }
      }
      return { ...base, filters_used: { categories, states }, count: calls.some((c) => c.ok) ? total : null, cost_cents: 0, note: "the stored Maps pool for this client; a fresh scrape is the Google Maps Scraper MCP" };
    }
    case "permits": {
      const types = strings(input.filters.permit_types ?? input.filters.permits ?? input.filters.permit_type);
      const states = strings(input.filters.states);
      if (!d.permits) return { ...base, filters_used: { permit_types: types, states }, count: null, cost_cents: 0, note: "PERMITSTACK_MCP_URL is not set on the service." };
      if (types.length === 0 || states.length === 0) return { ...base, filters_used: input.filters, count: null, cost_cents: 0, note: "permits needs permit_types and states." };
      let total = 0;
      for (const category of types) {
        for (const state of states) {
          try {
            const m = await d.permits.monthlyTotal({ category, state });
            const n = Number((m as unknown as { total?: number; count?: number }).total ?? (m as unknown as { count?: number }).count ?? 0);
            calls.push({ vendor: "permitstack", action: "metrics_monthly", ok: true, count: n, message: `${category} / ${state}` });
            total += n;
          } catch (err) {
            calls.push({ vendor: "permitstack", action: "metrics_monthly", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
          }
        }
      }
      return { ...base, filters_used: { permit_types: types, states }, count: calls.some((c) => c.ok) ? total : null, cost_cents: 0, note: "permits in the last month on PermitStack; the stored pool is in the client's permit tables" };
    }
  }
}
