// @ts-check
// Canonical SemVer 2.0.0 grammar (semver.org BNF). One source of truth so the
// skill-source JSON Schema and the compiler graph share a single definition of
// "exact version" and can never drift. Rejects empty dot-separated identifiers,
// leading-zero numeric identifiers, and empty prerelease/build segments.
/** @type {typeof import('./semver.d.mts').SEMVER_PATTERN} */
export const SEMVER_PATTERN =
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$';

/** @type {typeof import('./semver.d.mts').SEMVER_REGEX} */
export const SEMVER_REGEX = new RegExp(SEMVER_PATTERN, 'u');
