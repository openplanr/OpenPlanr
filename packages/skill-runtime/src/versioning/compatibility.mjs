export const VERSION_DIMENSIONS = Object.freeze([
  'source',
  'module',
  'host-profile',
  'skill',
  'asset',
]);

export const CHANGE_KINDS = Object.freeze([
  'none',
  'editorial',
  'compatible',
  'behavior',
  'breaking',
]);

const BUMP_RANK = Object.freeze({ none: 0, patch: 1, minor: 2, major: 3 });
const REQUIRED_BUMP = Object.freeze({
  source: Object.freeze({
    none: 'none',
    editorial: 'patch',
    compatible: 'minor',
    behavior: 'minor',
    breaking: 'major',
  }),
  module: Object.freeze({
    none: 'none',
    editorial: 'patch',
    compatible: 'minor',
    behavior: 'minor',
    breaking: 'major',
  }),
  'host-profile': Object.freeze({
    none: 'none',
    editorial: 'patch',
    compatible: 'minor',
    behavior: 'minor',
    breaking: 'major',
  }),
  skill: Object.freeze({
    none: 'none',
    editorial: 'patch',
    compatible: 'minor',
    behavior: 'minor',
    breaking: 'major',
  }),
  asset: Object.freeze({
    none: 'none',
    editorial: 'patch',
    compatible: 'patch',
    behavior: 'minor',
    breaking: 'major',
  }),
});

function parseVersion(value, label) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value ?? '');
  if (!match) throw new TypeError(`${label} must be an exact semantic version.`);
  return match.slice(1).map(Number);
}

export function classifyVersionBump(previousVersion, nextVersion) {
  const previous = parseVersion(previousVersion, 'previousVersion');
  const next = parseVersion(nextVersion, 'nextVersion');
  if (
    next[0] < previous[0] ||
    (next[0] === previous[0] && next[1] < previous[1]) ||
    (next[0] === previous[0] && next[1] === previous[1] && next[2] < previous[2])
  ) {
    return 'regression';
  }
  if (next[0] > previous[0]) return 'major';
  if (next[1] > previous[1]) return 'minor';
  if (next[2] > previous[2]) return 'patch';
  return 'none';
}

export function requiredVersionBump(dimension, changeKind) {
  if (!VERSION_DIMENSIONS.includes(dimension))
    throw new TypeError(`Unknown version dimension: ${dimension}.`);
  if (!CHANGE_KINDS.includes(changeKind))
    throw new TypeError(`Unknown change kind: ${changeKind}.`);
  return REQUIRED_BUMP[dimension][changeKind];
}

export function assessVersionChange({ dimension, changeKind, previousVersion, nextVersion } = {}) {
  const required = requiredVersionBump(dimension, changeKind);
  const actual = classifyVersionBump(previousVersion, nextVersion);
  const pass =
    actual !== 'regression' &&
    (changeKind === 'none' ? actual === 'none' : BUMP_RANK[actual] >= BUMP_RANK[required]);
  return Object.freeze({
    dimension,
    changeKind,
    previousVersion,
    nextVersion,
    required,
    actual,
    pass,
    reason: pass
      ? 'version-policy-satisfied'
      : actual === 'regression'
        ? 'version-regressed'
        : 'version-bump-too-small',
  });
}

export function assessVersionSet(changes) {
  if (!Array.isArray(changes) || changes.length === 0)
    throw new TypeError('changes must be a non-empty array.');
  const results = changes.map(assessVersionChange);
  const dimensions = new Set(results.map(({ dimension }) => dimension));
  return Object.freeze({
    kind: 'skill-version-compatibility-report',
    schemaVersion: '1.0.0',
    passed: results.every(({ pass }) => pass),
    complete: VERSION_DIMENSIONS.every((dimension) => dimensions.has(dimension)),
    results,
  });
}
