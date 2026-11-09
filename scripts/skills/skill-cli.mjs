import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), 'skill-cli-contracts.json');
const EXACT = /^\d+\.\d+\.\d+$/u;

/** Orders exact `major.minor.patch` versions. */
export function compareVersions(a, b) {
  const [left, right] = [a, b].map((value) => value.split('.').map(Number));
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Current contract and first shipping version per command. Throws when a contract row is not an
 * exact version, or when a later contract does not ship in a later CLI version.
 */
export function readSkillCliContracts(commands) {
  return Object.fromEntries(
    Object.entries(commands).map(([command, { contracts }]) => {
      const rows = Object.entries(contracts ?? {})
        .map(([contract, since]) => ({ contract: Number(contract), since }))
        .sort((a, b) => a.contract - b.contract);
      if (rows.length === 0) throw new Error(`${CONTRACTS}: "${command}" lists no contracts.`);
      for (const [index, row] of rows.entries()) {
        if (!Number.isInteger(row.contract) || row.contract < 1 || !EXACT.test(row.since))
          throw new Error(
            `${CONTRACTS}: "${command}" contract ${row.contract} needs a positive integer key and an exact "since" version, got ${JSON.stringify(row.since)}.`,
          );
        const previous = rows[index - 1];
        if (previous && compareVersions(row.since, previous.since) <= 0)
          throw new Error(
            `${CONTRACTS}: "${command}" contract ${row.contract} ships in ${row.since}, not after contract ${previous.contract} (${previous.since}); a contract change needs a later CLI version.`,
          );
      }
      return [command, rows.at(-1)];
    }),
  );
}

/** Each runtime command's current contract and the CLI version that first ships it. */
export const SKILL_CLI_CONTRACTS = Object.freeze(
  readSkillCliContracts(JSON.parse(readFileSync(CONTRACTS, 'utf8')).commands),
);

/** Lowest CLI version that serves every runtime skill's commands. */
export const SKILL_CLI_MINIMUM = Object.values(SKILL_CLI_CONTRACTS)
  .map(({ since }) => since)
  .sort(compareVersions)
  .at(-1);

/** Refuses a release whose plugin would pin a CLI older than its runtime skills need. */
export function assertPinServesSkills(pluginVersion, minimum = SKILL_CLI_MINIMUM) {
  const release = /^\d+\.\d+\.\d+/u.exec(pluginVersion)?.[0];
  if (!release || compareVersions(release, minimum) < 0)
    throw new Error(
      `The plugin pins openplanr@${pluginVersion}, but its runtime skills need ${minimum} or later (scripts/skills/skill-cli-contracts.json). Release ${minimum} or later.`,
    );
}

/** Fills the exact CLI pin and the minimum into projected skill text. */
export function fillSkillCliTokens(text, pluginVersion) {
  return text
    .replaceAll('{{PLUGIN_VERSION}}', pluginVersion)
    .replaceAll('{{SKILL_CLI_MINIMUM}}', SKILL_CLI_MINIMUM);
}
