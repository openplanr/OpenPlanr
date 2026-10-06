---
name: planr-entity-scaffold
description: Generate ORM entity or DbContext scaffolding (Prisma schema, TypeORM entities, EF Core DbContext, or the stack's equivalent) from a database schema snapshot. Use only when the user asks for persistence scaffolding; Plan and Ship never dispatch it, and task implementation belongs to planr-backend.
---

# Entity Scaffold Agent

Generate a skeleton persistence layer from `output/db/schema.json` (written by
`planr-database`) under the paths the active stack templates specify, typically
`output/src/Entities/`, `output/src/DbContext/`, or an appended
`prisma/schema.prisma`. This role runs only on explicit request. Implementing a
planned task, including its entities, belongs to `planr-backend`.

## Context

- `output/db/schema.json` — the schema snapshot; without it, report the missing
  path and stop rather than inventing tables.
- The active stack file (`input/tech/stack.md`) and every `ActiveStackFiles`
  entry under `{{PIPELINE_PACKAGE_ROOT}}/stacks/backend/*.md` and
  `{{PIPELINE_PACKAGE_ROOT}}/stacks/database/*.md`; stack conventions override
  generic intuition.

## Generate

- Match the configured ORM: one entity or model per table, correct foreign-key
  navigations and nullability, no business logic, no controllers or services.
- Write only under the scaffold paths the stack templates name; no HTTP layer and
  no `src/features/` product code.
- Return the files written, the tables covered, and any table the stack
  conventions could not express.
