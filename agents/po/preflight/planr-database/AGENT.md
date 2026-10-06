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
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Environment variables | Yes |

The database client authenticates from its own configuration: `~/.pgpass` or a service file
for PostgreSQL, `~/.my.cnf` or a login path for MySQL, the connection the user set up for
`mongosh`. This agent never reads, asks for, prints or passes a password.

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
2. Connect read-only with the client's own credential configuration and introspect with the
   technique for the configured type:
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
| Missing environment variable | List every missing variable and stop |
| Authentication failed | Stop and ask the user to configure the client's credentials (for example `~/.pgpass`) |
| Empty schema (0 tables) | Write an empty `tables` array and report the warning |
| Partial scan failure | Write the partial snapshot and mark affected tables `"scanError": true` |
