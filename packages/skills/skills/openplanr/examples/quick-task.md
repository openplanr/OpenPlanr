# Example: Quick Task (Standalone Checklist)

A worked scenario for "I just need a task list for X — skip the agile ceremony."

---

## The ask

> **User:** "Add a quick task list for migrating from SQLite to Postgres. No need for the full agile ceremony — just a checklist I can work through."

---

## Agent execution

### Step 1 — verify install + init if needed

```bash
npx openplanr@latest --version
# If .planr/ doesn't exist:
planr init --no-ai --yes               # no-ai is fine — quick create still works if AI is configured later
planr config show                      # verify AI if already set
```

### Step 2 — create the quick task

```bash
planr quick create "migrate from sqlite to postgres" --yes
# → Created .planr/quick/QT-001-migrate-from-sqlite-to-postgres.md
```

AI expands the one-liner into a grouped subtask list.

### Step 3 — read and summarize

Claude reads `.planr/quick/QT-001-migrate-from-sqlite-to-postgres.md` and shows the user the generated breakdown.

---

## Generated QT (abbreviated)

```markdown
---
id: "QT-001"
title: "Migrate from SQLite to Postgres"
status: "pending"
createdAt: "2026-04-24"
tags: ["migration", "db"]
---

# QT-001: Migrate from SQLite to Postgres

## Context

Move the application's persistence layer from SQLite to Postgres to support
concurrent writes, larger datasets, and managed backups.

## Subtasks

### Phase 1 — Schema

- [ ] Audit current SQLite schema (`sqlite3 app.db .schema`)
- [ ] Translate types (DATETIME → timestamptz, TEXT → varchar/text)
- [ ] Document columns that rely on SQLite-specific behavior

### Phase 2 — Connection layer

- [ ] Add `pg` driver; remove `better-sqlite3`
- [ ] Update `src/db/connection.ts` to use a pool
- [ ] Add connection env vars (`PG_URL`) to `.env.example`

### Phase 3 — Migration

- [ ] Write one-shot data export from SQLite to CSV
- [ ] Write Postgres schema migration (use existing migration tool)
- [ ] Write import script and verify row counts match

### Phase 4 — Validation

- [ ] Run the full test suite against Postgres
- [ ] Compare query plans for the three hottest queries
- [ ] Update CI to spin up Postgres instead of SQLite
```

---

## Claude's summary

> Created **QT-001** with a 4-phase breakdown (schema, connection layer, migration,
> validation). Total: 11 subtasks. The plan is in
> `.planr/quick/QT-001-migrate-from-sqlite-to-postgres.md`.
>
> Want me to start with Phase 1 — Schema? If this grows, we can promote it to a
> proper user story under a feature later with `planr quick promote QT-001 --feature FEAT-XXX`.

---

## When to reach for `quick` vs `task`

- **`quick`** — no existing hierarchy; one-off work; you don't need acceptance criteria or story linkage.
- **`task create --story US-XXX`** — work is already scoped under an epic/feature/story; the agent needs the full context chain when implementing.

## Optional follow-ups

- Link to an epic at creation: `planr quick create "..." --epic EPIC-001 --yes` — the QT then cascades with `planr linear push EPIC-001`.
- Promote later when scope grows: `planr quick promote QT-001 --feature FEAT-005`.
