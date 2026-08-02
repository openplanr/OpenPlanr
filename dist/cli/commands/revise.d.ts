/**
 * `planr revise` command.
 *
 * Runs the revise safety pipeline for a single artifact or a cascade:
 *
 *   1. **Clean-tree gate** — unless --allow-dirty.
 *   2. **Agent decision** — per artifact.
 *   3. **Evidence verification** — unverifiable evidence
 *      is dropped; revise → flag demotion when nothing survives.
 *   4. **Diff preview + confirmation** — per artifact.
 *   5. **Atomic write + audit log**.
 *
 * In `--cascade` mode, the cascade service drives the pipeline
 * top-down (epic → features → stories → tasks). Children always see the
 * *revised* parent because they are loaded fresh from disk between steps.
 * `[q]uit` and SIGINT stop the cascade gracefully — already-applied
 * artifacts stay applied, audit entries flush immediately.
 *
 * The `--all` flag + post-flight rollback extension layers on top of this
 * command.
 */
import type { Command } from 'commander';
export declare function registerReviseCommand(program: Command): void;
//# sourceMappingURL=revise.d.ts.map