---
'openplanr': minor
---

`/operate` now runs one agent through all seven lenses and writes one report by default instead of fanning out to a subagent per lens. With no `.planr/` folder it answers in chat. It still fans out to independent advisors, the Challenger and the Chair when you name a roster or ask for independent reviewers, and `cycle.md`, `brief.md` and per-lens notes are written only then or when you ask to keep the cycle. The coverage table, decision-changing gaps and a source for every recommendation are unchanged, and notes are validated with `openplanr operate validate-note` when the CLI is installed.
