Here's what I'd build: read-only sharing with specific teammates.

1. An owner can share a note with another user by their user id; that user can then read it with
   GET /notes/:id and gets a 200.
2. Someone a note is shared with gets a 403 if they try to change or delete it.
3. They always see the current version: after the owner edits the note, their next read shows the edit.
4. The owner can stop sharing with one person, after which that person gets a 404.
5. The owner can see who a note is shared with.

The change sits in src/auth.js (a read check next to requireOwner), src/store.js (who each note is shared
with) and new routes in src/server.js.
