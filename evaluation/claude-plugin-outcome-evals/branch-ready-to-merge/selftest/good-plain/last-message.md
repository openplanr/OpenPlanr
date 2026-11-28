No, not yet. Six problems:

1. The search term is passed to `new RegExp` as is. A query like `c++` or `(` throws, and a nasty pattern
   could tie up the server. Escape it, or match with a plain substring check.
2. Notes created without a body have `body: null`, and `note.body.toLowerCase()` throws for them whenever
   the title doesn't match.
3. `paginate` slices to `start + limit - 1`, so each page returns one item fewer than `limit` and the
   skipped item never shows up on any page.
4. `shares.create` checks for an existing link, then awaits the random token before saving. Two requests
   at the same time both pass the check, so one note gets two links and one caller ends up with a token that no longer works.
   The README promises one link per note.
5. "search lists title matches first" only passes because the title match is created first. Search never
   sorts title matches ahead of body matches, even though the README says it does.
6. "search finds notes by title" calls the endpoint but never checks the result, so it can't fail.

The rename commit, the TODO for #57 and matching `/notes/search` before `/notes/:id` are all
fine as they are.
