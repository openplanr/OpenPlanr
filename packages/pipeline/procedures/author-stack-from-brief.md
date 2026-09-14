# Procedure: `AUTHOR_STACK_FROM_BRIEF` (common — invoked by `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`)

Populates `input/tech/stack.md` from a natural-language `BRIEF`. Only runs if `BRIEF` is non-empty AND mentions stack components. If `BRIEF` is empty or has no stack hints, leave `input/tech/stack.md` absent — the existing self-heal in Step 1 (`mode-detection.md`) handles it (writes template verbatim, prompts the user to fill in).

1. Read template: `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`.
2. Populate fields from `BRIEF`:
   - `AppName` from `.planr/config.json#projectName`
   - `Language` (TypeScript / Python / Ruby / Go / etc.)
   - `Framework` (Next.js / Django / Rails / NestJS / etc.)
   - `DatabaseType` (PostgreSQL / MongoDB / MySQL / etc.)
   - `ORM` (Prisma / SQLAlchemy / ActiveRecord / etc.)
   - `TestFramework` (Vitest / Jest / pytest / etc.)
   - `BuildCommand`, `TestCommand` — sane defaults for the chosen stack
3. Write to `input/tech/stack.md`.
4. Print: `✓ Authored input/tech/stack.md from your brief`.

Returns control to the calling strategy. After this procedure, `input/tech/stack.md` is the single source of truth for the project's technology choices and is read by every downstream agent.
