---
name: planr-database
description: Introspect a live database schema read-only and write the snapshot output/db/schema.json for PostgreSQL, MySQL, MSSQL, SQLite, or MongoDB. Use when Plan or the user needs the current data model and no fresh snapshot exists.
---

# DB Agent

Scan the live database schema and write one structured JSON snapshot that later
roles use to understand the data model. This role never modifies the database:
no `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, or `CREATE`, and for MongoDB no
`insertOne`, `updateOne`, `deleteOne`, or `dropCollection`. Only read-only
introspection queries are allowed. The host's permission rules apply to every
command this agent runs; keep each command a read-only query so that the user
can approve it as one.

Run it when the active stack file configures `DatabaseType` and
`output/db/schema.json` is missing or stale, or when the user asks for a fresh
scan.

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `input/tech/stack.md` | Active stack file (`DatabaseType` and the connection variable names) | Yes |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Environment variables | Unless a service or login path supplies them |

Connect only through a route where the database client authenticates on its own:

- PostgreSQL: a service in `~/.pg_service.conf` selected with `PGSERVICE`, with its password
  in `~/.pgpass`. Pass `-w` so `psql` fails instead of prompting.
- MySQL: a login path saved with `mysql_config_editor`, passed as `--login-path=<name>` before
  any other option.
- MongoDB: `mongosh` with `MONGODB-OIDC`, X.509 (`MONGODB-X509`) or `MONGODB-AWS`
  authentication, or a local server without authentication. Never pass `--username` without
  one of these mechanisms: `mongosh` would prompt for a password.
- MSSQL: `sqlcmd -E`, a trusted connection.
- SQLite: the database file.

When none of these is set up, for example when the project only has a `DATABASE_URL` that
holds a password, stop and tell the user they can set up one of these routes or run the
scan themselves. Never read, ask for, print or pass a password or a connection string,
including by environment reference such as `$DATABASE_URL`.

## Output

Write the full introspected schema to `output/db/schema.json`, and nothing else.
Overwrite the previous snapshot on every run; never reuse one without
re-scanning. Always include a `generatedAt` timestamp.

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "databaseType": "PostgreSQL | MySQL | MSSQL | SQLite | MongoDB",
  "databaseName": "string",
  "tables": [
    {
      "name": "table_name",
      "schema": "public | dbo | etc.",
      "columns": [
        {
          "name": "column_name",
          "type": "varchar(255) | int | boolean | etc.",
          "nullable": true,
          "default": null,
          "isPrimaryKey": false,
          "isForeignKey": false,
          "referencesTable": null,
          "referencesColumn": null,
          "isUnique": false,
          "isIndexed": false
        }
      ],
      "primaryKey": ["id"],
      "foreignKeys": [
        {
          "column": "user_id",
          "referencesTable": "users",
          "referencesColumn": "id",
          "onDelete": "CASCADE | SET NULL | RESTRICT"
        }
      ],
      "indexes": [
        {
          "name": "idx_name",
          "columns": ["col1", "col2"],
          "unique": false
        }
      ]
    }
  ],
  "enums": [
    {
      "name": "enum_name",
      "values": ["VALUE_1", "VALUE_2"]
    }
  ]
}
```

## Scan

1. Read `input/tech/stack.md` for `DatabaseType` and the connection variables.
2. Connect read-only through one of the routes above and introspect with the technique for
   the configured type:
   - PostgreSQL: `information_schema.tables`, `columns`, constraints, and `pg_indexes`
   - MySQL: `information_schema.tables`, `columns`, `key_column_usage`, and `statistics`
   - MSSQL: `sys.tables`, `sys.columns`, `sys.foreign_keys`, and `sys.indexes`
   - SQLite: `PRAGMA table_info()` and `PRAGMA foreign_key_list()`
   - MongoDB: list the collections of `DB_NAME`; for each, sample up to 100
     documents with `find().limit(100)` and infer field names, observed types,
     nullability, array versus scalar, and embedded versus reference shapes;
     list indexes with `getIndexes()`. Mongo has no foreign keys: record
     inferred references from naming conventions such as `_id` suffixes under
     `foreignKeys` with `onDelete: null`, and map collections to `tables`.
3. Capture every table or collection with types, nullability, defaults,
   constraints, primary keys, foreign keys, indexes, and SQL enum types or check
   constraints. Report only what exists; never assume a missing table.
4. Write the snapshot and return the number of tables or collections captured
   and the output path.

## Error Handling

| Error | Response |
|-------|----------|
| Connection refused | Report the error and write no partial output |
| Missing connection variable and no service or login path | List every missing variable and stop |
| Authentication failed or no route set up | Stop and tell the user they can set up one of the routes above or run the scan themselves |
| Empty schema (0 tables) | Write an empty `tables` array and report the warning |
| Partial scan failure | Write the partial snapshot and mark affected tables `"scanError": true` |
