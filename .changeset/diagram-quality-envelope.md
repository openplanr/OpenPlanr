---
"openplanr": minor
---

`planr diagram render`, `rerender`, `inspect` and `check` now report the rendered set's quality in their JSON envelope: a `quality` object with `status`, `failedChecks` and `warningChecks`, and one `warnings` entry per failed or warning check. A set whose quality is `invalid` returns no `nextAction`, so an agent does not hand over a diagram the engine could not lay out. An unreadable quality report is reported as a warning with no summary rather than failing the command. The `planr-diagram` skill reads the new field, treats anything other than `pass` as unfinished, and gains authoring guidance for lane grammars now that the engine draws them.
