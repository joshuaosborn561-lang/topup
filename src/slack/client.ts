import { WebClient } from "@slack/web-api";
import type { Block } from "./cards.js";
import { logger } from "../lib/log.js";

const log = logger("slack");

export interface Poster {
  post(channel: string, text: string, blocks?: Block[], threadTs?: string): Promise<{ channel: string; ts: string }>;
  update(channel: string, ts: string, text: string, blocks?: Block[]): Promise<void>;
  ephemeral(channel: string, user: string, text: string): Promise<void>;
}

/** Real Slack poster. When no token is configured every post is logged and dropped, never faked. */
export class SlackPoster implements Poster {
  private readonly web: WebClient | null;

  constructor(token: string) {
    this.web = token ? new WebClient(token) : null;
  }

  get enabled(): boolean {
    return this.web !== null;
  }

  async post(channel: string, text: string, blocks?: Block[], threadTs?: string): Promise<{ channel: string; ts: string }> {
    if (!this.web) {
      log.warn("slack disabled; message dropped", { channel, text, thread_ts: threadTs });
      return { channel, ts: `dropped-${Date.now()}` };
    }
    const res = await this.web.chat.postMessage({
      channel,
      text,
      blocks: blocks as never,
      thread_ts: threadTs,
      unfurl_links: false,
    });
    return { channel: (res.channel as string) ?? channel, ts: res.ts as string };
  }

  async update(channel: string, ts: string, text: string, blocks?: Block[]): Promise<void> {
    if (!this.web) return;
    await this.web.chat.update({ channel, ts, text, blocks: blocks as never });
  }

  async ephemeral(channel: string, user: string, text: string): Promise<void> {
    if (!this.web) return;
    await this.web.chat.postEphemeral({ channel, user, text });
  }
}

/** In-memory poster for tests and DRY_RUN. */
export class MemoryPoster implements Poster {
  readonly posts: Array<{ channel: string; text: string; blocks?: Block[]; threadTs?: string; ts: string }> = [];
  readonly updates: Array<{ channel: string; ts: string; text: string; blocks?: Block[] }> = [];
  readonly ephemerals: Array<{ channel: string; user: string; text: string }> = [];
  private n = 0;

  async post(channel: string, text: string, blocks?: Block[], threadTs?: string) {
    const ts = `${Date.now()}.${String(++this.n).padStart(6, "0")}`;
    this.posts.push({ channel, text, blocks, threadTs, ts });
    return { channel, ts };
  }

  async update(channel: string, ts: string, text: string, blocks?: Block[]) {
    this.updates.push({ channel, ts, text, blocks });
  }

  async ephemeral(channel: string, user: string, text: string) {
    this.ephemerals.push({ channel, user, text });
  }
}

/** Channel routing: one channel per client plus the ops channel. */
export function channelFor(clientTag: string | null, clientChannels: Record<string, string>, opsChannel: string): string {
  if (clientTag && clientChannels[clientTag]) return clientChannels[clientTag];
  return opsChannel;
}
