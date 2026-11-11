The plan looks solid overall. Revocation is covered by task 5. One thing: task 3 should check that the caller owns the note before creating
a link, using `requireOwner` like the other routes. Everything else is fine to start.
