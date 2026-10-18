---
'openplanr': patch
---

`openplanr backlog add` and the backlog helper in Ship and Investigate now reject a priority other than critical, high, medium or low, from `--priority` or from `--data`, and name the value they rejected. Existing backlog items with other priorities still load and list. The CLI reports a rejected priority as `E_BACKLOG_INVALID` and a create command without a title as `E_PLANNING_INPUT_REQUIRED`, instead of as an unexpected failure.
