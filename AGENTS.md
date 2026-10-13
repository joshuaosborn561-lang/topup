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
5. **Grokbot does the building; the service is the referee and the loader
   (D39, D53, D99).** Read `CANON.md` and `skills/grok-bot-babysitter`.
   Grokbot reads `build_record`, replays the campaign's recorded build
   with its own connectors through LeadPipe, hands the pool to `topup`,
   shows Josh or Cayden the count and the cost, and runs
   `topup(job_id, approved_by)` after a yes. Lead rows move MCP → Supabase
   → LeadPipe → Smartlead. They do not enter Grokbot's context: no
   SELECT of emails or names, no export into chat, no dataset items.
   Do not add a tool, a pull, a count, a recipe, a watch, a cron, a
   planner or a policy gate to this service. Do not add per-client code.
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
