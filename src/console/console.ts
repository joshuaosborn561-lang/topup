import type { CardRow, Repo } from "../db/repo.js";
import type { Role, RunRow } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Block } from "./cards.js";
import { allows, CHOICE_ROLE, NEEDS_JOSH } from "./roles.js";

const log = logger("console");

export type TapResult =
  | { ok: true; card: CardRow; choice: string }
  | { ok: false; reason: "unknown_card" | "already_resolved" | "forbidden" | "bad_choice"; message: string };

/**
 * Cards live in topup.cards. Nothing is posted anywhere: the card row is the
 * record, Grok reads it through `job`, and a resolution is validated against
 * the role table exactly once, here (D18). No Slack.
 */
export class Console {
  private ledger: LaneLedger | null = null;

  constructor(private readonly repo: Repo) {}

  /** Cards are the "blocked on a person" state; the ledger hears about each one as it opens. */
  attachLedger(ledger: LaneLedger): void {
    this.ledger = ledger;
  }

  /** A run starts without a thread. The headline stays in the log. */
  async openRunThread(run: RunRow, headline: string): Promise<RunRow> {
    log.info("run opened", { run_id: run.run_id, client_tag: run.client_tag, lane: run.lane, headline });
    return run;
  }

  async postInThread(run: RunRow, text: string, _blocks?: Block[]): Promise<{ channel: string; ts: string }> {
    log.info("run line", { run_id: run.run_id, text: text.slice(0, 180) });
    return { channel: "", ts: "unposted" };
  }

  /** Record a card. */
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
    log.info("card recorded", { card_id: card.card_id, kind: input.kind, audience: input.audience, run_id: input.run?.run_id });
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
    return card;
  }

  /**
   * Wait for a card to be resolved. Polls the database, so a process restart
   * mid-wait simply re-enters and sees the resolution. Returns null on timeout
   * or expiry; the caller parks or reports waiting.
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

  /**
   * Resolve a card for a caller whose role was established elsewhere (an MCP
   * token). `actor` is what the ledger will name; role decides what it may do.
   */
  async resolveAs(actor: string, role: Role | null, cardId: string, choice: string): Promise<TapResult> {
    const required = CHOICE_ROLE[choice];
    if (!required) return { ok: false, reason: "bad_choice", message: `Unknown choice ${choice}.` };
    if (!allows(role, required)) {
      const message = role ? `${NEEDS_JOSH} (${choice} is owner-only)` : "You are not on the owner or operator list for this service.";
      log.warn("resolve forbidden", { actor, role, choice, card_id: cardId });
      return { ok: false, reason: "forbidden", message };
    }
    const existing = await this.repo.getCard(cardId);
    if (!existing) return { ok: false, reason: "unknown_card", message: "That card no longer exists." };
    if (existing.status !== "open") {
      return { ok: false, reason: "already_resolved", message: `Already ${existing.status}${existing.resolution ? `: ${existing.resolution}` : ""}.` };
    }
    const card = await this.repo.resolveCard(cardId, actor, choice);
    if (!card) return { ok: false, reason: "already_resolved", message: "Already resolved." };
    log.info("card resolved", { card_id: cardId, kind: card.kind, choice, by: actor, role });
    return { ok: true, card, choice };
  }
}
