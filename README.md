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

## The shared brain: the Lead Topup MCP (D113)

Every top-up bot, Josh's and Cayden's, plugs into one connector:

```
https://leadtopup-production.up.railway.app/mcp
```

Streamable HTTP, no login. It is the booklet, not the engine: it hands out
the rules, the skills and client context, and saves new rules. It never
pulls, spends, verifies, loads or touches a Smartlead campaign, and it
never returns a lead row.

| Tool | What it gives |
| --- | --- |
| `start_here` | What to read before any top-up. Call it first. |
| `get_canon(client?, category?)` | The active shared rules from `topup.bot_rules`. |
| `add_rule(rule, category, source, client?, supersedes?)` | Save a rule for every bot; `supersedes` marks the old one superseded, never deleted. |
| `list_skills` / `get_skill(name)` | Josh's skills in `skills/`, josh-judgment-calls first. Synced daily from Claude. |
| `get_toolkit` | The connector guide (a row in `topup.bot_rules`). |
| `list_clients` / `get_client(client_tag)` | Who the client is, campaigns and lanes, build history in words with transcript paths, process changes, client rules, the client's skills. |
| `find_low_campaigns(client_tag)` | Runway per lane and campaign, sends, positive replies per 2,000. |

### How a new bot connects

1. Add a custom connector (MCP server) named `Top_Up` with the address
   above. No token, no OAuth.
2. Also attach the connectors the work needs: Supabase, getleads, LeadPipe
   (Context_Saver), Email_Verifier_Progression, the Smartlead server
   (addresses in `skills/MCP_SERVERS.md`).
3. In its first message of every session, have it call `start_here`.

`GET /health` answers `ok`, whether the database is reachable, how many
rules are active and how many skills are loaded.

### Running it

```
npm install
DATABASE_URL=... npm start     # Railway holds the real value
npm test
```

Facts live in the database and in `skills/`, never in the server code, so a
bot that updates the rules table updates the booklet at once, and the daily
skill sync updates it on the next deploy.
