---
name: snapshot
description: Use this skill to refresh CLAUDE.md with the current project state (phase status, features, agents, build log, known issues, stack). Always run after a DEV phase completes; safe to run manually any time. Trigger phrases: "refresh snapshot", "update CLAUDE.md", "snapshot the project".
argument-hint: [project-name]
allowed-tools: Read, Glob, Grep, Write, Edit
---

# Skill: snapshot

> **Type:** Project state snapshot generator
> **Output:** `CLAUDE.md` (project root) — always overwrites
> **Purpose:** Keep a live, accurate record of project state for agent context

## Trigger

```
/openplanr-pipeline:snapshot {project}
```

Three invocation paths, in priority order:

1. **Explicit call from `/openplanr-pipeline:ship` (primary).** Step 5 of `commands/ship.md` invokes this skill after qa-agent + devops-agent + doc-gen-agent complete.
2. **Stop hook reminder (safety net).** `hooks/hooks.json` registers a Stop hook that prints a reminder if `.claude/.snapshot-pending` exists when the session ends. Stop hooks cannot directly invoke slash commands, so this is advisory only.
3. **Manual.** Any time the Tech Lead wants a fresh snapshot — after editing a US, hand-fixing generated code, or running db-agent in isolation.

Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R7, `CLAUDE.md` MUST be current before any subsequent agent run.

## What Gets Captured

### 1. Project Identity
- `AppName`, `Version`, `DatabaseType` from `input/tech/stack.md`
- Generation timestamp

### 2. Phase Status
Scans the filesystem to determine actual state:
- DB Prep: checks if `output/db/schema.json` exists and is non-empty
- PO Phase: counts US + task files in `output/feats/`
- DEV Phase: counts generated source files in `src/features/` + feature folders

### 3. Feature Registry
For each folder in `output/feats/feat-*/`:
- Count US directories
- Count task files
- Detect presence of `design-spec.md`
- Read status fields from US files

### 4. Active Agents
- Lists all agents in `${CLAUDE_PLUGIN_ROOT}/agents/*.md`
- Reports model assignments and tool restrictions
- Shows last invocation timestamp (from build log if available)

### 5. Build Log
- Appends the latest build events
- Does NOT truncate — append-only history

### 6. Known Issues / Escalations
- Scans all `error-report.md` files in `output/feats/feat-*/us-*/tasks/error-report.md`
- Each entry includes: feature, US, task, agent, suspected root cause, recommended action
- Lists items that exceeded 3 correction iterations per R6

### 7. Stack Summary
- Full copy of `input/tech/stack.md` content embedded

## Output Format

Overwrites `CLAUDE.md` at the project root using `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.tpl` as the layout.

## Snapshot Integrity Rules

```
✅ Always write a complete, valid CLAUDE.md — never partial
✅ Always include generatedAt timestamp
✅ Preserve existing build log entries (append only — never truncate)
✅ If a scan fails for a section — write "[scan error]" not empty
❌ Never delete CLAUDE.md
❌ Never leave CLAUDE.md in a partially written state
```

## Usage in Agent Context

All subagents read `CLAUDE.md` at the start of their run to understand:
- Current project state
- Which features are complete vs pending
- Any known issues from previous runs
- Active stack configuration

This prevents subagents from re-doing work or conflicting with prior outputs.

## Post-run

On successful write, remove `.claude/.snapshot-pending` if it exists (silences the Stop hook reminder).

---

*Reads: entire project filesystem · `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.tpl`*
*Writes: `CLAUDE.md` only*
*Auto-invoked by: `/openplanr-pipeline:ship` Step 5*
