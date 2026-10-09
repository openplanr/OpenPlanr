---
name: planr-share
description: Share a status report, sprint note or release notes with the team as a chat message draft that the user approves and sends. Use when the user asks to post a planning update to chat.
argument-hint: "[status|sprint|release] [destination]"
license: MIT
---

# OpenPlanr Share

Turn the current planning state into a team update and hand it to ~~chat as a
draft that the user reviews and sends. Perform the work in this session. Nothing
leaves the session until the user approves the exact text and destination.

## Choose the update

The first argument picks the source; default to `status`.

- `status`: the delivery report `planr-status` gives. Read the planning artifacts
  directly, or use `openplanr status --json` when it is available.
- `sprint`: the current sprint under `.planr/sprints/`: the one in progress, else
  the most recent. Use its goal, selected items, progress and leftovers.
- `release`: the newest release notes or changelog entry, or the version the
  user names.

The second argument is the destination: a channel or person. When it is missing,
ask for it. Never pick a destination yourself.

## Write it

Lead with the outcome in one line, then at most ten short lines: what finished,
what is in progress, what is blocked and who can unblock it, and what comes next.
Use counts and dates, link pull requests or issues when their URLs are known, and
leave out local file paths, backlog IDs and internal detail the team cannot act
on. Never include credentials or the contents of secret files.

Format the text for the destination's message syntax as listed under "Message
format" in [connectors](references/connectors.md); use plain text when none is
listed.

## Preview, then ask

Show the complete text exactly as it will appear, the destination, and what will
happen: "create a draft in <destination>; nothing is sent". Ask through the host's
structured question surface, or one short chat question when there is none:
create the draft, edit the text, or cancel. Create nothing without a clear yes.
After an edit, preview again.

## If ~~chat is connected

A category is connected when the host exposes a tool for one of its products,
loaded or deferred. On approval, use that connection to create a message draft
in the destination, then report where the draft is and that the user sends it
from the chat app.

- Send directly only when the user explicitly asks to send and the connection
  can send; confirm the destination once more first.
- When the connection cannot create drafts, say so and offer to send on an
  explicit request, or print the text instead.
- When the connection fails, for example because a workspace admin has not
  approved the app, report the error, print the text ready to paste, and stop.

## With nothing connected

Print the update ready to paste and the one connect step for the current host
from [connectors](references/connectors.md), and suggest `/planr-connect`. Make no
remote call and do not retry; the user runs this skill again once connected.

## Rules

- Never ask for, read, store or print a token, key or password, and never edit
  host configuration.
- One destination per run.
- Never change planning files.

## Return

Lead with the result: draft created (where), sent (where, on explicit request),
printed for pasting, or cancelled. Name the source used and any section that was
empty or unavailable.
