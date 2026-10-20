---
"openplanr": patch
"planr-pipeline": patch
---

Discover Markdown artifacts in canonical planning directories by valid frontmatter IDs as well as ID-prefixed filenames, including slug-named files. Keep documentation without artifact identities, hidden files, error reports, sprint notes, and noncanonical directories out of the graph.

When two files claim the same id, the file named after the id wins, then the lexically smallest path, and `openplanr graph` prints each skipped duplicate with both paths on stderr.
