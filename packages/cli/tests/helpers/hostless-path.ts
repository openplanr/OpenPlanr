import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

const HOST_EXECUTABLES = ['agent', 'claude', 'codex', 'cursor', 'cursor-agent', 'gh'];

function hasHost(directory: string): boolean {
  return HOST_EXECUTABLES.some((name) => {
    try {
      accessSync(join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** Returns `path` without the directories that hold a host CLI, so discovery sees none installed. */
export function hostlessPath(path = process.env.PATH ?? ''): string {
  return path
    .split(delimiter)
    .filter((directory) => directory && !hasHost(directory))
    .join(delimiter);
}
