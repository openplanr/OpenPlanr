---
name: init
description: Use this skill in a fresh project to scaffold the openplanr-pipeline directory structure (input/, output/, Docs/, CLAUDE.md, sample spec, sample stack.md). Idempotent — safe to re-run; only fills in missing pieces. Trigger phrases like "init the framework", "set up openplanr-pipeline", "bootstrap a new project".
argument-hint: [project-name]
allowed-tools: Read, Write, Bash(mkdir:*), Bash(test:*), Bash(touch:*)
---

# Skill: init

> **Type:** Project bootstrap
> **Owner:** Anyone (run once per project)
> **Output:** Creates `input/`, `output/`, `Docs/`, plus seed files (`CLAUDE.md`, `input/tech/stack.md`, `input/specs/spec-example.md`)
> **Purpose:** One-command setup so a fresh project can immediately use `/po-phase` and `/dev-phase`

## Trigger

```
/openplanr-pipeline:init [project-name]
```

The optional `project-name` is used only in the seed `CLAUDE.md` header. If omitted, derives from the current working directory's basename.

## Pre-flight check

1. Verify `${CLAUDE_PLUGIN_ROOT}` resolves (the plugin must be installed). If it doesn't, abort with: `"Plugin not installed correctly. Run /plugin install openplanr-pipeline@openplanr."`
2. Verify the current working directory is writable.

## Idempotent behavior

This skill **never overwrites existing files.** Re-running it is safe — it only fills in missing pieces. Each step checks for existence first.

## Steps

### 1 — Create directory structure

```bash
mkdir -p input/specs input/tech input/ui
mkdir -p output/db output/feats output/src
mkdir -p Docs
```

For each created directory, drop a `.gitkeep` so the empty dir survives commits:
```bash
touch input/specs/.gitkeep input/tech/.gitkeep input/ui/.gitkeep
touch output/db/.gitkeep output/feats/.gitkeep output/src/.gitkeep
touch Docs/.gitkeep
```

### 2 — Seed `input/tech/stack.md`

If `input/tech/stack.md` does NOT exist:
- Read `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`
- Substitute `[PROJECT NAME]` placeholder with the resolved project-name (argument or basename)
- Write to `input/tech/stack.md`

If it exists: skip silently and log "stack.md already present, leaving unchanged".

### 3 — Seed `CLAUDE.md`

If `CLAUDE.md` does NOT exist:
- Read `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.tpl`
- Substitute `[AUTO: AppName from stack.md]` and timestamp placeholders
- Write to `CLAUDE.md`

If it exists: skip silently. (The `/snapshot` skill is the official maintainer of `CLAUDE.md` after first run.)

### 4 — Seed `input/specs/spec-example.md`

If `input/specs/spec-example.md` does NOT exist AND `input/specs/` is empty:
- Read `${CLAUDE_PLUGIN_ROOT}/templates/spec.md.tpl`
- Write to `input/specs/spec-example.md` so first-time users have a concrete reference.

If `input/specs/` already contains any spec files: skip silently.

### 5 — Print "Next Steps" guide

```
✓ openplanr-pipeline initialized in {project-name}

Next steps:
  1. Edit input/tech/stack.md to match your real stack (Language, Framework, ORM, build/test commands)
  2. Author your first spec: /openplanr-pipeline:shape-spec {feature-name}
     OR copy input/specs/spec-example.md and edit
  3. (Optional) Drop UI mockups into input/ui/feat-{feature-name}/*.png
  4. Run the PO Phase: /openplanr-pipeline:po-phase {feature-name}
  5. Review the decomposition: /openplanr-pipeline:review-tasks {feature-name}
  6. Run the DEV Phase: /openplanr-pipeline:dev-phase {feature-name}

Recommended .gitignore additions (NOT applied automatically — left to you):
  output/        # if your output/ folder is purely generated artifacts
  .claude/.snapshot-pending   # transient sentinel
```

## Notes

- This skill does NOT modify `.gitignore` (we don't know your conventions).
- This skill does NOT install dependencies, set up a database, or run any build.
- Re-run any time after editing the plugin to reseed missing files.

---

*Reads: `${CLAUDE_PLUGIN_ROOT}/templates/*`*
*Writes: `input/`, `output/`, `Docs/`, `CLAUDE.md` (only if missing), seed files (only if missing)*
*Idempotent: never overwrites*
