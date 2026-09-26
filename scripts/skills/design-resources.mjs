import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderArtifactStageRuntimeAsset } from '../../packages/artifact/scripts/generate-artifact-shell.mjs';
import { renderDesignStudioRuntimeAsset } from '../../packages/design/scripts/generate-design-studio.mjs';
import { resourceBytes } from './resource-bytes.mjs';

export const DESIGN_SKILL_IDS = Object.freeze([
  'planr-design',
  'planr-design-loop',
  'planr-design-review',
]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (entry.isSymbolicLink())
        throw new Error(
          `Design resources may not contain symlinks: ${join(directory, entry.name)}`,
        );
      return entry.isDirectory()
        ? files(join(directory, entry.name))
        : [join(directory, entry.name)];
    });
}

/**
 * Build one portable utility and the files it reads. Semantic providers and native
 * build executables never enter the release unit. Runtime assets retain logical
 * package-relative locations while executable modules are bundled into one file.
 */
export async function buildDesignSkillResources({
  repoRoot,
  entrypoint = 'packages/design/lib/design/utility.mjs',
  extraAssets = [],
} = {}) {
  const root = resolve(repoRoot ?? fileURLToPath(new URL('../..', import.meta.url)));
  const entry = resolve(root, entrypoint);
  const require = createRequire(resolve(root, 'packages/artifact/package.json'));
  const { build } = require('esbuild');
  const logical = (absolute) => relative(root, absolute).split(sep).join('/');
  // The stage and studio runtimes are untracked outputs of later generator steps, so they
  // are rendered from source here instead of read from disk.
  const stageRuntimePath = resolve(root, 'packages/artifact/templates/artifact-review-stage.js');
  const studioRuntimePath = resolve(root, 'packages/design/templates/studio/studio.js');
  const renderedAssets = new Map([
    [
      stageRuntimePath,
      Buffer.from(
        renderArtifactStageRuntimeAsset({ projectRoot: resolve(root, 'packages/artifact') }),
        'utf8',
      ),
    ],
    [
      studioRuntimePath,
      Buffer.from(
        renderDesignStudioRuntimeAsset({ projectRoot: resolve(root, 'packages/design') }),
        'utf8',
      ),
    ],
  ]);
  const assetPaths = [
    resolve(root, 'packages/protocol/schemas/v1.0.0/design-manifest.schema.json'),
    ...['artifact-envelope', 'artifact-review', 'artifact-paste', 'artifact-theme'].map((name) =>
      resolve(root, `packages/protocol/schemas/v1.1.0/${name}.schema.json`),
    ),
    resolve(root, 'packages/protocol/schemas/v1.9.0/design-document.schema.json'),
    ...[
      'design-review-workspace',
      'design-workspace-create',
      'design-workspace-revision',
      'design-workspace-event',
      'design-review-bundle',
    ].map((name) => resolve(root, `packages/protocol/schemas/v1.9.0/${name}.schema.json`)),
    ...files(resolve(root, 'packages/protocol/schemas/v1.10.0')),
    ...files(resolve(root, 'packages/protocol/schemas/v1.11.0')),
    resolve(root, 'packages/protocol/registry/artifact-theme.json'),
    resolve(root, 'packages/protocol/package.json'),
    stageRuntimePath,
    studioRuntimePath,
    ...files(resolve(root, 'packages/design/templates/studio')),
    ...extraAssets.map((path) => resolve(root, path)),
  ];
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: 'design.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    metafile: true,
    legalComments: 'inline',
    plugins: [
      {
        name: 'portable-design-assets',
        setup(buildApi) {
          buildApi.onLoad({ filter: /\.mjs$/ }, ({ path }) => {
            if (!path.startsWith(`${root}${sep}packages${sep}`)) return undefined;
            let contents = readFileSync(path, 'utf8');
            if (path !== entry)
              contents = contents.replaceAll(
                'import.meta.url',
                `new URL(${JSON.stringify(`./runtime/${logical(path)}`)}, import.meta.url).href`,
              );
            // These are asset lookups, not JS dependencies; Node package resolution
            // cannot be used once the utility is moved away from node_modules.
            let hasAssetLookup = false;
            contents = contents.replace(
              /require\.resolve\(\s*['"]@openplanr\/protocol\/([^'"]+)['"]\s*,?\s*\)/gu,
              (_match, asset) => {
                hasAssetLookup = true;
                return `__planrAssetFile(new URL(${JSON.stringify(`./runtime/packages/protocol/${asset}`)}, import.meta.url))`;
              },
            );
            if (hasAssetLookup)
              contents = `import { fileURLToPath as __planrAssetFile } from 'node:url';\n${contents}`;
            return { contents, loader: 'js', resolveDir: dirname(path) };
          });
        },
      },
    ],
  });
  const dependencyPaths = Object.keys(result.metafile.inputs);
  const forbidden = dependencyPaths.filter((path) =>
    /(?:design-engine\/providers|node_modules\/(?:esbuild|@esbuild|openai|@anthropic-ai|@resvg)\/)/u.test(
      path,
    ),
  );
  if (forbidden.length)
    throw new Error(
      `Design utility contains nonportable runtime dependencies: ${forbidden.join(', ')}`,
    );
  const unresolved =
    result.metafile.outputs['design.mjs']?.imports?.filter(
      ({ external, path }) => external && !path.startsWith('node:'),
    ) ?? [];
  if (unresolved.length)
    throw new Error(
      `Design utility has external runtime dependencies: ${unresolved.map(({ path }) => path).join(', ')}`,
    );
  const resources = [
    {
      path: 'scripts/design.mjs',
      kind: 'script',
      executable: true,
      bytes: resourceBytes(result.outputFiles[0].contents),
    },
    {
      path: 'schemas/design-document.schema.json',
      kind: 'schema',
      executable: false,
      bytes: readFileSync(
        resolve(root, 'packages/protocol/schemas/v1.9.0/design-document.schema.json'),
      ),
    },
    ...['design-review-context', 'design-review-handoff'].map((name) => ({
      path: `schemas/${name}.schema.json`,
      kind: 'schema',
      executable: false,
      bytes: readFileSync(resolve(root, `packages/protocol/schemas/v1.10.0/${name}.schema.json`)),
    })),
  ];
  for (const absolute of [...new Set(assetPaths)].sort())
    resources.push({
      path: `scripts/runtime/${logical(absolute)}`,
      kind: absolute.endsWith('.schema.json') ? 'schema' : 'asset',
      executable: false,
      bytes: renderedAssets.get(absolute) ?? readFileSync(absolute),
    });
  const dependencyRoots = new Set();
  for (const path of dependencyPaths) {
    const normalized = path.replaceAll('\\', '/');
    const marker = normalized.lastIndexOf('node_modules/');
    if (marker === -1) continue;
    const tail = normalized.slice(marker + 'node_modules/'.length).split('/');
    const packageName = tail[0].startsWith('@') ? tail.slice(0, 2).join('/') : tail[0];
    dependencyRoots.add(resolve(root, normalized.slice(0, marker), 'node_modules', packageName));
  }
  for (const directory of [...dependencyRoots].sort()) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const licenses = readdirSync(directory)
      .filter((name) => /^(?:license|copying)(?:\.|$)/iu.test(name))
      .sort();
    if (!licenses.length)
      throw new Error(`Bundled dependency ${manifest.name} has no packaged license text.`);
    resources.push({
      path: `scripts/runtime/notices/${manifest.name.replaceAll('/', '__')}.txt`,
      kind: 'asset',
      executable: false,
      bytes: resourceBytes(
        `${manifest.name}@${manifest.version}\n\n${licenses.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n\n')}`,
      ),
    });
  }
  return resources;
}
