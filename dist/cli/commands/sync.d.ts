/**
 * `planr sync` command.
 *
 * Validates and repairs cross-references across all artifacts:
 *   - Removes links to non-existent artifacts
 *   - Adds missing links (e.g., feature references epic but epic doesn't list it)
 *   - Deduplicates link lists
 *   - Reports all fixes
 */
import type { Command } from 'commander';
export declare function registerSyncCommand(program: Command): void;
//# sourceMappingURL=sync.d.ts.map