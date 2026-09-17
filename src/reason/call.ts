import { createHash } from "node:crypto";
import type { LanePicture } from "./picture.js";
import { pictureJson } from "./picture.js";
import { systemPrompt } from "./prompt.js";
import type { ReasonTools } from "./tools.js";

export type ReasonerFn = (input: { system: string; user: string; tools: ReasonTools }) => Promise<unknown>;

export type AnthropicFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const TOOL_NAMES = ["sql_read", "getleads_count", "aiark_count", "discolike_count", "maps_estimate", "permitstack_count"] as const;

function toolSpecs(tools: ReasonTools): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [
    { name: "sql_read", description: "Read-only SELECT against a whitelist of schemas. Returns a row count, never rows.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "getleads_count", description: "Free getleads count_contacts. Exact band labels. Never export.", input_schema: { type: "object", properties: { filters: { type: "object" } }, required: ["filters"] } },
  ];
  if (tools.aiark_count) out.push({ name: "aiark_count", description: "Free AI Ark count. Never export.", input_schema: { type: "object", properties: { filters: { type: "object" } }, required: ["filters"] } });
  if (tools.discolike_count) out.push({ name: "discolike_count", description: "Free DiscoLike count.", input_schema: { type: "object", properties: { seed: { type: "string" }, filters: { type: "object" } }, required: ["seed", "filters"] } });
  if (tools.maps_estimate) out.push({ name: "maps_estimate", description: "Maps estimate_cost. Companies only.", input_schema: { type: "object", properties: { plan: { type: "object" } }, required: ["plan"] } });
  if (tools.permitstack_count) out.push({ name: "permitstack_count", description: "PermitStack count. Never pull.", input_schema: { type: "object", properties: { filters: { type: "object" } }, required: ["filters"] } });
  return out;
}

async function runTool(tools: ReasonTools, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "sql_read") return tools.sql_read(String(args.query ?? ""));
  if (name === "getleads_count") return tools.getleads_count((args.filters as Record<string, unknown>) ?? {});
  if (name === "aiark_count" && tools.aiark_count) return tools.aiark_count((args.filters as Record<string, unknown>) ?? {});
  if (name === "discolike_count" && tools.discolike_count) return tools.discolike_count(String(args.seed ?? ""), (args.filters as Record<string, unknown>) ?? {});
  if (name === "maps_estimate" && tools.maps_estimate) return tools.maps_estimate((args.plan as Record<string, unknown>) ?? {});
  if (name === "permitstack_count" && tools.permitstack_count) return tools.permitstack_count((args.filters as Record<string, unknown>) ?? {});
  throw new Error(`tool ${name} is not available`);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("reasoner returned no JSON object");
  return JSON.parse(trimmed.slice(start, end + 1));
}

/** Anthropic Messages API. Tests inject ReasonerFn and never call this. */
export function anthropicReasoner(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: AnthropicFetch;
}): ReasonerFn {
  const fetchImpl = opts.fetchImpl ?? (fetch as AnthropicFetch);
  const model = opts.model ?? "claude-sonnet-4-5";
  return async ({ system, user, tools }) => {
    const messages: Array<Record<string, unknown>> = [{ role: "user", content: user }];
    for (let i = 0; i < 8; i++) {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          temperature: 0,
          system,
          tools: toolSpecs(tools),
          messages,
        }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${raw.slice(0, 240)}`);
      const body = JSON.parse(raw) as { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; id?: string }>; stop_reason?: string };
      const content = body.content ?? [];
      const toolUses = content.filter((c) => c.type === "tool_use" && c.name && TOOL_NAMES.includes(c.name as (typeof TOOL_NAMES)[number]));
      if (toolUses.length) {
        messages.push({ role: "assistant", content });
        const results = [];
        for (const t of toolUses) {
          let result: unknown;
          try {
            result = await runTool(tools, t.name!, t.input ?? {});
          } catch (err) {
            result = { error: (err as Error).message };
          }
          results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(result) });
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
      try {
        return extractJson(text);
      } catch (err) {
        if (i === 0) {
          messages.push({ role: "assistant", content });
          messages.push({ role: "user", content: `Parse error: ${(err as Error).message}. Return only the JSON object.` });
          continue;
        }
        throw err;
      }
    }
    throw new Error("reasoner exceeded tool rounds");
  };
}

export function promptHash(system: string, user: string): string {
  return createHash("sha256").update(system).update("\n").update(user).digest("hex").slice(0, 16);
}

export async function askReasoner(picture: LanePicture, tools: ReasonTools, reasoner: ReasonerFn): Promise<{ raw: unknown; prompt_hash: string }> {
  const system = systemPrompt(picture);
  const user = JSON.stringify(pictureJson(picture));
  const raw = await reasoner({ system, user, tools });
  return { raw, prompt_hash: promptHash(system, user) };
}
