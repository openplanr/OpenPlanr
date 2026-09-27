---
'openplanr': patch
---

Creating an artifact (`planr backlog add`, `planr epic create` and the other create commands) no longer reissues the id of a removed item, continues past 999 (`FEAT-1000`), gives concurrent runs different ids, and ignores `SPRINT-NNN/` notes folders; issued ids are recorded as empty files in each artifact folder's `.issued-ids/`, which belongs in version control with the rest of `.planr/`. `planr <type> list` now shows ids past 999, in numeric order.
