# Procedure: `WRITE_PLANR_DIRS` (common — invoked by `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`)

Writes the minimal `.planr/` scaffolding plus the `input/tech/` directory used by every downstream agent. Idempotent: safe to re-run; existing files are not overwritten unless the calling strategy explicitly requests it.

1. Write `.planr/config.json` with derived values:

   ```json
   {
     "projectName": "<package.json#name OR working dir basename>",
     "outputPaths": { "agile": ".planr" },
     "idPrefix": { "spec": "SPEC" }
   }
   ```

2. Create `.planr/specs/` if absent.
3. Create `input/tech/` if absent.

Returns control to the calling strategy. Strategies typically run `AUTHOR_STACK_FROM_BRIEF` (`${CLAUDE_PLUGIN_ROOT}/commands/procedures/author-stack-from-brief.md`) immediately after, when `BRIEF` mentions stack components.
