# Tech Stack — todo-feature conformance fixture

> Owner: conformance harness
> Purpose: minimal stack for the `feat-todo` fixture used to verify cross-runtime adapter conformance.

## Project Identity

- **AppName:** todo-feature-conformance
- **Version:** 0.1.0
- **Description:** Conformance test fixture for OpenPlanr Protocol v1.0.0 — a single pure function `addTodo`.

## Database

None. This fixture is purely in-memory; no database interaction.

## Backend

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+
- **Module system:** ES Modules (`"type": "module"` in `package.json`)
- **Framework:** None (plain TypeScript)
- **HTTP / API:** None
- **Auth:** None

## Frontend

None. No UI in this fixture.

## Testing

- **Test framework:** Vitest
- **Test command:** `npx vitest run`
- **Coverage:** not measured for this fixture

## Build

- **Build command:** `npx tsc --noEmit` (type-check only; no compiled output)
- **Lint command:** None (fixture is too small to lint)

## DevOps

None. No Docker, no CI workflow generated for this fixture.

## Code conventions

- Files: kebab-case
- Functions: camelCase
- Types: PascalCase
- Strict TypeScript (`strict: true` in `tsconfig.json`)
- Pure functions only — no side effects

## Build / Test / Lint commands (used by the 3-iteration correction loop)

- `BuildCommand: npx tsc --noEmit`
- `TestCommand: npx vitest run`
- `LintCommand: ` (empty — no linter configured)

## Dependencies

```json
{
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^4.0.0",
    "@types/node": "^20.0.0"
  }
}
```

No production dependencies. The fixture's runtime is Node.js standard library only.
