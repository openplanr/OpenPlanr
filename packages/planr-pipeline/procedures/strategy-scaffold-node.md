# Procedure: Strategy `SCAFFOLD_NODE` (Step 0.6)

Greenfield directory + Node-stack brief. Intent is unambiguous. **Auto-scaffold without a consent prompt** — premium UX dictates the system act on clear intent.

**Execute as an explicit checklist.** Add these items to the TodoWrite list (under Phase A) and check them off as you complete each:

```
SCAFFOLD_NODE checklist (each must complete before continuing):
  1. Identify primary framework from BRIEF
  2. Stage pre-existing assets via STAGE_DESIGN_ASSETS (invoke `${CLAUDE_PLUGIN_ROOT}/procedures/stage-design-assets.md`)
  3. Verify project root is now empty (or contains only hidden files)
  4. Announce scaffolding
  5. Run framework scaffolder
  6. Install additional deps from BRIEF
  7. Run post-scaffold init commands implied by BRIEF
  8. Apply WRITE_PLANR_DIRS (`${CLAUDE_PLUGIN_ROOT}/procedures/write-planr-dirs.md`)
  9. Apply AUTHOR_STACK_FROM_BRIEF (`${CLAUDE_PLUGIN_ROOT}/procedures/author-stack-from-brief.md`)
  10. Apply RESTORE_DESIGN_ASSETS (invoke `${CLAUDE_PLUGIN_ROOT}/procedures/restore-design-assets.md`) — copy stash into the spec design folder later (after Step 1 spec scaffold)
  11. Mark Phase A complete; continue to Phase B (Step 1)
```

Do not skip ahead. Do not return until item 11 is done.

**1. Identify primary framework from `BRIEF`.**

The "primary" framework is the one that defines the project shape — typically the first one mentioned, or the one most prominently described:

- "Next.js + Prisma + Postgres" → primary is **Next.js**
- "NestJS + TypeORM + Postgres + Redis" → primary is **NestJS**
- "Vite + React + Tailwind" → primary is **Vite (React)**
- "Astro + Solid" → primary is **Astro**

If `BRIEF` mentions multiple top-level frameworks at the same level (rare hybrid), pick the one with a canonical CLI scaffolder. If still ambiguous, default to **Next.js**.

**2.** Before running any scaffolder, load and execute **`${CLAUDE_PLUGIN_ROOT}/procedures/stage-design-assets.md`**.

**3. Verify project root is empty.**

After `STAGE_DESIGN_ASSETS`, run `ls -A` on the project root. Acceptable contents:

- Empty directory
- Only hidden entries (`.git/`, `.gitignore`)

If anything else remains (files we don't recognize), abort with:

```
⚠ Project root contains files we don't auto-stage: <list>
  STAGE_DESIGN_ASSETS only handles known design asset patterns
  (Designs/, design/, mockups/, *.png, *.jpg, *.svg, etc.).

  Please move these aside or delete them, then re-run.
```

This is the **only** scaffolder-blocker recovery the pipeline owns.

**4. Announce.**

```
→ State: scaffold-node
  Scaffolding <framework> from your brief. ~2 min.
  Press Esc to abort.
```

**5. Run the framework's canonical scaffolder** in the (now empty) project root.

Defaults (override only when `BRIEF` explicitly says otherwise):

- TypeScript by default (`--ts`, `--typescript`, `--template <name>-ts`, etc.)
- Skip git init (`--no-git`, `--skip-git`)
- Pin npm (`--use-npm`, `--package-manager npm`)
- Skip auto-install (`--skip-install`) when offered — run `npm i` explicitly afterward

Supported scaffolders (illustrative; know current docs if flags changed):

| Framework | Canonical scaffold command |
|---|---|
| Next.js | `npx create-next-app@latest .` |
| NestJS | `npx @nestjs/cli@latest new .` |
| Vite (React / Vue / Svelte / Solid / Lit) | `npm create vite@latest .` |
| Nuxt | `npx nuxi@latest init .` |
| Astro | `npm create astro@latest .` |
| Remix | `npx create-remix@latest .` |
| SvelteKit | `npm create svelte@latest .` |
| Hono | `npm create hono@latest .` |
| SolidStart | `npm create solid@latest .` |
| Fastify | `npm init -y` + `npm i fastify` + minimal `src/server.ts` |
| Express | `npm init -y` + `npm i express` + minimal `src/server.ts` |

If no CLI, fall back to `npm init` + minimal entry.

**6. Install deps:** `npm i` / `npm i -D` per `BRIEF` (batch when possible).

**7. Post-scaffold init:** Prisma → `npx prisma init …`; Drizzle → hand schema later; other tooling per brief.

**8. Print:** `✓ Project scaffolded.`

**9.** Run `${CLAUDE_PLUGIN_ROOT}/procedures/write-planr-dirs.md`.

**10.** Run `${CLAUDE_PLUGIN_ROOT}/procedures/author-stack-from-brief.md` (no-op when `BRIEF` is empty or has no stack hints).

**11. Print:** `✓ Bootstrapped .planr/. Continuing to PO Phase.` **You are not done** until Step 1 + Step 2 + Completion Contract pass. `RESTORE_DESIGN_ASSETS` runs inside Step 1 once the spec's `design/` folder exists.

**Error handling.** If any scaffolder command fails:

1. Run recovery from `restore-design-assets.md` **failure path** (move stash back to project root).
2. Abort with failed step + error message.

Do **not** improvise recovery beyond the designed `STAGE_DESIGN_ASSETS` / `RESTORE_DESIGN_ASSETS` pair.
