/**
 * `planr spec` command group — spec-driven planning mode.
 *
 * The third planning posture alongside agile (epic/feature/story/task) and
 * QT (quick task). Specs decompose into nested User Stories and Tasks with
 * the same artifact contract as the `planr-pipeline` Claude Code plugin
 * (file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD
 * with build/test commands). Pairs with the pipeline plugin via shared
 * schema — no conversion layer ever.
 *
 * See `docs/proposals/spec-driven-mode.md` for the full design.
 *
 * Subcommands:
 *   - planr spec init                    Activate spec-driven mode
 *   - planr spec create <title>          Create a new SPEC artifact (self-contained dir)
 *   - planr spec shape <id>              Interactive 4-question SPEC authoring
 *   - planr spec decompose <id>          AI-driven US + Task generation
 *   - planr spec sync [id]               Validate integrity + auto-fix safe issues
 *   - planr spec list                    List all specs
 *   - planr spec show <id>               Print a spec + its US/Task tree
 *   - planr spec status [id]             Decomposition state per spec
 *   - planr spec destroy <id>            rm -rf one self-contained spec dir
 *   - planr spec attach-design <id> --files <png>...   Attach UI mockups
 *   - planr spec promote <id>            Validate + print pipeline handoff
 */
import type { Command } from 'commander';
export declare function registerSpecCommand(program: Command): void;
//# sourceMappingURL=spec.d.ts.map