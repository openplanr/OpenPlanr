# stack.md — Project Technical Configuration

> **Owner:** Tech Lead
> **Purpose:** Single source of truth for all technology choices.
> This file is read by the Specification Agent and Backend Agent at every run.
> Edit this file before running any pipeline phase.

---

## Project Identity

```yaml
AppName: "[PROJECT NAME]"
Version: "1.0.0"
Description: "[One-line description of what this app does]"
Repository: "[git URL]"
```

---

## Database

```yaml
DatabaseType: "[PostgreSQL | MySQL | MSSQL | SQLite | MongoDB]"
DatabaseHost: "${DB_HOST}"
DatabasePort: "${DB_PORT}"
DatabaseName: "${DB_NAME}"
DatabaseUser: "${DB_USER}"
DatabasePassword: "${DB_PASSWORD}"
ORM: "[EF Core | Prisma | TypeORM | Drizzle | SQLAlchemy]"
MigrationTool: "[EF Migrations | Flyway | Alembic | Liquibase]"
```

---

## Backend Stack

```yaml
Language: "[C# | TypeScript | Python | Go | Java]"
Framework: "[ASP.NET Core | NestJS | FastAPI | Gin | Spring Boot]"
RuntimeVersion: "[e.g. .NET 8 | Node 20 | Python 3.12]"
AuthStrategy: "[JWT | OAuth2 | Session | API Key]"
APIStyle: "[REST | GraphQL | tRPC | gRPC]"
TestFramework: "[xUnit | Jest | Pytest | Go Test]"
```

---

## Frontend Stack

```yaml
UIFramework: "[Next.js | React | Vue | Nuxt | SvelteKit]"
CSSStrategy: "[Tailwind | CSS Modules | Styled Components | SCSS]"
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

## Build & Test Commands

> Agents use the commands relevant to the active change and its risk. Command
> failures provide diagnostics for direct correction. Leave a field empty only
> when the project genuinely has no corresponding check.

```yaml
BuildCommand: "[npm run build | dotnet build | go build ./... | mvn package]"
TestCommand: "[npm test -- --run | dotnet test | pytest | go test ./...]"
LintCommand: "[npm run lint | dotnet format --verify-no-changes | ruff check]"      # optional, run before build
TypeCheckCommand: "[npx tsc --noEmit | dotnet build /p:TreatWarningsAsErrors=true]" # optional
```

---

## Active Stack Overlays

> Declare logical paths below the installed package's `stacks/` directory.
> Runtime-specific project overrides use the same logical path below the host's
> project stack directory and take precedence on a filename collision.

```yaml
ActiveStackFiles:
  - backend/nestjs.md      # or fastapi.md, springboot.md, etc.
  - frontend/nextjs.md     # or react.md, vue.md, etc.
  - database/prisma.md     # or typeorm.md, ef-core.md, mongodb.md
  - devops/docker-compose.md
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
