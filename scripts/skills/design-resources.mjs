import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderArtifactStageRuntimeAsset } from '../../packages/artifact/scripts/generate-artifact-shell.mjs';
import { renderDesignStudioRuntimeAsset } from '../../packages/design/scripts/generate-design-studio.mjs';
import { resourceBytes } from './resource-bytes.mjs';

export const DESIGN_SKILL_IDS = Object.freeze([
  'planr-design',
  'planr-design-loop',
  'planr-design-review',
]);

/**
 * Operational and dependency modules keep useful standalone source boundaries.
 * Match bundle inputs so hoisted and nested installations resolve alike. Large
 * readable sources may require Directory review; never slice code to avoid it.
 */
const CHUNK_BOUNDARIES = Object.freeze([
  ['parse5-parser', 'node_modules/parse5/dist/parser/index.js'],
  ['parse5-tokenizer', 'node_modules/parse5/dist/tokenizer/index.js'],
  ['entities', 'node_modules/entities/dist/decode.js'],
  ['artifact-shell', 'packages/artifact/lib/artifact/ui/shell.mjs'],
  ['sandbox-guards', 'packages/artifact/lib/artifact/ui/generated/sandbox-guards.mjs'],
  ['review', 'packages/design/lib/design/review.mjs'],
  ['share', 'packages/design/lib/design/share.mjs'],
  ['handoff', 'packages/design/lib/design/handoff.mjs'],
  ['document', 'packages/design/lib/design/document.mjs'],
]);

const CHUNK_OUTDIR = 'design-bundle';

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
 * package-relative locations while executable modules are bundled into `design.mjs`
 * and flat sibling chunks that it imports.
 */
export async function buildDesignSkillResources({
  repoRoot,
  entrypoint = 'packages/design/lib/design/utility.mjs',
  extraAssets = [],
  profile = 'design',
} = {}) {
  if (!['design', 'plan'].includes(profile)) throw new Error(`Unknown runtime profile: ${profile}`);
  const includesStudio = profile === 'design';
  const root = resolve(repoRoot ?? fileURLToPath(new URL('../..', import.meta.url)));
  const entry = resolve(root, entrypoint);
  const require = createRequire(resolve(root, 'packages/artifact/package.json'));
  const { build } = require('esbuild');
  const logical = (absolute) => relative(root, absolute).split(sep).join('/');
  // The stage and studio runtimes are untracked outputs of later generator steps, so they
  // are rendered from source here instead of read from disk.
  const stageRuntimePath = resolve(root, 'packages/artifact/templates/artifact-review-stage.js');
  const studioRuntimePath = resolve(root, 'packages/design/templates/studio/studio.js');
  const browserInputs = [];
  const renderedAssets = new Map(
    includesStudio
      ? [
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
              renderDesignStudioRuntimeAsset({
                projectRoot: resolve(root, 'packages/design'),
                onInputs: (inputs) => browserInputs.push(...inputs),
              }),
              'utf8',
            ),
          ],
        ]
      : [],
  );
  const assetPaths = includesStudio
    ? [
        resolve(root, 'packages/protocol/schemas/v1.0.0/design-manifest.schema.json'),
        ...['artifact-envelope', 'artifact-review', 'artifact-paste'].map((name) =>
          resolve(root, `packages/protocol/schemas/v1.1.0/${name}.schema.json`),
        ),
        resolve(root, 'packages/protocol/schemas/v1.14.0/artifact-theme.schema.json'),
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
        ...files(resolve(root, 'packages/protocol/schemas/v1.16.0')),
        // Additive v1.17 schemas enter this utility through bundled JSON/contracts.
        // Keep only raw schema files actually read by its filesystem schema loader.
        resolve(root, 'packages/protocol/registries/artifact-theme.json'),
        resolve(root, 'packages/protocol/package.json'),
        ...[
          resolve(root, 'packages/artifact/lib/artifact/ui/studio-shell.css'),
          resolve(root, 'packages/design/package.json'),
          stageRuntimePath,
          studioRuntimePath,
          ...files(resolve(root, 'packages/design/templates/studio')),
        ],
        ...extraAssets.map((path) => resolve(root, path)),
      ]
    : [
        resolve(root, 'packages/protocol/package.json'),
        resolve(root, 'packages/protocol/schemas/v1.1.0/artifact-review.schema.json'),
        ...extraAssets.map((path) => resolve(root, path)),
      ];
  const options = {
    absWorkingDir: root,
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
            contents = contents.replace(
              /import\.meta\.resolve\(\s*['"]@openplanr\/artifact\/([^'"]+)['"]\s*\)/gu,
              (_match, asset) =>
                `new URL(${JSON.stringify(`./runtime/packages/artifact/lib/artifact/${asset}`)}, import.meta.url).href`,
            );
            // These are asset lookups, not JS dependencies; Node package resolution
            // cannot be used once the utility is moved away from node_modules. A module
            // compiled from TypeScript names its local require `require2`.
            let hasAssetLookup = false;
            contents = contents.replace(
              /require\d*\.resolve\(\s*['"]@openplanr\/protocol\/([^'"]+)['"]\s*,?\s*\)/gu,
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
  };
  const closure = await build({
    ...options,
    entryPoints: [entry],
    outfile: `${CHUNK_OUTDIR}/design.mjs`,
  });
  const closureInputs = Object.keys(closure.metafile.inputs);
  // Without compiled output esbuild falls back to TypeScript sources, which the
  // `.mjs`-only rewrite above skips, leaving package lookups that fail once installed.
  const typescript = closureInputs.filter((path) => /\.[cm]?ts$/u.test(path));
  if (typescript.length)
    throw new Error(
      `Design utility bundles TypeScript sources; run node scripts/typescript/compile-sources.mjs first: ${typescript.join(', ')}`,
    );
  const boundaries = includesStudio
    ? CHUNK_BOUNDARIES.map(([id, suffix]) => {
        const matches = closureInputs.filter(
          (path) => path === suffix || path.endsWith(`/${suffix}`),
        );
        if (matches.length !== 1)
          throw new Error(
            `Design chunk boundary ${suffix} matched ${matches.length} bundle inputs; update CHUNK_BOUNDARIES.`,
          );
        return { id, input: matches[0] };
      })
    : [];
  const result = includesStudio
    ? await build({
        ...options,
        entryPoints: [
          { in: entry, out: 'design' },
          ...boundaries.map(({ id, input }) => ({
            in: resolve(root, input),
            out: `boundary-${id}`,
          })),
        ],
        splitting: true,
        outdir: CHUNK_OUTDIR,
        outExtension: { '.js': '.mjs' },
        chunkNames: 'chunk-[hash]',
      })
    : closure;
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
  const outputs = result.metafile.outputs;
  const designKey = `${CHUNK_OUTDIR}/design.mjs`;
  // `utility.mjs` detects direct execution by comparing its own URL, so it must stay in the entry file.
  if (!outputs[designKey]?.inputs[logical(entry)])
    throw new Error(`Design utility entry ${logical(entry)} left ${designKey}.`);
  // Boundary entries compile to re-export stubs that nothing imports; ship only the entry's closure.
  const kept = [designKey];
  const unresolved = [];
  for (let index = 0; index < kept.length; index += 1)
    for (const { path, external } of outputs[kept[index]].imports) {
      if (path.startsWith('node:')) continue;
      if (external) unresolved.push(path);
      else if (!kept.includes(path)) kept.push(path);
    }
  if (unresolved.length)
    throw new Error(`Design utility has external runtime dependencies: ${unresolved.join(', ')}`);
  const contents = new Map(result.outputFiles.map((file) => [logical(file.path), file.text]));
  const names = new Map();
  for (const key of kept) {
    if (dirname(key) !== CHUNK_OUTDIR) throw new Error(`Design chunk ${key} is not flat.`);
    if (key === designKey) {
      names.set(key, 'design.mjs');
      continue;
    }
    const chunkInputs = Object.keys(outputs[key].inputs).sort();
    const owners = boundaries
      .filter(({ input }) => chunkInputs.includes(input))
      .map(({ id }) => id);
    const stem = owners.length
      ? owners.join('-')
      : chunkInputs.length === 0
        ? `generated-${createHash('sha256').update(contents.get(key)).digest('hex').slice(0, 16)}`
        : basename(chunkInputs[0])
            .replace(/\.[^.]+$/u, '')
            .replace(/[^a-z0-9]+/giu, '-');
    names.set(key, `design-${stem.toLowerCase()}.mjs`);
  }
  if (new Set(names.values()).size !== names.size)
    throw new Error(`Design chunk names collide: ${[...names.values()].join(', ')}`);
  const scripts = kept.map((key) => {
    let text = contents.get(key);
    for (const [from, to] of names) text = text.replaceAll(`./${basename(from)}`, `./${to}`);
    if (/chunk-[A-Z0-9]{8}\.mjs/u.test(text))
      throw new Error(`Design chunk ${names.get(key)} still imports a hashed chunk name.`);
    return {
      path: `scripts/${names.get(key)}`,
      kind: 'script',
      executable: key === designKey,
      bytes: resourceBytes(text),
    };
  });
  const bundledInputs = [
    ...new Set(
      kept.flatMap((key) =>
        Object.entries(outputs[key].inputs)
          .filter(([_path, data]) => data.bytesInOutput > 0)
          .map(([path]) => path),
      ),
    ),
  ];
  const resources = [
    ...scripts.sort((a, b) =>
      a.executable === b.executable ? a.path.localeCompare(b.path) : a.executable ? -1 : 1,
    ),
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
  for (const absolute of [...new Set(assetPaths)].sort()) {
    const path = `scripts/runtime/${logical(absolute)}`;
    const bytes = renderedAssets.get(absolute) ?? readFileSync(absolute);
    // Preserve the full source asset. The shared suite stores it once, while
    // standalone downloads retain a complete offline closure and its provenance.
    resources.push({
      path,
      kind: absolute.endsWith('.schema.json') ? 'schema' : 'asset',
      executable: false,
      bytes,
    });
  }
  const dependencyRoots = new Set();
  for (const path of [...bundledInputs, ...browserInputs]) {
    const normalized = path.replaceAll('\\', '/');
    const marker = normalized.lastIndexOf('node_modules/');
    if (marker === -1) continue;
    const tail = normalized.slice(marker + 'node_modules/'.length).split('/');
    const packageName = tail[0].startsWith('@') ? tail.slice(0, 2).join('/') : tail[0];
    dependencyRoots.add(resolve(root, normalized.slice(0, marker), 'node_modules', packageName));
  }
  const noticeBlocks = [];
  for (const directory of [...dependencyRoots].sort()) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const licenses = readdirSync(directory)
      .filter((name) => /^(?:license|copying)(?:\.|$)/iu.test(name))
      .sort();
    const licenseFallback =
      manifest.name === 'react-remove-scroll-bar' && manifest.version === '2.3.8'
        ? resolve(root, 'scripts/skills/third-party/react-remove-scroll-bar-2.3.8-LICENSE.txt')
        : null;
    if (!licenses.length && !licenseFallback)
      throw new Error(`Bundled dependency ${manifest.name} has no packaged license text.`);
    noticeBlocks.push(
      `${manifest.name}@${manifest.version}\n\n${licenseFallback ? readFileSync(licenseFallback, 'utf8') : licenses.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n\n')}`,
    );
  }
  // Every bundled dependency retains its complete notice. A single bounded document
  // avoids repeating individual notice files in each standalone skill of a directory plugin.
  resources.push({
    path: 'scripts/runtime/notices/THIRD_PARTY_NOTICES.txt',
    kind: 'asset',
    executable: false,
    bytes: resourceBytes(noticeBlocks.join('\n\n----------------\n\n')),
  });
  return resources;
}

/** Plan consumes an existing handoff; it has no reason to carry Studio templates or controls. */
export function buildPlanSkillResources({ repoRoot } = {}) {
  return buildDesignSkillResources({
    repoRoot,
    entrypoint: 'packages/design/lib/design/plan-handoff-utility.mjs',
    profile: 'plan',
  });
}
