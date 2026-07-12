# stack.md — Project Technical Configuration

> **Owner:** Tech Lead
> **Purpose:** Single source of truth for technology choices. Read by every agent.
>
> **Note for this codebase:** planr-pipeline is a Claude Code plugin built almost
> entirely from markdown. Executable JS uses Node stdlib only (no npm runtime deps).
> `conformance/runner.mjs` stays dependency-free for operators; SPEC-007 adds
> `tests/` + `npm test`. `package.json` exists only as a thin npm script façade.

---

## Project Identity

```yaml
schemaVersion: "1.0.0"
AppName: "planr-pipeline"
Version: "0.25.1"
Description: "Portable OpenPlanr PO, Design, DEV, QA, and delivery pipeline (Protocol v1.0 artifacts + v1.1 ecosystem contracts)"
Repository: "https://github.com/openplanr/planr-pipeline"
```

---

## Database

```yaml
DatabaseType: ""          # not applicable — plugin has no DB
DatabaseHost: ""
DatabasePort: ""
DatabaseName: ""
DatabaseUser: ""
DatabasePassword: ""
ORM: ""
MigrationTool: ""
```

---

## Backend Stack

```yaml
Language: "JavaScript (Node ESM)"
Framework: "Portable Node engine with runtime adapters"
RuntimeVersion: "Node 20+"
AuthStrategy: ""
APIStyle: ""
TestFramework: "node:test (stdlib) — SPEC-007 suite under tests/"
```

---

## Frontend Stack

```yaml
UIFramework: ""           # plugin has no UI
CSSStrategy: ""
ComponentLibrary: ""
StateManagement: ""
FormLibrary: ""
HTTPClient: ""
```

---

## DevOps / Infrastructure

```yaml
ContainerRuntime: ""      # distributed through npm plus runtime-native adapters
Orchestration: ""
CIProvider: "GitHub Actions"
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

FolderStructure: "domain-based (agents/, commands/, docs/, schemas/, templates/, conformance/)"
TestCoverage: "unit (schema validation), integration (conformance runner)"
```

---

## Build & Test Commands (used by DEV agents' correction loop)

> There is no compiled build. Tier-1/Tier-2 tests run via `npm test`; the
> conformance runner remains an optional auxiliary checker for fixture drops.

```yaml
BuildCommand: "node --check conformance/runner.mjs && node --check conformance/json-schema-validate.mjs"
TestCommand: "npm test"
LintCommand: ""
TypeCheckCommand: ""
```

---

## Active Stacks (from .claude/stacks/)

> The plugin ships defaults under `${CLAUDE_PLUGIN_ROOT}/stacks/...`; user
> overrides at `.claude/stacks/...` always win on filename collision.
> This codebase has no active stack overlays — it is a markdown-and-script
> plugin, not an application using a framework stack.

```yaml
ActiveStackFiles: []
```

---

## Exclusions / Constraints

```yaml
DoNotUse:
  - "Third-party npm packages in conformance/runner.mjs (stdlib only — preserves zero-dep posture)"
  - "TypeScript or compiled build steps for the plugin itself"

MustPreserve:
  - "agents/*.md YAML frontmatter `tools:` field — manifest-enforced security boundary"
  - "schemas/v1.0.0/ as the canonical v1.0.0 protocol schema source"
  - "conformance/expected/*.json fixture goldens"
```

---

*Read by: every subagent in the planr-pipeline plugin.*
*Updated by: Tech Lead only.*
