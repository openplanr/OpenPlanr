import { input, password, select, confirm, editor, checkbox } from '@inquirer/prompts';

export async function promptText(message: string, defaultValue?: string): Promise<string> {
  return input({ message, default: defaultValue });
}

export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  return select({ message, choices });
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  return confirm({ message, default: defaultValue });
}

export async function promptEditor(message: string, defaultValue?: string): Promise<string> {
  return editor({ message, default: defaultValue });
}

export async function promptSecret(message: string): Promise<string> {
  return password({ message, mask: '*' });
}

export async function promptCheckbox<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean }>
): Promise<T[]> {
  return checkbox({ message, choices });
}

export async function promptMultiText(message: string, hint?: string): Promise<string[]> {
  const result = await input({
    message: `${message}${hint ? ` (${hint})` : ''}`,
  });
  return result
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
