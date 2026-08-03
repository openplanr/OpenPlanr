# ADR-003: Runtime Routing, Installation, and Migration

## Status

Accepted

## Decision

`planr setup` previews and installs detected runtime adapters. `planr pipeline`
routes PLAN/SHIP by explicit runtime, active adapter, project default, or the
only compatible installed runtime, in that order. Ambiguity is an error in
non-interactive mode.

Headless-capable adapters may be launched from the terminal. Other adapters
return a structured handoff instead of claiming execution succeeded.

Migration is managed and reversible. Before changing owned runtime files, setup
writes byte-for-byte backups plus hashes under the user's Planr home. Only
managed blocks and recorded owned files may be updated or removed.

## Consequences

- Setup, update, remove, and rollback are idempotent runtime-driver operations.
- Project hand edits outside managed markers are preserved.
- Cursor initially uses a handoff from terminal routing.
- Destructive replacement of unknown user files is forbidden.
