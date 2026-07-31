# stack.md — Project Technical Configuration

> **Owner:** Tech Lead
> **Purpose:** Single source of truth for all technology choices.
> This file is read by the Specification Agent and Backend Agent at every run.
> Edit this file before running any pipeline phase.

---

## Project Identity

```yaml
AppName: "openplanr"
Version: "1.16.2"
Description: "Agile planning CLI for coding agents — operate engine (SPEC-004 agentic execution)"
Repository: "https://github.com/openplanr/OpenPlanr"
```

---

## Database

```yaml
DatabaseType: ""          # not applicable — CLI has no DB
DatabaseHost: "${DB_HOST}"
DatabasePort: "${DB_PORT}"
DatabaseName: "${DB_NAME}"
DatabaseUser: "${DB_USER}"
DatabasePassword: "${DB_PASSWORD}"
ORM: ""
MigrationTool: ""
```

---

## Backend Stack

```yaml
Language: "TypeScript"
Framework: "Node.js CLI (commander)"
RuntimeVersion: "node >=20"
AuthStrategy: ""
APIStyle: "CLI + JSON envelopes"
TestFramework: "Vitest"
```

---

## Frontend Stack

```yaml
UIFramework: ""
CSSStrategy: ""
ComponentLibrary: "[shadcn/ui | MUI | Ant Design | Chakra | None]"
StateManagement: "[Zustand | Redux | Pinia | Jotai | None]"
FormLibrary: "[React Hook Form | Formik | VeeValidate | None]"
HTTPClient: "[Axios | Fetch | SWR | React Query | TanStack Query]"
```

---

## DevOps / Infrastructure

```yaml
ContainerRuntime: "[Docker | Podman | None]"
Orchestration: "[Kubernetes | Docker Compose | None]"
CIProvider: "[GitHub Actions | GitLab CI | CircleCI | None]"
CloudProvider: "[AWS | GCP | Azure | Vercel | Railway | None]"
SecretManagement: "[.env | Vault | AWS Secrets Manager | None]"
```

---

## Code Conventions

```yaml
NamingConvention:
  Files: "[kebab-case | PascalCase | snake_case]"
  Components: "[PascalCase]"
  Functions: "[camelCase | snake_case]"
  Constants: "[UPPER_SNAKE_CASE]"
  Database:
    Tables: "[snake_case | PascalCase]"
    Columns: "[snake_case | camelCase]"

FolderStructure: "[feature-based | layer-based | domain-based]"
TestCoverage: "[unit | integration | e2e | all]"
```

---

## Build & Test Commands (used by DEV agents' correction loop)

> Each DEV agent (Frontend, Backend) runs `BuildCommand` then `TestCommand` after every code generation iteration.
> Failures trigger the 3-iteration correction loop (see `docs/rules.md` R6).
> If empty, the agent skips that step (not recommended — disables the correction gate).

```yaml
BuildCommand: "npm run build"
TestCommand: "npm test"
LintCommand: "[npm run lint | dotnet format --verify-no-changes | ruff check]"      # optional, run before build
TypeCheckCommand: "[npx tsc --noEmit | dotnet build /p:TreatWarningsAsErrors=true]" # optional
```

---

## Active Stacks (from .claude/stacks/)

> Every agent MUST read every file listed here at the start of its run.
> Stack-file conventions (folder layout, naming, build commands) override the generic
> templates inside `agents/*/AGENT.md`.

```yaml
ActiveStackFiles:
  - .claude/stacks/backend/nestjs.md      # or fastapi.md, springboot.md, etc.
  - .claude/stacks/frontend/nextjs.md     # or react.md, vue.md, etc.
  - .claude/stacks/database/prisma.md     # or typeorm.md, ef-core.md, mongodb.md
  - .claude/stacks/devops/docker-compose.md
```

---

## Exclusions / Constraints

```yaml
DoNotUse:
  - "[library or pattern to avoid]"
  - "[deprecated API or approach]"

MustPreserve:
  - "[existing files that must not be overwritten]"
  - "[legacy endpoints that must remain intact]"
```

---

*Read by: Specification Agent · Backend Agent · Frontend Agent*
*Updated by: Tech Lead only*
