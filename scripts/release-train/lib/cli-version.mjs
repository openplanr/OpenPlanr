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

/**
 * Checks the CLI version Changesets wrote against the registry.
 * Returns false when `current` is already published; throws when it is not newer than every published version.
 */
export function assertCliVersionAhead({ current, published }) {
  const stable = published.filter((version) => STABLE.test(version));
  if (stable.includes(current)) return false;
  const newest = stable.reduce(
    (best, version) => (compare(version, best) > 0 ? version : best),
    '0.0.0',
  );
  if (compare(current, newest) <= 0) {
    throw new Error(`openplanr ${current} would not be newer than the published ${newest}.`);
  }
  return true;
}
