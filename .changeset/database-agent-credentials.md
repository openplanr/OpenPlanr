---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The database agent no longer reads `DB_PASSWORD` or passes any password or connection string. It connects only where the database client signs in on its own: a PostgreSQL service with `~/.pgpass`, a MySQL login path, MongoDB OIDC, X.509 or AWS authentication or a local server without authentication, or a trusted MSSQL connection. Without one, it asks you to set one up or run the scan yourself.
