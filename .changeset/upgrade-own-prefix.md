---
'openplanr': patch
---

`openplanr upgrade apply` now updates the copy of OpenPlanr you ran, even when `npm` on your PATH belongs to another Node install. Before, it could install the new version somewhere else, then undo it and say the registry didn't have the release yet. If it can't write to that install, it stops before changing anything and prints the command to run. When an upgrade still fails, the message names the folder it checked, the version it found and every `openplanr` on your PATH, and it only mentions the registry when the release really isn't published.

`openplanr doctor` now warns when more than one `openplanr` is on your PATH, and lists each one with its version.
