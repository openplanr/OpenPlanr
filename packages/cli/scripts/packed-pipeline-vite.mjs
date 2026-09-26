import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

function inside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Resolve every Vite planr-pipeline import from the disposable packed install. */
export function packedPipelineVitePlugin() {
  const configured = process.env.OPENPLANR_PACKED_PIPELINE_ROOT;
  if (!configured) return null;
  if (!isAbsolute(configured) || lstatSync(configured).isSymbolicLink()) {
    throw new Error('OPENPLANR_PACKED_PIPELINE_ROOT must be an absolute regular directory.');
  }
  const packageRoot = realpathSync(configured);
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'planr-pipeline') {
    throw new Error('OPENPLANR_PACKED_PIPELINE_ROOT is not planr-pipeline.');
  }
  const source = process.env.OPENPLANR_PACKED_PIPELINE_SOURCE_ROOT;
  if (source && realpathSync(source) === packageRoot) {
    throw new Error('Vite resolved planr-pipeline back to sibling source.');
  }
  const exportedPath = (specifier) => {
    const subpath =
      specifier === 'planr-pipeline' ? '.' : `./${specifier.slice('planr-pipeline/'.length)}`;
    let target = manifest.exports?.[subpath];
    if (target === undefined) {
      const pattern = Object.entries(manifest.exports ?? {}).find(([key]) => {
        const star = key.indexOf('*');
        return (
          star >= 0 &&
          subpath.startsWith(key.slice(0, star)) &&
          subpath.endsWith(key.slice(star + 1))
        );
      });
      if (pattern) {
        const [key, value] = pattern;
        const star = key.indexOf('*');
        const match = subpath.slice(star, subpath.length - (key.length - star - 1));
        target = typeof value === 'string' ? value.replace('*', match) : value;
      }
    }
    const selected = typeof target === 'string' ? target : (target?.import ?? target?.default);
    if (typeof selected !== 'string' || !selected.startsWith('./')) {
      throw new Error(`Packed pipeline does not export ${specifier} for import.`);
    }
    return selected;
  };
  let resolvedImports = 0;
  return {
    name: 'openplanr-packed-pipeline-custody',
    enforce: 'pre',
    resolveId(specifier) {
      if (specifier !== 'planr-pipeline' && !specifier.startsWith('planr-pipeline/')) return null;
      const resolved = realpathSync(join(packageRoot, exportedPath(specifier)));
      if (!inside(packageRoot, resolved)) {
        throw new Error(`Packed pipeline import escaped installed custody: ${specifier}`);
      }
      resolvedImports += 1;
      return resolved;
    },
    buildEnd(error) {
      if (!error && resolvedImports === 0) {
        throw new Error('Vite did not resolve any planr-pipeline import from packed custody.');
      }
    },
  };
}
