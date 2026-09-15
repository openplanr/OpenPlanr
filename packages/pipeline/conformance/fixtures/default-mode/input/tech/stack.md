# Tech Stack — todo-feature default-mode conformance fixture

> **Owner:** conformance harness
> **Purpose:** Minimal stack for the `feat-todo` default-mode fixture used to verify
> cross-runtime adapter conformance against the OpenPlanr Protocol v1.0.0 reader.
>
> All canonical keys are encoded as YAML inside fenced code blocks so the
> conformance runner's `parseStackMd` extractor can merge them into a single
> flat object for `stack.schema.json` validation.

---

## Schema Pin

```yaml
schemaVersion: "1.0.0"
```

---

## Project Identity

```yaml
AppName: "todo-feature-conformance"
Version: "0.1.0"
Description: "Conformance test fixture for OpenPlanr Protocol v1.0.0 — a single pure function addTodo (default-mode variant)."
```

---

## Database

```yaml
DatabaseType: ""
DatabaseHost: ""
DatabasePort: ""
DatabaseName: ""
DatabaseUser: ""
DatabasePassword: ""
ORM: ""
MigrationTool: ""
```

This fixture is purely in-memory; no database interaction.

---

## Backend Stack

```yaml
Language: "TypeScript"
Framework: "Node (plain TypeScript, no framework)"
RuntimeVersion: "Node 20+"
AuthStrategy: ""
APIStyle: ""
TestFramework: "Vitest"
```

---

## Frontend Stack

```yaml
UIFramework: ""
CSSStrategy: ""
ComponentLibrary: ""
StateManagement: ""
FormLibrary: ""
HTTPClient: ""
```

No UI in this fixture.

---

## DevOps / Infrastructure

```yaml
ContainerRuntime: ""
Orchestration: ""
CIProvider: ""
CloudProvider: ""
SecretManagement: ""
```

---

## Code Conventions

```yaml
NamingConvention:
  Files: "kebab-case"
  Components: ""
  Functions: "camelCase"
  Constants: "UPPER_SNAKE_CASE"
  Database:
    Tables: ""
    Columns: ""

FolderStructure: "flat (src/ for sources, tests/ for Vitest specs)"
TestCoverage: "unit (Vitest) — all acceptance criteria covered"
```

---

## Build & Test Commands (used by DEV agents' correction loop)

```yaml
BuildCommand: "npx tsc --noEmit"
TestCommand: "npx vitest run"
LintCommand: ""
TypeCheckCommand: "npx tsc --noEmit"
```

---

## Active Stacks

```yaml
ActiveStackFiles: []
```

No stack overlays — fixture is too small to warrant any framework-specific guidance.

---

## Exclusions / Constraints

```yaml
DoNotUse:
  - "Third-party runtime npm packages (fixture must remain stdlib + Vitest only)"
  - "Mutating array operations on inputs (addTodo must be pure)"

MustPreserve:
  - "input/tech/stack.md (this file — fixture invariant)"
  - "input/specs/spec-todo.md (fixture spec frontmatter)"
```

---

*Read by: every subagent in the planr-pipeline plugin when running against the default-mode conformance fixture.*
*Updated by: conformance harness only.*
