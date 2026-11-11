# Sourced by case scaffolds: the accepted note-sharing spec with five numbered requirements.
# shellcheck shell=bash

write_sharing_spec() {
  mkdir -p docs/specs
  cat > docs/specs/note-sharing.md <<'EOF'
# Note sharing by link

Status: Accepted (2026-10-20)

## Problem

People copy notes into chat to show them to someone else. The copy goes stale
and the note's owner loses track of who has it.

## Requirements

1. **Create a link.** The owner of a note can create a share link for it with
   `POST /notes/:id/shares`. The response contains an unguessable token.
2. **Read through a link.** Anyone holding a valid token can read the note's
   title, body and due date with `GET /shared/:token`, without an `x-user-id`
   header.
3. **Read-only.** A share link never allows changing or deleting the note: no
   route accepts a token for a write.
4. **Revoke a link.** The owner can revoke a link with
   `DELETE /notes/:id/shares/:token`. A revoked token returns 404 at once.
5. **Expiry.** A link expires 30 days after it was created. An expired token
   returns 410.

Requirements 4 and 5 build on the link storage introduced for requirement 1.

## Non-goals

- Sharing with named users or teams.
- Editing through a link.
- Notifications of any kind.
EOF
}
