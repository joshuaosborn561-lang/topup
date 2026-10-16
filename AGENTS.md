# Working in this repo

This repo is instructions, a list of MCPs, a map of the data, and one small
read-mostly server (`server/`, D113) that hands all of it to every top-up
bot. That server is the booklet, never the engine: no pulls, no spend, no
verification, no loads, no campaign changes. Durable rules live in `topup.bot_rules` on project
`azpapwtnrbzywlnxxecz` — read the active rows before any top-up or list
build; they win over skill text; insert to supersede, never delete. If you
are about to add an engine tool or another service, stop and ask Josh.

* No lead rows anywhere: not in chat, not in a file here, not in a PR.
* No secrets. Addresses only; keys live with each server.
* No client facts in the instructions. They live in the transcripts.
* Plain English. Say what it does and what it refuses to do.
