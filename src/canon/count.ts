import { outboundFilters, type Getleads, type GetleadsFilters } from "../clients/getleads.js";
import type { MapsStats } from "../clients/mapsStats.js";
import type { PermitCounts } from "../clients/permits.js";
import type { Queryable } from "../db/pool.js";
import { filtersApplied, getleadsParamsFromFilters, honorReceiptCountKeys } from "../jobs/filters.js";
import type { ProspeoIndustryMapping } from "../jobs/prospeoIndustries.js";
import { countMapsPool, MAPS_POOL_NOTE, mapsPoolFiltersUsed, mapsPoolFromFilters } from "./mapsPool.js";
import { searchPersonBody, type ProspeoSearch } from "./prospeoSearch.js";
import type { SpendRails } from "../spend/rails.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import { MIN_NET_NEW } from "../policy/rules.js";

/**
 * A count on one source with the filters Grok supplies (D52). The service
 * sends the call, logs it and reports the number and the cost. It does not
 * decide whether the number is enough; the rule is stated on the answer
 * and Grok applies it. An AI Ark count costs money and needs an approver.
 */
export type CountSource = "getleads" | "ai_ark" | "prospeo" | "maps" | "permits";

export interface CountDeps {
  getleads: Getleads;
  aiArk: { count(filters: GetleadsFilters): Promise<{ total_matching: number }> } | null;
  prospeo: ProspeoSearch | null;
  maps: MapsStats | null;
  permits: PermitCounts | null;
  rails: SpendRails;
  /** Required for source=maps: the stored pool lives in this project. */
  db?: Queryable | null;
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
  /** Every filter that actually ran, including rewritten keys (D95). */
  filters_applied: Record<string, unknown>;
  count: number | null;
  /** Maps stored pool: size after plan_id / categories / ICP view. */
  pool?: number;
  already_used?: number;
  already_live?: number;
  already_ingested?: number;
  already_contacted?: number;
  net_new?: number;
  calls: CountCall[];
  cost_cents: number;
  /** Worst-case cents before a paid call. Set on the estimate when approved_by is missing. */
  estimate_cents?: number;
  /** D83: each ICP industry and how it mapped onto Prospeo's official list. */
  industry_mappings?: ProspeoIndustryMapping[];
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
  input: {
    client_tag: string;
    source: CountSource;
    filters: Record<string, unknown>;
    approved_by?: string | null;
    campaign_id?: number | null;
  },
): Promise<CountRead> {
  const calls: CountCall[] = [];
  const base = { source: input.source, calls, rule: COUNT_RULE };
  const campaignName =
    input.campaign_id != null && d.db
      ? await campaignNameBySmartleadId(d.db, Number(input.campaign_id)).catch(() => null)
      : null;
  const honored = honorReceiptCountKeys(input.filters, input.campaign_id, campaignName);
  if (!honored.ok) return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, note: honored.error };
  const filters = honored.filters;
  const withHonored = (used: Record<string, unknown>): Record<string, unknown> => ({ ...used, ...honored.honored });
  switch (input.source) {
    case "getleads": {
      const parsed = getleadsParamsFromFilters(filters, input.campaign_id, campaignName);
      if (!parsed.ok) return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, note: parsed.error };
      const { max_per_company: cap, email_status: _tamEmail, ...countFilters } = parsed.params;
      const outbound = outboundFilters(countFilters as GetleadsFilters);
      const used = withHonored(outbound);
      const applied = filtersApplied(parsed.params, used, honored.honored);
      try {
        const r = await d.getleads.count(countFilters as GetleadsFilters);
        calls.push({ vendor: "getleads", action: "count_contacts", ok: true, count: r.total_matching, message: null });
        const bits = [
          r.exportable_rows != null && r.exportable_rows !== r.total_matching ? `exportable_rows ${r.exportable_rows}` : null,
          cap != null ? `max_per_company ${cap} honored (D84).` : null,
          parsed.params.title_match === "substring"
            ? "title_match substring as the receipt asked (D82)."
            : applied.where_sql
              ? "titles exact via lower(current_title) IN (D82)."
              : null,
          _tamEmail?.length ? "email_status omitted (VALID is not a TAM cap; D77)." : null,
        ].filter((s): s is string => Boolean(s));
        return { ...base, filters_used: used, filters_applied: applied, count: r.total_matching, cost_cents: 0, note: bits.length ? bits.join(" ") : null };
      } catch (err) {
        calls.push({ vendor: "getleads", action: "count_contacts", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
        return { ...base, filters_used: used, filters_applied: applied, count: null, cost_cents: 0, note: "getleads count failed; see calls" };
      }
    }
    case "ai_ark": {
      const parsed = getleadsParamsFromFilters(filters, input.campaign_id, campaignName);
      if (!parsed.ok) return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, note: parsed.error };
      const params = parsed.params;
      const used = withHonored({ ...params } as Record<string, unknown>);
      if (!d.aiArk) return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: "AI_ARK_TOKEN is not set on the service." };
      const decision = await d.rails.gate({ runId: "canon", clientTag: input.client_tag, step: "size", vendor: "aiark", action: "people_preview", rows: 1, recipeAuthorised: true, approvedCents: input.approved_by ? 100 : 0 });
      if (decision.kind !== "proceed") {
        calls.push({ vendor: "aiark", action: "people_preview", ok: false, count: null, message: decision.reason });
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: `Not sent: ${decision.reason}. An AI Ark count costs about five cents; pass approved_by with the name of the person who said yes.` };
      }
      try {
        const r = await d.aiArk.count(params as GetleadsFilters);
        calls.push({ vendor: "aiark", action: "people_preview", ok: true, count: r.total_matching, message: null });
        await d.rails.record({ runId: null, clientTag: input.client_tag, step: "size", vendor: "aiark", action: "people_preview", rows: 0, credits: 1, worstCaseCents: decision.worstCaseCents, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: input.approved_by ?? null }).catch(() => undefined);
        const titleNote =
          parsed.params.title_match === "substring"
            ? "AI Ark title mode WORD (substring as the receipt asked; D82)."
            : "AI Ark title mode STRICT (exact-title match; D82).";
        return { ...base, filters_used: used, filters_applied: used, count: r.total_matching, cost_cents: decision.worstCaseCents, note: titleNote };
      } catch (err) {
        calls.push({ vendor: "aiark", action: "people_preview", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: "AI Ark count failed; see calls" };
      }
    }
    case "prospeo": {
      const parsed = getleadsParamsFromFilters(filters, input.campaign_id, campaignName);
      if (!parsed.ok) return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, note: parsed.error };
      const { max_per_company: cap, ...countFilters } = parsed.params;
      const rawIndustries = strings(filters.industries ?? filters.companyIndustry);
      const built = searchPersonBody(countFilters as GetleadsFilters, rawIndustries);
      const mappings = built.industry_mappings;
      const flagNote = mappings
        .filter((m) => m.match !== "exact")
        .map((m) => (m.match === "none" ? `${m.input} has no Prospeo match` : `${m.input} → ${m.prospeo}`))
        .join("; ");
      const capNote = cap != null ? `max_per_company ${cap} honored (D84); search-person does not apply it (count is uncapped).` : null;
      if (!built.ok) {
        return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, industry_mappings: mappings, note: built.reason };
      }
      const used = {
        ...withHonored(built.filters_used),
        ...(built.filters_used.industries ? { industries: built.filters_used.industries } : {}),
      };
      if (!d.prospeo) {
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, industry_mappings: mappings, note: "PROSPEO_API_KEY is not set on the service." };
      }
      const decision = await d.rails.gate({
        runId: "canon",
        clientTag: input.client_tag,
        step: "size",
        vendor: "prospeo_search",
        action: "search_person",
        rows: 1,
        recipeAuthorised: true,
        approvedCents: input.approved_by ? 100 : 0,
      });
      const estimateBits = [
        "Page 1 of search-person is 1 credit (about 1.5 cents); no-result and 30-day repeats are free.",
        flagNote ? `Inexact industry mappings: ${flagNote}.` : null,
        capNote,
      ].filter((s): s is string => Boolean(s));
      if (decision.kind !== "proceed") {
        calls.push({ vendor: "prospeo", action: "search_person", ok: false, count: null, message: decision.reason });
        return {
          ...base,
          filters_used: used, filters_applied: used,
          count: null,
          cost_cents: 0,
          estimate_cents: decision.worstCaseCents,
          industry_mappings: mappings,
          note: `Not sent: ${decision.reason}. ${estimateBits.join(" ")} Pass approved_by with the name of the person who said yes.`,
        };
      }
      try {
        const r = await d.prospeo.count(countFilters as GetleadsFilters, rawIndustries);
        calls.push({ vendor: "prospeo", action: "search_person", ok: true, count: r.total_matching, message: r.free ? "free" : null });
        const credits = r.free ? 0 : 1;
        const cost = r.free ? 0 : decision.worstCaseCents;
        await d.rails
          .record({
            runId: null,
            clientTag: input.client_tag,
            step: "size",
            vendor: "prospeo_search",
            action: "search_person",
            rows: 0,
            credits,
            worstCaseCents: decision.worstCaseCents,
            balanceBefore: null,
            balanceAfter: null,
            vendorJobId: null,
            approvedBy: input.approved_by ?? null,
          })
          .catch(() => undefined);
        const titleNote = parsed.params.title_match === "substring" ? "title match CONTAINS (substring as the receipt asked; D82)." : "title match EXACT (D82).";
        const bits = [titleNote, r.free ? "This search was free (no result or a 30-day repeat)." : null, flagNote ? `Inexact industry mappings: ${flagNote}.` : null, capNote].filter(
          (s): s is string => Boolean(s),
        );
        return {
          ...base,
          filters_used: used, filters_applied: used,
          count: r.total_matching,
          cost_cents: cost,
          estimate_cents: decision.worstCaseCents,
          industry_mappings: mappings,
          note: bits.join(" "),
        };
      } catch (err) {
        calls.push({ vendor: "prospeo", action: "search_person", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, industry_mappings: mappings, note: "Prospeo count failed; see calls" };
      }
    }
    case "maps": {
      const spec = mapsPoolFromFilters(filters, input.client_tag);
      if ("error" in spec) return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, note: spec.error };
      if (!d.db) {
        const used = withHonored(mapsPoolFiltersUsed(spec));
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: "maps count reads client_<tag>.maps_raw on the database; it is not wired." };
      }
      try {
        const r = await countMapsPool(d.db, input.client_tag, filters);
        if ("error" in r) {
          calls.push({ vendor: "supabase", action: "maps_pool", ok: false, count: null, message: r.error });
          const used = withHonored(mapsPoolFiltersUsed(spec));
          return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: r.error };
        }
        calls.push({ vendor: "supabase", action: "maps_pool", ok: true, count: r.pool, message: r.relation });
        return {
          ...base,
          filters_used: withHonored(r.filters_used),
          filters_applied: withHonored(r.filters_used),
          count: r.pool,
          pool: r.pool,
          already_used: r.already_used,
          already_live: r.already_live,
          already_ingested: r.already_ingested,
          already_contacted: r.already_contacted,
          net_new: r.net_new,
          cost_cents: 0,
          note: `${MAPS_POOL_NOTE}. ${r.relation}: pool ${r.pool}, already live ${r.already_live}, already ingested ${r.already_ingested}, already contacted ${r.already_contacted}, used ${r.already_used}, net new ${r.net_new}.`,
        };
      } catch (err) {
        calls.push({ vendor: "supabase", action: "maps_pool", ok: false, count: null, message: (err as Error).message.slice(0, 200) });
        const used = withHonored(mapsPoolFiltersUsed(spec));
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: "maps pool count failed; see calls" };
      }
    }
    case "permits": {
      const types = strings(filters.permit_types ?? filters.permits ?? filters.permit_type);
      const states = strings(filters.states);
      if (!d.permits) {
        const used = withHonored({ permit_types: types, states });
        return { ...base, filters_used: used, filters_applied: used, count: null, cost_cents: 0, note: "PERMITSTACK_MCP_URL is not set on the service." };
      }
      if (types.length === 0 || states.length === 0) return { ...base, filters_used: input.filters, filters_applied: input.filters, count: null, cost_cents: 0, note: "permits needs permit_types and states." };
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
      {
        const used = withHonored({ permit_types: types, states });
        return { ...base, filters_used: used, filters_applied: used, count: calls.some((c) => c.ok) ? total : null, cost_cents: 0, note: "permits in the last month on PermitStack; the stored pool is in the client's permit tables" };
      }
    }
  }
}
