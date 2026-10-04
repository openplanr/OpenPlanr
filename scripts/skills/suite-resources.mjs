import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { sha256Bytes } from '../../packages/skill-runtime/src/compiler/index.mjs';
import { DESIGN_SKILL_IDS } from './design-resources.mjs';

const OPERATE_SKILL_IDS = new Set([
  'planr-operate',
  'planr-chair-review',
  'planr-challenger-review',
  'planr-ceo-review',
  'planr-cto-review',
  'planr-cpo-review',
  'planr-cmo-review',
  'planr-coo-review',
]);

function runtimeGroup(skillId, path) {
  if (DESIGN_SKILL_IDS.includes(skillId) && path.startsWith('scripts/')) return 'design';
  if (
    skillId === 'planr-plan' &&
    (path === 'scripts/design.mjs' || path.startsWith('scripts/runtime/'))
  )
    return 'plan';
  if (OPERATE_SKILL_IDS.has(skillId) && path.startsWith('scripts/')) return 'operate';
  return null;
}

/** The canonical package remains portable; this mapping belongs to complete native suites. */
export function suiteResourcePath(skillId, path, skillRoot) {
  const group = runtimeGroup(skillId, path);
  return group ? `runtime/${group}/${path}` : `${skillRoot}/${path}`;
}

/** Imported modules never rely on their direct-execution guard to run a helper. */
export function renderSuiteLauncher({ skillId, path, skillRoot }) {
  const group = runtimeGroup(skillId, path);
  if (!group || !['scripts/design.mjs', 'scripts/validate-note.mjs'].includes(path)) return null;
  const target = suiteResourcePath(skillId, path, skillRoot);
  const relative = posix.relative(posix.dirname(`${skillRoot}/${path}`), target);
  const entry = group === 'operate' ? 'runOperateReviewNoteValidator' : 'main';
  const error =
    group === 'operate'
      ? "`${error.code ?? 'E_OPERATE_NOTE'}: ${error.message}\\n`"
      : '`${error.message}\\n`';
  return `#!/usr/bin/env node
// Generated package-relative launcher; no global runtime or invocation downloads.
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ${entry} as run } from ${JSON.stringify(relative)};
export * from ${JSON.stringify(relative)};
if (process.argv[1] && existsSync(resolve(process.argv[1])) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try { await run(process.argv.slice(2)); }
  catch (error) { process.stderr.write(${error}); process.exitCode = 1; }
}
`;
}

/** Resources kept beside the host-readable entry, including its thin helper launchers. */
export function suiteLocalResources(packageInfo, host, skillRoot) {
  return packageInfo.resources
    .filter(({ hosts }) => hosts.includes(host))
    .flatMap((resource) => {
      const launcher = renderSuiteLauncher({
        skillId: packageInfo.row.skillId,
        path: resource.path,
        skillRoot,
      });
      if (launcher !== null) return [{ ...resource, bytes: Buffer.from(launcher) }];
      if (runtimeGroup(packageInfo.row.skillId, resource.path)) return [];
      return [{ ...resource, bytes: readFileSync(resource.absolute) }];
    });
}

/** Complete executable closures are placed once per suite and retain their relative asset layout. */
export function suiteSharedResources(packageInfo, host, skillRoot) {
  return packageInfo.resources
    .filter(
      ({ hosts, path }) => hosts.includes(host) && runtimeGroup(packageInfo.row.skillId, path),
    )
    .map((resource) => ({
      ...resource,
      path: suiteResourcePath(packageInfo.row.skillId, resource.path, skillRoot),
      bytes: readFileSync(resource.absolute),
    }));
}

/** Measured inventories replace authored resource totals that drift when dependencies change. */
export function resourceFootprint(entries) {
  const unique = new Map();
  let bytes = 0;
  for (const entry of entries) {
    const value = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    bytes += value.length;
    unique.set(sha256Bytes(value), value.length);
  }
  const uniqueBytes = [...unique.values()].reduce((sum, size) => sum + size, 0);
  return {
    files: entries.length,
    bytes,
    uniqueFiles: unique.size,
    uniqueBytes,
    duplicateBytes: bytes - uniqueBytes,
  };
}
