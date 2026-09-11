/**
 * Minimal MCP Streamable-HTTP client: initialize once, then tools/call.
 * The vendor servers on Railway all speak this; we only need tool calls and we
 * only ever read summaries (counts, ids, signed URLs), never row payloads.
 */
export class McpHttpClient {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly token: string = "",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    if (this.sessionId) h["mcp-session-id"] = this.sessionId;
    return h;
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const ctype = res.headers.get("content-type") ?? "";
    const text = await res.text();
    let msg: { result?: unknown; error?: { message?: string } } | null = null;
    if (ctype.includes("text/event-stream")) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed && parsed.id === id) msg = parsed;
        } catch {
          /* skip keepalives */
        }
      }
    } else if (text.trim()) {
      msg = JSON.parse(text);
    }
    if (!msg) throw new Error(`MCP ${method}: empty response`);
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message ?? "error"}`);
    return msg.result;
  }

  async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "leadtopup", version: "0.1.0" },
    });
    await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }).catch(() => undefined);
  }

  /** Call a tool and return its first text content parsed as JSON (or the raw text). */
  async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureSession();
    const result = (await this.rpc("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
      structuredContent?: unknown;
    };
    if (result.structuredContent !== undefined) return result.structuredContent as T;
    const text = result.content?.find((c) => c.type === "text")?.text ?? "";
    if (result.isError) throw new Error(`tool ${name} failed: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
