import { homedir } from 'node:os';
import { resolve } from 'node:path';

// design-handoff.mjs:611-621
export function findArtifactProjectRoot(start = process.cwd(), { env = process.env } = {}) {
  const homeCandidate = resolve(env.HOME ?? homedir());
  return { start, homeCandidate };
}
