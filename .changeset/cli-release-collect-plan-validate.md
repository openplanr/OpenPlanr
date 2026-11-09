---
'openplanr': minor
---

Two new read-only commands. `openplanr release collect` lists the commits between two revisions, by default the last tag and `HEAD`, with bodies, `BREAKING CHANGE:` footers, reverts and the areas they touched, and exits with the Git error instead of an empty list when Git fails; `/release` uses it when the CLI is installed. `openplanr spec validate-plan <SPEC-ID>` checks a spec's stories and tasks: valid frontmatter, ids that match their filenames and repeat nowhere else, tasks that point at real stories, and every acceptance id mapped through `acceptanceRefs` and named under `## Test Requirements`; `/plan` runs it alongside its own checks. Both accept `--json`.
