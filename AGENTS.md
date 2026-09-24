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
5. **Grok bot is the babysitter (D39).** It starts runs, reads counts and
   ids, posts a card, and drops a link. Lead rows move MCP → Supabase
   (`source_table` + writeback), edge functions, and LeadPipe. They do not
   enter Grok bot context. Do not set a Grok routine that re-reads lists.
6. **No vendor calls in tests.** Fake the client and assert on the ledger.
7. **No secrets in the repo.** Railway variables only; `.env.example` lists names.
8. **Spend goes through `SpendRails.gate`.** A paid call outside the gate is a
   bug even if it is cheap.
9. **Smartlead is never started, paused, stopped or deleted from here.**
10. **When unsure, ask in the PR description.** Do not invent a price, a
    threshold, a recipe or a column.
11. **Plain English PRs.** Say what it does, what it refuses to do, how to
    watch it in Slack, and what is still open.

Run `npm run typecheck && npm test` before pushing.
