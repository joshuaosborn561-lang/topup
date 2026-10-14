# Lead top-up

Three things, nothing else:

1. **The instructions.** `skills/grok-bot-babysitter/SKILL.md` is how Grokbot
   tops up a campaign. Read it first.
2. **The MCPs.** `skills/MCP_SERVERS.md` lists every server, its address and
   what it owns. `docs/servers.md` is the long reference for each one.
3. **The data.** `docs/supabase.md` says where the leads, the campaigns and
   the build transcripts live on Supabase project `azpapwtnrbzywlnxxecz`.

Grokbot reads the transcripts of how a campaign's list was built, calls the
same MCPs the transcripts used, and loads the campaign. There is no service
in the middle, no stored rule and no recipe. What the transcripts do not say
is one plain question to Josh.

`DECISIONS.md` is the history of how this got here. It is append-only.
