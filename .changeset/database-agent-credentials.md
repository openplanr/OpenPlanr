---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The database agent connects with the database client's own credential configuration, such as `~/.pgpass` or `~/.my.cnf`, and no longer reads `DB_PASSWORD`.
