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
5. **No vendor calls in tests.** Fake the client and assert on the ledger.
6. **No secrets in the repo.** Railway variables only; `.env.example` lists names.
7. **Spend goes through `SpendRails.gate`.** A paid call outside the gate is a
   bug even if it is cheap.
8. **Smartlead is never started, paused, stopped or deleted from here.**
9. **When unsure, ask in the PR description.** Do not invent a price, a
   threshold, a recipe or a column.
10. **Plain English PRs.** Say what it does, what it refuses to do, how to
    watch it in Slack, and what is still open.

Run `npm run typecheck && npm test` before pushing.
