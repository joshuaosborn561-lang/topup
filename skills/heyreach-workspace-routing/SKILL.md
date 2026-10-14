---
name: heyreach-workspace-routing
description: Route HeyReach work to the correct client workspace using the right API key, and run list operations server side through Supabase edge functions instead of the MCP connector. Use whenever Josh asks to touch HeyReach for TechEvo, Corey, or any client that is not SalesGlider itself, and whenever a HeyReach call returns a 401, an empty list set, or lists that clearly belong to the wrong account. Also use before pushing, pruning, or reading leads on any HeyReach list, because the MCP connector only reaches the SalesGlider workspace and lead rows must never pass through chat.
---

# HeyReach workspace routing

HeyReach is multi tenant. Each client workspace is a separate account with its own
API key, and the MCP connector in this environment only reaches one of them.

## The problem this solves

Two connectors are configured, `HeyReach` and `TechEvo HeyReach`, and both point at
`https://mcp.heyreach.io/mcp`. The tool loader collapses them into a single
`HeyReach:` namespace that resolves to **Josh's SalesGlider workspace only**. Calling
`get_all_lists` while intending to reach a client workspace silently returns
SalesGlider's lists instead of erroring. Verify the list names look right before
acting on anything.

There is no way to select a workspace through the MCP connector. Client work goes
through the API directly, server side.

## Keys

Keys live in Supabase Vault on project `azpapwtnrbzywlnxxecz`. Never paste a key into
a skill file, a chat message, or a tool argument. Read them with
`public.get_heyreach_keys()` or `public.get_vault_secret(p_name)`, both of which are
security definer and revoked from `anon` and `authenticated`.

| Vault name | Workspace | Status |
|---|---|---|
| `heyreach_salesglider` | Josh / SalesGlider | works, workspace level |
| `heyreach_techevo` | TechEvo / Corey | works, workspace level |
| `heyreach_master` | org level | **rejected by the public API** |

The master key is not usable. HeyReach answers `401` with "The provided API key is
not a workspace-level key." Do not retry it as a fallback. Each new client needs its
own workspace level key, generated inside that workspace under Settings, then
vaulted under `heyreach_<client>`.

## TechEvo lists, as of Aug 2026

| List ID | Name | Leads | Campaign |
|---|---|---|---|
| 884888 | TechEvo NE IT DM v2 | 1,088 | 566902 |
| 741316 | New England IT Directors | 1,577 | 481697 |
| 807158 | Accepted leads | 71 | 514902 |

## Edge functions

All of these accept `?key=<vault name>` so the same code serves any workspace.
Default is `heyreach_salesglider`, so **always pass the key explicitly for client
work.**

| Function | Purpose |
|---|---|
| `heyreach-probe` | read only, confirms a key works and lists its workspace |
| `heyreach-list-push` | normalizes and pushes leads into a list |
| `heyreach-list-prune` | deletes leads from a list, advances a queue |

Start any client session with `heyreach-probe` against that client's key. If the
list names look wrong, stop.

## API shapes that differ from the MCP tool signatures

The MCP tool definitions do not match the REST API in two places that cost real time
to rediscover:

- **Delete from list** is `DELETE /api/public/list/DeleteLeadsFromListByProfileUrl`
  with body `{ listId, profileUrls: [...] }`. `POST` returns `405`. The field is
  `profileUrls`, not `leadProfileUrls` as the MCP tool implies, which returns `400`.
- **Add leads** is `POST /api/public/list/AddLeadsToListV2` with body
  `{ listId, leads: [...] }`, batched at 100.

## List modification requires a paused campaign

HeyReach refuses to modify a list attached to a running campaign:

> The list you selected cannot be currently modified because it is used by a running
> campaign.

The sequence is always **pause, modify, resume**. Pausing does not lose progress.

Related trap: starting a campaign whose list is empty flips it to `FINISHED`
permanently, and `FINISHED` campaigns cannot be edited or restarted. Always load
leads first, then start.

## Client work needs Josh's explicit sign off

Pruning or pushing on a client workspace changes a campaign Josh does not own the
relationship for. Before modifying anything in a client workspace:

1. Confirm which campaign and list, by name, not by assumption
2. State the before and after lead count as a number and a percentage
3. Get Josh's go ahead, and confirm the client has been told when the change is
   large

An activity gate typically removes about 78% of a list. That is a normal result, and
it is also a conversation the client should not discover after the fact.
