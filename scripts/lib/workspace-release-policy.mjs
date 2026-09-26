import { SEMVER_REGEX } from '../../packages/protocol/src/semver.mjs';

export const WORKSPACE_IDENTITIES = Object.freeze({
  'packages/cli': 'openplanr',
  'packages/pipeline': 'planr-pipeline',
  'packages/protocol': '@openplanr/protocol',
  'packages/operate': '@openplanr/operate',
  'packages/artifact': '@openplanr/artifact',
  'packages/design': '@openplanr/design',
  'packages/skill-runtime': '@openplanr/skill-runtime',
  'packages/integrations': '@openplanr/integrations',
  'apps/dashboard': '@openplanr/dashboard-app',
});

export const PUBLIC_PACKAGE_PATHS = Object.freeze([
  'packages/cli',
  'packages/pipeline',
  'packages/protocol',
]);

// This allowlist describes ownership, not the current release's version numbers.
// Changesets may update an edge's exact pin, but may not add a new dependency edge.
const internalDependencies = Object.freeze({
  'packages/cli': { optionalDependencies: ['planr-pipeline'] },
  'packages/pipeline': {},
  'packages/protocol': {},
  'packages/operate': { dependencies: ['@openplanr/protocol'] },
  'packages/artifact': { dependencies: ['@openplanr/protocol'] },
  'packages/design': { dependencies: ['@openplanr/artifact', '@openplanr/protocol'] },
  'packages/skill-runtime': { dependencies: ['@openplanr/protocol'] },
  'packages/integrations': {},
  'apps/dashboard': { dependencies: ['@openplanr/protocol'] },
});

export function validateWorkspaceManifests(rootManifest, manifestByPath) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const validVersion = (version) => typeof version === 'string' && SEMVER_REGEX.test(version);
  check(
    rootManifest.name === 'openplanr-workspace',
    'root package name must be openplanr-workspace',
  );
  check(validVersion(rootManifest.version), 'root integration version must be valid SemVer');
  check(rootManifest.private === true, 'root workspace must be npm-private');
  check(
    JSON.stringify(rootManifest.workspaces) === JSON.stringify(Object.keys(WORKSPACE_IDENTITIES)),
    'root workspace list must be the explicit ordered package list',
  );

  const byName = new Map([...manifestByPath.values()].map((manifest) => [manifest.name, manifest]));
  const internalName = (name) =>
    name.startsWith('@openplanr/') || Object.values(WORKSPACE_IDENTITIES).includes(name);
  for (const [path, name] of Object.entries(WORKSPACE_IDENTITIES)) {
    const manifest = manifestByPath.get(path);
    check(manifest?.name === name, `${path} must use ${name}`);
    check(validVersion(manifest?.version), `${name} must declare a valid SemVer package version`);
    const isPublic = PUBLIC_PACKAGE_PATHS.includes(path);
    check(
      isPublic ? manifest?.private !== true : manifest?.private === true,
      `${name} must ${isPublic ? 'be publishable' : 'remain npm-private'}`,
    );
    if (isPublic) check(manifest?.license === 'MIT', `${name} must retain its MIT license`);

    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      const dependencies = manifest?.[section] ?? {};
      const allowed = internalDependencies[path][section] ?? [];
      for (const target of allowed) {
        const version = byName.get(target)?.version;
        check(
          validVersion(version) && dependencies[target] === version,
          `${path} ${section} must pin ${target} exactly to its workspace version (${version ?? 'missing'})`,
        );
      }
      for (const [target, version] of Object.entries(dependencies)) {
        if (internalName(target))
          check(
            allowed.includes(target),
            `${path} ${section} has forbidden internal dependency ${target}`,
          );
        if (isPublic && section !== 'devDependencies') {
          check(
            typeof version === 'string' &&
              !/^(?:file:|link:|workspace:)|^(?:\/|\.\.?[\\/]|[A-Za-z]:[\\/])/u.test(version),
            `${path} ${section} must not use local path ${target}@${version}`,
          );
        }
      }
    }
    if (isPublic) {
      const bundled = manifest?.bundledDependencies ?? manifest?.bundleDependencies ?? [];
      check(bundled !== true, `${path} must explicitly enumerate bundled dependencies`);
      if (Array.isArray(bundled)) {
        for (const target of bundled)
          check(!internalName(target), `${path} must not bundle internal workspace ${target}`);
      }
    }
  }
  const cli = manifestByPath.get('packages/cli');
  check(
    JSON.stringify(cli?.bin) ===
      JSON.stringify({
        planr: './bin/planr.js',
        openplanr: './bin/planr.js',
        opr: './bin/planr.js',
      }),
    'CLI aliases must resolve to the exact shared parser',
  );
  return failures;
}
