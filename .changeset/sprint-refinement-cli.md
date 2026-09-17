---
'openplanr': minor
---

Add the storage layer for the `planr:sprint` skill: `planr sprint refinement <id> --data` validates a refinement document, writes `.planr/sprints/<id>/refinement.{json,md}` and fills the sprint's `## Tasks` with one checkbox per selected item grouped by batch; `planr sprint diff` compares two runs; `planr sprint apply` writes the approved status changes (optionally as one `chore(planr): refine backlog for <id>` commit); `planr sprint close` records leftovers. Sprints gain `releaseCut`, `capacityDays`, `refinedAt` and `closedAt`; the sprint status vocabulary is `planned`, `active`, `closed`; `planr status` reports the active sprint with its cut and progress; graph readers skip `sprints/SPRINT-NNN/` note directories.
