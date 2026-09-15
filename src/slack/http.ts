import express, { type Request, type Response, type Router } from "express";
import { logger } from "../lib/log.js";
import { parseButtonValue } from "./cards.js";
import type { SlackConsole } from "./console.js";
import { COMMAND_ROLE, NEEDS_JOSH, Roles } from "./roles.js";
import { slackSignatureValid } from "./signature.js";

const log = logger("slack-http");

export interface CommandContext {
  userId: string;
  channelId: string;
  role: "owner" | "operator";
  text: string;
  args: string[];
}

/** Slash command handlers return the text Slack shows the caller (ephemeral). */
export type CommandHandler = (ctx: CommandContext) => Promise<string>;

/** Something a resolved card should trigger (e.g. continue a waiting step). */
export type TapListener = (card: { card_id: string; kind: string; run_id: string | null; choice: string; by: string }) => Promise<void>;

export function slackRouter(input: {
  signingSecret: string;
  roles: Roles;
  console: SlackConsole;
  commands: Record<string, CommandHandler>;
  onTap: TapListener;
}): Router {
  const router = express.Router();

  // Slack signs the raw body; keep it.
  router.use(
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );

  router.use((req: Request, res: Response, next) => {
    const raw = (req as Request & { rawBody?: string }).rawBody ?? "";
    const ok = slackSignatureValid(
      input.signingSecret,
      raw,
      req.header("x-slack-request-timestamp"),
      req.header("x-slack-signature"),
    );
    if (!ok) {
      log.warn("bad slack signature", { path: req.path });
      res.status(401).send("bad signature");
      return;
    }
    next();
  });

  router.post("/commands", async (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const command = body.command;
    const userId = body.user_id;
    const required = COMMAND_ROLE[command];
    if (!required) {
      res.json({ response_type: "ephemeral", text: `Unknown command ${command}.` });
      return;
    }
    const role = input.roles.roleOf(userId);
    if (!Roles.allows(role, required)) {
      res.json({ response_type: "ephemeral", text: role ? `${NEEDS_JOSH} (${command} is owner-only)` : "You are not on the owner or operator list." });
      return;
    }
    const handler = input.commands[command];
    if (!handler) {
      res.json({ response_type: "ephemeral", text: `${command} is not wired yet.` });
      return;
    }
    const text = (body.text ?? "").trim();
    try {
      const reply = await handler({
        userId,
        channelId: body.channel_id,
        role: role!,
        text,
        args: text ? text.split(/\s+/) : [],
      });
      res.json({ response_type: "ephemeral", text: reply });
    } catch (err) {
      log.error("command failed", { command, error: (err as Error).message });
      res.json({ response_type: "ephemeral", text: `Something broke: ${(err as Error).message}` });
    }
  });

  router.post("/interactions", async (req: Request, res: Response) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse((req.body as Record<string, string>).payload ?? "{}");
    } catch {
      res.status(400).send("bad payload");
      return;
    }
    if (payload.type !== "block_actions") {
      res.status(200).send();
      return;
    }
    const user = (payload.user as { id?: string } | undefined)?.id ?? "";
    const channel = (payload.channel as { id?: string } | undefined)?.id ?? "";
    const actions = (payload.actions as Array<{ value?: string }> | undefined) ?? [];
    // Acknowledge within Slack's 3 second window, then do the work.
    res.status(200).send();
    for (const a of actions) {
      const parsed = parseButtonValue(a.value);
      if (!parsed) continue;
      const result = await input.console.handleTap(user, parsed.card_id, parsed.choice);
      if (!result.ok) {
        await input.console.whisper(channel, user, result.message).catch(() => undefined);
        continue;
      }
      try {
        await input.onTap({ card_id: result.card.card_id, kind: result.card.kind, run_id: result.card.run_id, choice: result.choice, by: user });
      } catch (err) {
        log.error("tap listener failed", { card_id: parsed.card_id, error: (err as Error).message });
      }
    }
  });

  return router;
}
