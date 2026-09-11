import type { CardRow, Repo } from "../db/repo.js";
import type { Role, RunRow } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import { type Block, receiptBlocks, resolvedFooter } from "./cards.js";
import { channelFor, type Poster } from "./client.js";
import { CHOICE_ROLE, NEEDS_JOSH, Roles } from "./roles.js";

const log = logger("console");

export interface ConsoleConfig {
  opsChannel: string;
  clientChannels: Record<string, string>;
}

export type TapResult =
  | { ok: true; card: CardRow; choice: string }
  | { ok: false; reason: "unknown_card" | "already_resolved" | "forbidden" | "bad_choice"; message: string };

/**
 * Slack is the console (brief section 10). One channel per client plus ops;
 * every run is a thread; every card is a row in topup.cards so a tap is
 * validated against the role table and resolved exactly once, and so a
 * restart does not lose an open ask.
 */
export class SlackConsole {
  private ledger: LaneLedger | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly poster: Poster,
    private readonly roles: Roles,
    private readonly cfg: ConsoleConfig,
  ) {}

  /** Cards are the "blocked on Josh / Cayden" state; the ledger hears about each one as it opens. */
  attachLedger(ledger: LaneLedger): void {
    this.ledger = ledger;
  }

  channelForClient(clientTag: string | null): string {
    return channelFor(clientTag, this.cfg.clientChannels, this.cfg.opsChannel);
  }

  /** Open the run's thread with one header line; everything else appends to it. */
  async openRunThread(run: RunRow, headline: string): Promise<RunRow> {
    if (run.slack_thread_ts) return run;
    const channel = this.channelForClient(run.client_tag);
    const { ts } = await this.poster.post(channel, headline);
    await this.repo.setRunThread(run.run_id, channel, ts);
    return { ...run, slack_channel: channel, slack_thread_ts: ts };
  }

  async postInThread(run: RunRow, text: string, blocks?: Block[]): Promise<{ channel: string; ts: string }> {
    const opened = await this.openRunThread(run, `Top-up run \`${run.run_id.slice(0, 8)}\` — ${run.client_tag} / ${run.lane}`);
    return this.poster.post(opened.slack_channel!, text, blocks, opened.slack_thread_ts!);
  }

  async whisper(channel: string, userId: string, text: string): Promise<void> {
    await this.poster.ephemeral(channel, userId, text);
  }

  async postOps(text: string, blocks?: Block[]): Promise<void> {
    await this.poster.post(this.cfg.opsChannel, text, blocks);
  }

  /** Create a card row, then post it (in the run thread when there is a run). */
  async ask(input: {
    run: RunRow | null;
    kind: string;
    audience: Role;
    payload: Record<string, unknown>;
    text: string;
    blocks: (cardId: string) => Block[];
    expiresAt?: Date | null;
  }): Promise<CardRow> {
    const card = await this.repo.openCard({
      run_id: input.run?.run_id ?? null,
      kind: input.kind,
      audience: input.audience,
      payload: input.payload,
      expires_at: input.expiresAt ?? null,
    });
    const blocks = input.blocks(card.card_id);
    await this.repo.setCardBlocks(card.card_id, blocks);
    const posted = input.run
      ? await this.postInThread(input.run, input.text, blocks)
      : await this.poster.post(this.channelForClient(null), input.text, blocks);
    await this.repo.setCardMessage(card.card_id, posted.channel, posted.ts);
    log.info("card opened", { card_id: card.card_id, kind: input.kind, audience: input.audience, run_id: input.run?.run_id });
    if (this.ledger && input.run) {
      await this.ledger
        .event({
          client_tag: input.run.client_tag,
          lane: input.run.lane,
          run_id: input.run.run_id,
          event: "card_opened",
          line: `${input.kind} card opened for ${input.audience === "owner" ? "Josh" : "Cayden"}: ${input.text.slice(0, 160)}`,
          next_intent: `Wait for the ${input.kind} card.`,
          actor: "service",
          detail: { card_id: card.card_id },
        })
        .catch((err) => log.warn("ledger write failed", { error: (err as Error).message }));
    }
    return { ...card, slack_channel: posted.channel, slack_ts: posted.ts };
  }

  /** A button tap. Role-checked, resolved once, message updated with a footer. */
  async handleTap(userId: string, cardId: string, choice: string): Promise<TapResult> {
    return this.resolveAs(userId, this.roles.roleOf(userId), cardId, choice);
  }

  /**
   * Same path for a caller whose role was established elsewhere (an MCP token).
   * `actor` is what the footer and ledger will name; role decides what it may tap.
   */
  async resolveAs(actor: string, role: Role | null, cardId: string, choice: string): Promise<TapResult> {
    const userId = actor;
    const required = CHOICE_ROLE[choice];
    if (!required) return { ok: false, reason: "bad_choice", message: `Unknown choice ${choice}.` };
    if (!Roles.allows(role, required)) {
      const message = role ? `${NEEDS_JOSH} (${choice} is owner-only)` : "You are not on the owner or operator list for this service.";
      log.warn("tap forbidden", { user: userId, role, choice, card_id: cardId });
      return { ok: false, reason: "forbidden", message };
    }
    const existing = await this.repo.getCard(cardId);
    if (!existing) return { ok: false, reason: "unknown_card", message: "That card no longer exists." };
    if (existing.status !== "open") {
      return { ok: false, reason: "already_resolved", message: `Already ${existing.status}${existing.resolution ? `: ${existing.resolution}` : ""}.` };
    }
    const card = await this.repo.resolveCard(cardId, userId, choice);
    if (!card) return { ok: false, reason: "already_resolved", message: "Already resolved." };
    if (card.slack_channel && card.slack_ts) {
      await this.poster
        .update(card.slack_channel, card.slack_ts, `Resolved: ${choice}`, [
          ...(this.stripActions(existing.payload.blocks as Block[] | undefined) ?? []),
          resolvedFooter(choice, userId),
        ])
        .catch((err) => log.warn("card update failed", { card_id: cardId, error: (err as Error).message }));
    }
    log.info("card resolved", { card_id: cardId, kind: card.kind, choice, by: userId, role });
    return { ok: true, card, choice };
  }

  private stripActions(blocks: Block[] | undefined): Block[] | undefined {
    return blocks?.filter((b) => b.type !== "actions");
  }

  /**
   * Wait for a card to be resolved. Polls the database, so a process restart
   * mid-wait simply re-enters and sees the resolution. Returns null on timeout
   * or expiry; the caller parks the run.
   */
  async awaitCard(cardId: string, opts: { pollMs: number; timeoutMs: number; sleep?: (ms: number) => Promise<void> }): Promise<CardRow | null> {
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const deadline = Date.now() + opts.timeoutMs;
    for (;;) {
      const card = await this.repo.getCard(cardId);
      if (!card) return null;
      if (card.status === "resolved") return card;
      if (card.status === "expired") return null;
      if (Date.now() >= deadline) return null;
      await sleep(opts.pollMs);
    }
  }

  async receipt(run: RunRow, note?: string): Promise<void> {
    const [stalls, holds] = await Promise.all([this.repo.stallEventCounts(30), this.repo.openCards("qa_hold", run.client_tag)]);
    const blocks = receiptBlocks({
      runId: run.run_id,
      clientTag: run.client_tag,
      lane: run.lane,
      status: run.status,
      counts: run.counts_by_status,
      spendCentsByVendor: run.spend_cents_by_vendor,
      stallEvents: Object.values(stalls).reduce((a, b) => a + b, 0),
      holdsOpen: holds.length,
      note,
    });
    await this.postInThread(run, `Receipt — ${run.client_tag}/${run.lane} ${run.status}`, blocks);
  }
}
