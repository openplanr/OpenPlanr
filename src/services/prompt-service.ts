import { checkbox, confirm, editor, input, password, select } from '@inquirer/prompts';
import type { LinearClient } from '@linear/sdk';
import type { LinearMappingStrategy } from '../models/types.js';
import { logger } from '../utils/logger.js';
import { isNonInteractive } from './interactive-state.js';
import { getTeamProjects } from './linear-service.js';

/** Prompt the user for a single line of text input. Falls back to defaultValue in non-interactive mode. */
export async function promptText(message: string, defaultValue?: string): Promise<string> {
  if (isNonInteractive()) {
    if (defaultValue !== undefined) {
      logger.dim(`  [auto] ${message} → "${defaultValue}"`);
      return defaultValue;
    }
    throw new Error(`Non-interactive mode: no default value for prompt "${message}"`);
  }
  return input({ message, default: defaultValue });
}

/** Prompt the user to select one option from a list. */
export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  defaultValue?: T,
): Promise<T> {
  if (isNonInteractive()) {
    const value = defaultValue ?? choices[0].value;
    logger.dim(`  [auto] ${message} → "${value}"`);
    return value;
  }
  return select({ message, choices, default: defaultValue });
}

/** Prompt the user for a yes/no confirmation. */
export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  if (isNonInteractive()) {
    logger.dim(`  [auto] ${message} → ${defaultValue ? 'yes' : 'no'}`);
    return defaultValue;
  }
  return confirm({ message, default: defaultValue });
}

/** Open the user's default editor for multi-line text input. */
export async function promptEditor(message: string, defaultValue?: string): Promise<string> {
  if (isNonInteractive()) {
    if (defaultValue !== undefined) {
      logger.dim(`  [auto] ${message} → (default)`);
      return defaultValue;
    }
    throw new Error(
      `Non-interactive mode: editor prompt requires a default value for "${message}"`,
    );
  }
  return editor({ message, default: defaultValue });
}

/** Prompt the user for sensitive input with masked characters. */
export async function promptSecret(message: string): Promise<string> {
  if (isNonInteractive()) {
    logger.dim('  [auto] Skipping secret prompt (set via environment variable)');
    return '';
  }
  return password({ message, mask: '*' });
}

/** Prompt the user to select multiple options from a checkbox list. */
export async function promptCheckbox<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean }>,
): Promise<T[]> {
  if (isNonInteractive()) {
    const checked = choices.filter((c) => c.checked).map((c) => c.value);
    logger.dim(`  [auto] ${message} → ${checked.length} pre-selected item(s)`);
    return checked;
  }
  return checkbox({ message, choices });
}

/** Prompt the user for comma-separated text values, returned as a trimmed array. */
export async function promptMultiText(message: string, hint?: string): Promise<string[]> {
  if (isNonInteractive()) {
    throw new Error(
      `Non-interactive mode: multi-text prompt "${message}" requires interactive input`,
    );
  }
  const result = await input({
    message: `${message}${hint ? ` (${hint})` : ''}`,
  });
  return result
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Revise command prompts
// ---------------------------------------------------------------------------

/** One action the user can take at the diff-preview prompt for a proposed revise. */
export type ReviseConfirmAction = 'apply' | 'skip' | 'edit-rationale' | 'diff-again' | 'quit';

const REVISE_CONFIRM_CHOICES: Array<{ name: string; value: ReviseConfirmAction }> = [
  { name: '[a] Apply — write this revision to disk', value: 'apply' },
  { name: '[s] Skip — do not write; cascade continues', value: 'skip' },
  { name: '[e] Edit rationale — record a human reason for this decision', value: 'edit-rationale' },
  { name: '[d] Diff again — re-print the diff', value: 'diff-again' },
  { name: '[q] Quit — stop cascade; already-applied artifacts remain applied', value: 'quit' },
];

/**
 * Prompt the user for the per-artifact revise confirmation menu. In
 * non-interactive mode, returns `apply` by default (caller should only
 * enter this path after the typed-YES gate in `confirmBulkRevise`).
 */
export async function promptReviseConfirm(artifactId: string): Promise<ReviseConfirmAction> {
  if (isNonInteractive()) {
    logger.dim(`  [auto] Revise ${artifactId} → apply`);
    return 'apply';
  }
  return select({
    message: `Revise ${artifactId}:`,
    choices: REVISE_CONFIRM_CHOICES,
    default: 'apply',
  });
}

// ---------------------------------------------------------------------------
// Linear integration prompts
// ---------------------------------------------------------------------------

/**
 * First-time epic-push: offer the three mapping strategies and (for
 * `milestone-of` / `label-on`) let the user pick an existing Linear project
 * to attach into. Pure UI + one read-only SDK call (`getTeamProjects`).
 */
export async function promptMappingStrategy(
  client: LinearClient,
  teamId: string,
  epicId: string,
): Promise<{ strategy: LinearMappingStrategy; targetProjectId?: string } | null> {
  if (isNonInteractive()) return null;
  const strategy = await select<LinearMappingStrategy>({
    message: `How should ${epicId} map to Linear?`,
    choices: [
      {
        name: '[a] Create a new Linear project (recommended — Epic = Project, v1 behavior)',
        value: 'project',
      },
      { name: '[b] Attach as a milestone of an existing Linear project', value: 'milestone-of' },
      { name: '[c] Attach as a label on an existing Linear project', value: 'label-on' },
    ],
    default: 'project',
  });
  if (strategy === 'project') {
    return { strategy };
  }
  const projects = await getTeamProjects(client, teamId);
  if (projects.length === 0) {
    logger.warn(
      'This team has no Linear projects yet — falling back to creating a new one (strategy: project).',
    );
    return { strategy: 'project' };
  }
  const targetProjectId = await select<string>({
    message: `Pick the target Linear project for ${epicId}:`,
    choices: projects.map((p) => ({ name: `${p.name}  (${p.url})`, value: p.id })),
  });
  return { strategy, targetProjectId };
}

/**
 * First-time QT / BL push: let the user pick the Linear project that will
 * host `QT-*` and `BL-*` issues (stored in `linear.standaloneProjectId`).
 */
export async function promptStandaloneProject(
  client: LinearClient,
  teamId: string,
): Promise<{ projectId: string; projectName: string } | null> {
  if (isNonInteractive()) return null;
  const projects = await getTeamProjects(client, teamId);
  if (projects.length === 0) {
    logger.warn(
      'This team has no Linear projects yet — create one in Linear first, then re-run the push.',
    );
    return null;
  }
  const choice = await select<string>({
    message: 'Pick the Linear project that will host Planr quick tasks & backlog items:',
    choices: [
      ...projects.map((p) => ({ name: `${p.name}  (${p.url})`, value: p.id })),
      { name: '[cancel]', value: '__cancel__' },
    ],
  });
  if (choice === '__cancel__') return null;
  const picked = projects.find((p) => p.id === choice);
  if (!picked) return null;
  return { projectId: picked.id, projectName: picked.name };
}

/**
 * Typed-YES confirmation gate for `--yes` bulk-apply runs.
 *
 * In an interactive TTY, prints the provided summary and blocks on the user
 * typing "YES" (case-sensitive) to proceed. In non-TTY environments
 * (piped stdout, CI), returns `true` unconditionally — the `--yes` flag
 * alone is the contract with the pipeline, and PR review is the upstream
 * human gate. Returns `false` if the user types anything other than "YES".
 */
export async function confirmBulkRevise(summary: string): Promise<boolean> {
  // Non-TTY: the flag is sufficient. Humans can't type at pipelines.
  if (!process.stdout.isTTY) {
    logger.dim('Non-interactive environment detected — --yes flag accepted without typed-YES.');
    return true;
  }
  if (isNonInteractive()) {
    // Explicit --no-interactive / -y also skips the typed-YES.
    logger.dim('Non-interactive mode — --yes flag accepted without typed-YES.');
    return true;
  }
  logger.info(summary);
  const typed = await input({ message: 'Type YES to continue:' });
  return typed === 'YES';
}
