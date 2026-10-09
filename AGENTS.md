# Working in this repo

For humans and coding agents alike.

1. **Read `CANON.md` before touching anything.** It is one page. If what you
   are about to build contradicts it, stop and ask Josh in the PR.
2. **The brief wins over the design doc; both win over code.** Do not infer a
   rule from existing code when the brief states one.
3. **A new rule is a new decision.** Append `## Dn — title` to `DECISIONS.md`
   (never edit an old entry), add its row to the status index, fold it into
   `CANON.md`, and write a guard in `src/guards/` whose failure message names
   the decision and who to ask. The meta guard fails the build otherwise.
4. **Counts and ids, never rows.** No lead data in logs, Slack, PR
   descriptions or test fixtures beyond the ten-sample rule. Use the logger;
   it redacts.
5. **Grok bot does the reasoning (D39, D53).** The service is the dumb
   half. Read `skills/grok-bot-babysitter` and `CANON.md`. Grok reads
   `campaigns` and `campaign_record`, counts with `count` and `held`, and
   runs the verbs one at a time with a person's name on every spend. Lead
   rows move MCP → Supabase → LeadPipe → Smartlead. They do not enter Grok
   bot context. No `export_contacts`, no `get-dataset-items`, no
   `find_dms_by_title`, no SELECT of emails or names, no child-agent
   GetLeads fire. Do not set a Grok routine that re-reads lists. Do not
   add a watch, a cron, a planner, a recipe or a policy gate to this
   service; that is Grok's job now.
6. **No vendor calls in tests.** Fake the client and assert on the ledger.
7. **No secrets in the repo.** Railway variables only; `.env.example` lists names.
8. **Spend goes through `SpendRails.gate`, and a person approves it first.** The
   auto cap is $0 (D51). A paid call outside the gate is a bug even if it is cheap.
9. **Smartlead is never started, paused, stopped or deleted from here.**
10. **When unsure, ask in the PR description.** Do not invent a price, a
    threshold, a recipe or a column.
11. **Plain English PRs.** Say what it does, what it refuses to do, how to
    watch it in Slack, and what is still open.

Run `npm run typecheck && npm test` before pushing.
