---
'@openplanr/design': patch
'@openplanr/artifact': patch
'openplanr': patch
---

Wait for browser frame attachment before auditing mounted design boards and report frame loading and panel visibility restoration failures.

Hold design frames during rendered audits so competing viewport demand cannot evict or cancel them. Queue demand while held frames fill the budget, resuming after release.
