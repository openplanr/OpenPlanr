---
branch: feature/search-share
verdict: not-ready
---
# Landing review: feature/search-share

| ID | Severity | Finding |
|----|----------|---------|
| F-1 | High | `src/search.js` builds `new RegExp(query, 'i')` from the raw query. Input such as `(` throws, and a crafted pattern can hang the process. Escape the query or use `includes`. |
| F-2 | High | `note.body.toLowerCase()` throws for notes created without a body (`body: null`) whenever the title does not match. |
| F-3 | High | `shares.create` checks `byNote` and then awaits `randomToken()` before storing. Two concurrent POSTs for one note both create links; the first caller's token is overwritten and stops working, breaking the README's one-link promise. Store a pending promise per note, or generate the token synchronously. |
| F-4 | Medium | `paginate` slices `start` to `start + limit - 1`: every page is one short and the last item of each page is never returned. |
| F-5 | Medium | `search lists title matches first` passes only because "Budget review" is created first. `searchNotes` never puts title matches first, although the README says it does. |
| F-6 | Medium | `search finds notes by title` calls the route but asserts nothing, so it passes whatever the route returns. |
| N-1 | Note | The rename commit is mechanical and fine. The `TODO(#57)` is tracked in #57. Matching `/notes/search` and the share route before `/notes/:id` is required. None of these need changes. |

**Verdict: not ready to merge.** Fix F-1 to F-6 before landing.
