# stack.md — Fixture Technical Configuration

> Minimal authoritative gate source for the legacy-planning fixture. The commands
> are deliberately inert: this fixture is read to build a working context, never
> executed.

## Project Identity

```yaml
schemaVersion: "1.0.0"
AppName: "legacy-planning-fixture"
Version: "1.0.0"
Description: "Fixture plan authored before the orchestration fields were removed"
Repository: "https://example.invalid/legacy-planning-fixture"
```

## Commands

```yaml
BuildCommand: "node --version"
TestCommand: "node --version"
LintCommand: ""
TypeCheckCommand: ""
```

## Active Stack Overlays

```yaml
ActiveStackFiles:
  - .codex/stacks/backend/nestjs.md
```
