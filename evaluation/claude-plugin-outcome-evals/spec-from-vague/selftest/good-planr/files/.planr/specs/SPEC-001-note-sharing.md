---
id: SPEC-001
title: Share a note with teammates
status: draft
sources: [feedback/2026-10-06-acme.txt, feedback/2026-10-14-brightlane.txt]
---
# SPEC-001: Share a note with teammates

## Problem

Only a note's owner can see it. Customers paste notes into chat to show colleagues, and the copies go
stale (Brightlane). Support teams need runbooks their whole team can read but only one person edits (Acme).

## Requirements

- FR-1: The owner can share a note with another user by user id. `GET /notes/:id` then returns the note to
  that user with status 200.
- FR-2: A user the note is shared with gets 403 from `PATCH /notes/:id` and `DELETE /notes/:id`.
- FR-3: A user the note is shared with always reads the note's current title, body and due date; after the
  owner edits it, the next read returns the edited version.
- FR-4: The owner can stop sharing with one user; that user's next `GET /notes/:id` returns 404.
- FR-5: The owner can list the users a note is shared with; the list changes when sharing starts or stops.

## Affected code

- `src/auth.js`: ownership checks gain a read-access check for shared users.
- `src/store.js`: keep the set of user ids a note is shared with.
- `src/server.js`: routes to share, unshare and list.

## Non-goals

- Editing by people a note is shared with.
- Public or anonymous links, comments, notifications.

## Open questions

- Should sharing target users only, or also whole teams?
- Do shared notes appear in the recipient's `GET /notes` list?
