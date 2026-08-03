import type { LinearClient } from '@linear/sdk';
import type { LinearMappingStrategy } from '../models/types.js';
/** Prompt the user for a single line of text input. Falls back to defaultValue in non-interactive mode. */
export declare function promptText(message: string, defaultValue?: string): Promise<string>;
/** Prompt the user to select one option from a list. */
export declare function promptSelect<T extends string>(message: string, choices: Array<{
    name: string;
    value: T;
}>, defaultValue?: T): Promise<T>;
/** Prompt the user for a yes/no confirmation. */
export declare function promptConfirm(message: string, defaultValue?: boolean): Promise<boolean>;
/** Open the user's default editor for multi-line text input. */
export declare function promptEditor(message: string, defaultValue?: string): Promise<string>;
/** Prompt the user for sensitive input with masked characters. */
export declare function promptSecret(message: string): Promise<string>;
/** Prompt the user to select multiple options from a checkbox list. */
export declare function promptCheckbox<T extends string>(message: string, choices: Array<{
    name: string;
    value: T;
    checked?: boolean;
}>): Promise<T[]>;
/** Prompt the user for comma-separated text values, returned as a trimmed array. */
export declare function promptMultiText(message: string, hint?: string): Promise<string[]>;
/** One action the user can take at the diff-preview prompt for a proposed revise. */
export type ReviseConfirmAction = 'apply' | 'skip' | 'edit-rationale' | 'diff-again' | 'quit';
/**
 * Prompt the user for the per-artifact revise confirmation menu. In
 * non-interactive mode, returns `apply` by default (caller should only
 * enter this path after the typed-YES gate in `confirmBulkRevise`).
 */
export declare function promptReviseConfirm(artifactId: string): Promise<ReviseConfirmAction>;
/**
 * First-time epic-push: offer the three mapping strategies and (for
 * `milestone-of` / `label-on`) let the user pick an existing Linear project
 * to attach into. Pure UI + one read-only SDK call (`getTeamProjects`).
 */
export declare function promptMappingStrategy(client: LinearClient, teamId: string, epicId: string): Promise<{
    strategy: LinearMappingStrategy;
    targetProjectId?: string;
} | null>;
/**
 * First-time QT / BL push: let the user pick the Linear project that will
 * host `QT-*` and `BL-*` issues (stored in `linear.standaloneProjectId`).
 */
export declare function promptStandaloneProject(client: LinearClient, teamId: string): Promise<{
    projectId: string;
    projectName: string;
} | null>;
/**
 * Typed-YES confirmation gate for `--yes` bulk-apply runs.
 *
 * In an interactive TTY, prints the provided summary and blocks on the user
 * typing "YES" (case-sensitive) to proceed. In non-TTY environments
 * (piped stdout, CI), returns `true` unconditionally — the `--yes` flag
 * alone is the contract with the pipeline, and PR review is the upstream
 * human gate. Returns `false` if the user types anything other than "YES".
 */
export declare function confirmBulkRevise(summary: string): Promise<boolean>;
//# sourceMappingURL=prompt-service.d.ts.map