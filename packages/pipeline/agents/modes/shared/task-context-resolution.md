<!-- Shared by backend and frontend roles in both planning modes. -->

## Active task context

When Ship supplies a task, load that exact task before implementation. The
mode-specific file defines how to resolve its path and parent artifacts.

1. Read the task frontmatter: `id`, `storyId`, `specId` or `featureSlug`, `type`,
   `agent`, `status`, `dependsOn`, and structured `preserve` entries.
2. Read the task body: Objective, Implementation or Technical Spec,
   Verification or Test Requirements, Done When or Definition of Done, and the
   Create, Modify, and Preserve sections. These fields describe the intended
   implementation and output shape; do not reduce the task to its filename.
3. Follow `storyId` to the parent story Markdown, which owns the canonical story
   acceptance criteria, then read the enclosing specification. Load a matching
   Gherkin sidecar when one exists; its absence is not an error. Load only the
   portions relevant to the active task plus the connected source files and
   interfaces needed to make the change correctly.
4. Treat `dependsOn` as real output dependency context. For each listed task,
   inspect the output contract or implemented interface consumed by the active
   task. Do not infer ordering from shared paths, file overlap, or prose. An
   absent or empty `dependsOn` list means there is no declared predecessor.
5. Read `input/tech/stack.md`, including its build, test, lint, type-check, naming,
   and architecture conventions. For every `ActiveStackFiles` entry:
   - normalize it to the logical path below `stacks/` (for example,
     `frontend/nextjs.md` or `database/prisma.md`);
   - read the installed default at
     `${CLAUDE_PLUGIN_ROOT}/stacks/<logical-path>` when present;
   - then read `.claude/stacks/<logical-path>` when present.

   The project-local stack file overrides the installed default on a collision.
   Existing project code and configuration remain the primary reference for how
   the selected conventions are applied in this repository.
6. Parse Create and Modify as the expected change surface and Preserve as paths
   that must remain unchanged. Keep the task's technical requirements and
   acceptance criteria visible while choosing any directly required companion
   files.

If no task was supplied because the role was invoked directly, a complete user
request and repository context can provide the implementation context. If Ship
did supply a task selector but it resolves to zero or multiple files, report the
selector, searched location, and matching candidates instead of guessing.

## Result format

Return one concise implementation result:

- **Outcome:** a `status` of completed, partial, or blocked, plus a concise
  `summary`.
- **Task:** `planr-task` with its ID and path, or `direct-request` when no task
  artifact was used.
- **Changed:** each path and its purpose, including directly required companion
  files not named by the task.
- **Checks:** each command, its passed, failed, or not-run status, and a concise
  detail.
- **Issues:** always include this field. For each issue, give the problem, impact,
  and next action; write `none` when the issues array is empty.

Do not create a separate error report, activity log, or other workflow artifact
unless the caller explicitly requests that output.
