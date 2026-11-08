---
branch: feature/search
verdict: not-ready
---
# Landing review: feature/search

| ID | Severity | Finding |
|----|----------|---------|
| F-1 | High | `src/search.js` builds `new RegExp(query, 'i')` from the raw query. Input such as `(` throws, and a crafted pattern can hang the process. Escape the query or use `includes`. |
| F-2 | High | `note.body.toLowerCase()` throws for notes created without a body (`body: null`) whenever the title does not match. |
| F-3 | Medium | `test/search.test.js` calls the route but asserts nothing, so it passes whatever the route returns. |

**Verdict: not ready to merge.** Fix F-1 to F-3 and add assertions before landing.
