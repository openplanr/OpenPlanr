import { checkbox, confirm, editor, input, password, select } from '@inquirer/prompts';
import { logger } from '../utils/logger.js';
import { isNonInteractive } from './interactive-state.js';

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

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  if (isNonInteractive()) {
    logger.dim(`  [auto] ${message} → ${defaultValue ? 'yes' : 'no'}`);
    return defaultValue;
  }
  return confirm({ message, default: defaultValue });
}

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

export async function promptSecret(message: string): Promise<string> {
  if (isNonInteractive()) {
    logger.dim('  [auto] Skipping secret prompt (set via environment variable)');
    return '';
  }
  return password({ message, mask: '*' });
}

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
