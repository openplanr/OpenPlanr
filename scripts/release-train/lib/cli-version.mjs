import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/u;

function parts(version) {
  const match = STABLE.exec(version);
  if (!match) throw new Error(`Not a stable x.y.z version: ${version}`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

/** ISO week-year and week of a UTC date as one number: 2026 week 39 is 2639. */
export function releaseWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // The ISO week belongs to the year that contains its Thursday.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return (year % 100) * 100 + week;
}

/**
 * The CLI version for a pending release: `<major>.<release week>.<n>`, where `n` counts
 * earlier releases published in the same week. Returns null when `current` is already published.
 */
export function cliReleaseVersion({ current, published, date }) {
  const stable = published.filter((version) => STABLE.test(version));
  if (stable.includes(current)) return null;
  const [major] = parts(current);
  const week = releaseWeek(date);
  const patches = stable
    .map(parts)
    .filter(([otherMajor, minor]) => otherMajor === major && minor === week)
    .map(([, , patch]) => patch);
  const next = `${major}.${week}.${patches.length ? Math.max(...patches) + 1 : 0}`;
  const newest = stable.reduce((best, version) => (compare(version, best) > 0 ? version : best), '0.0.0');
  if (compare(next, newest) <= 0) {
    throw new Error(`openplanr ${next} would not be newer than the published ${newest}; release week ${week} is behind the registry.`);
  }
  return next;
}

/** Rewrite the CLI manifest version and the changelog heading Changesets wrote for it. */
export function applyCliVersion({ root, from, to }) {
  const manifestPath = join(root, 'packages/cli/package.json');
  const changelogPath = join(root, 'packages/cli/CHANGELOG.md');
  const manifest = readFileSync(manifestPath, 'utf8');
  const changelog = readFileSync(changelogPath, 'utf8');
  const versionLine = `"version": "${from}"`;
  const heading = `\n## ${from}\n`;
  if (manifest.split(versionLine).length !== 2) throw new Error(`packages/cli/package.json does not declare version ${from} exactly once`);
  if (changelog.split(heading).length !== 2) throw new Error(`packages/cli/CHANGELOG.md does not have exactly one "## ${from}" section`);
  if (changelog.includes(`\n## ${to}\n`)) throw new Error(`packages/cli/CHANGELOG.md already has an unpublished ${to} section; publish that release before versioning again`);
  writeFileSync(manifestPath, manifest.replace(versionLine, `"version": "${to}"`));
  writeFileSync(changelogPath, changelog.replace(heading, `\n## ${to}\n`));
}
