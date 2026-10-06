---
'openplanr': patch
---

`openplanr spec sync` recognizes a `specId` written without quotes, adds a missing one after an unquoted `id`, and reports a repair only when it makes one. It previously reported adding `specId` to every story and task the plan skill writes while leaving the files unchanged.
