---
'openplanr': patch
---

`openplanr github sync` treats an open issue as matching every status except `done`, so pulling no longer resets in-progress or planning items to `pending`. A closed issue marks its item `done`, and an issue reopened after its item was done marks it `in-progress`. `openplanr linear push` errors list every pushable prefix, including `QT-` and `BL-`.
