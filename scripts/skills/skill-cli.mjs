import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), 'skill-cli-contracts.json');

function compareVersions(a, b) {
  const [left, right] = [a, b].map((value) => value.split('.').map(Number));
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/** CLI commands runtime skills call, keyed by command, with their contract and first version. */
export const SKILL_CLI_CONTRACTS = Object.freeze(
  JSON.parse(readFileSync(CONTRACTS, 'utf8')).commands,
);

/** Lowest CLI version that serves every runtime skill's commands. */
export const SKILL_CLI_MINIMUM = Object.values(SKILL_CLI_CONTRACTS)
  .map(({ since }) => {
    if (!/^\d+\.\d+\.\d+$/u.test(since))
      throw new Error(`${CONTRACTS} has a non-exact "since" version: ${JSON.stringify(since)}.`);
    return since;
  })
  .sort(compareVersions)
  .at(-1);

/** Fills the exact CLI pin and the minimum into projected skill text. */
export function fillSkillCliTokens(text, pluginVersion) {
  return text
    .replaceAll('{{PLUGIN_VERSION}}', pluginVersion)
    .replaceAll('{{SKILL_CLI_MINIMUM}}', SKILL_CLI_MINIMUM);
}
