# Lead top-up

**Read `topup.bot_rules` first.** Before any top-up or list build, in Supabase project `azpapwtnrbzywlnxxecz`:

```sql
select category, client, rule from topup.bot_rules where status = 'active' order by category;
```

Those rows win over skill text where they conflict. A new durable rule is inserted there (supersede the old row; never delete).

Three things, nothing else:

1. **The instructions.** `skills/grok-bot-babysitter/SKILL.md` is how Grokbot
   tops up a campaign. Read it first. Every other folder in `skills/` is a
   copy of one of Josh's Claude skills, synced daily: the normal process.
2. **The MCPs.** `skills/MCP_SERVERS.md` lists every server, its address and
   what it owns. `docs/servers.md` is the long reference for each one.
3. **The data.** `docs/supabase.md` says where the leads, the campaigns and
   the build transcripts live on Supabase project `azpapwtnrbzywlnxxecz`.

Grokbot reads the transcripts of how a campaign's list was built, calls the
same MCPs the transcripts used, and loads the campaign. There is no service
in the middle and no recipe. Durable rules live in `topup.bot_rules`. What
the transcripts and those rows do not say is one plain question to Josh.

`DECISIONS.md` is the history of how this got here. It is append-only.
