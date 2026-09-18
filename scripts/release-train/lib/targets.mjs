/** Public packages in publish order: every entry's registry dependencies precede it. */
export const PUBLIC_TARGETS = Object.freeze([
  Object.freeze({
    name: '@openplanr/protocol',
    path: 'packages/protocol',
    tagLatestRelease: false,
  }),
  Object.freeze({
    name: 'planr-pipeline',
    path: 'packages/pipeline',
    tagLatestRelease: false,
  }),
  Object.freeze({
    name: 'openplanr',
    path: 'packages/cli',
    tagLatestRelease: true,
  }),
]);

export function targetByName(name) {
  const target = PUBLIC_TARGETS.find((entry) => entry.name === name);
  if (!target) throw new Error(`Not a public package: ${name}`);
  return target;
}

/** Package-qualified tag name shared by tags, releases and provenance rows. */
export function releaseTag(name, version) {
  return `${name}@${version}`;
}

/** Filesystem-safe directory name for a package's publication bundle. */
export function bundleDirectory(name) {
  return name.replace(/^@/u, '').replace(/\//gu, '__');
}
