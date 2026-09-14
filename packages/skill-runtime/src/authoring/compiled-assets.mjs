import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { compileComposedV1, validateSourceMap } from '../compiler/index.mjs';
import { buildCustodyManifest, buildGeneratedAssetManifest } from '../manifests/index.mjs';
import { SkillAuthoringError } from './diagnostics.mjs';

export const GENERATED_OUTPUT_DIR = 'dist';
export const GENERATED_ASSET_MANIFEST = 'manifests/generated-assets.json';
export const GENERATED_CUSTODY_MANIFEST = 'manifests/generated-custody.json';

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function assetFromProjection(projection, asset) {
  validateSourceMap(asset.sourceMap, asset.byteLength);
  return Object.freeze({
    host: projection.host,
    path: asset.path,
    bytes: asset.bytes,
    digest: asset.digest,
    byteLength: asset.byteLength,
    sourceMap: asset.sourceMap,
  });
}

/** Compile every declared host from one already-loaded canonical skill graph. */
export function compileHostProjections(loaded) {
  const {
    skillSource,
    skillSourceCustody,
    modules,
    declaredProfiles,
    cursorTemplate,
    readSource,
  } = loaded;
  return Object.freeze(declaredProfiles.map((hostProfile) => compileComposedV1({
    skillSource,
    skillSourceCustody,
    modules,
    hostProfile,
    cursorTemplate,
    readSource,
  })));
}

/** Flatten compiled host projections into their deterministic asset order. */
export function flattenCompiledAssets(projections) {
  return Object.freeze(projections.flatMap((projection) => [
    assetFromProjection(projection, projection.primary),
    ...projection.references.map((reference) => assetFromProjection(projection, reference)),
  ]));
}

/** Build the two deterministic manifests that own one compiled output set. */
export function buildCompiledManifests(assets) {
  const manifestAssets = assets.map(({ bytes: _bytes, ...asset }) => asset);
  const generated = buildGeneratedAssetManifest({
    assets: manifestAssets,
    sourceFormat: 'composed-v1',
  });
  const custody = buildCustodyManifest({
    assets: manifestAssets,
    sourceFormat: 'composed-v1',
    assetSetId: generated.assetSetId,
  });
  return Object.freeze({ generated, custody });
}

function outputFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new SkillAuthoringError(
          'E_SKILL_GENERATED_OUTPUT_DRIFT',
          `Generated output ${relative(root, path)} is a symbolic link.`,
          { path: relative(root, path), repair: 'Run the canonical skill generator to replace the drifted output tree.' },
        );
      }
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(relative(root, path));
      else {
        throw new SkillAuthoringError(
          'E_SKILL_GENERATED_OUTPUT_DRIFT',
          `Generated output ${relative(root, path)} is not a regular file.`,
          { path: relative(root, path), repair: 'Run the canonical skill generator to replace the drifted output tree.' },
        );
      }
    }
  }
  return files.sort();
}

/** Compare an existing generated tree to freshly compiled bytes without writing. */
export function inspectGeneratedOutput({ skillDir, assets }) {
  const outputRoot = join(skillDir, GENERATED_OUTPUT_DIR);
  if (!existsSync(outputRoot)) {
    return Object.freeze({ state: 'not-generated', checked: false, outputDir: GENERATED_OUTPUT_DIR });
  }
  const stat = lstatSync(outputRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SkillAuthoringError(
      'E_SKILL_GENERATED_OUTPUT_DRIFT',
      `${GENERATED_OUTPUT_DIR} is not a regular generated-output directory.`,
      { path: GENERATED_OUTPUT_DIR, repair: 'Move the conflicting path, then run the canonical skill generator.' },
    );
  }

  const manifests = buildCompiledManifests(assets);
  const expected = new Map([
    ...assets.map((asset) => [`${asset.host}/${asset.path}`, asset.bytes]),
    [GENERATED_ASSET_MANIFEST, stableJson(manifests.generated)],
    [GENERATED_CUSTODY_MANIFEST, stableJson(manifests.custody)],
  ]);
  const actualPaths = outputFiles(outputRoot);
  const expectedPaths = [...expected.keys()].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((path) => !actualPaths.includes(path));
    const unexpected = actualPaths.filter((path) => !expected.has(path));
    throw new SkillAuthoringError(
      'E_SKILL_GENERATED_OUTPUT_DRIFT',
      'Generated output paths differ from the canonical compiled asset set.',
      {
        path: GENERATED_OUTPUT_DIR,
        missing,
        unexpected,
        repair: 'Run the canonical skill generator to refresh the complete output tree.',
      },
    );
  }
  for (const path of expectedPaths) {
    const actual = readFileSync(join(outputRoot, ...path.split('/')), 'utf8');
    if (actual !== expected.get(path)) {
      throw new SkillAuthoringError(
        'E_SKILL_GENERATED_OUTPUT_DRIFT',
        `Generated output ${path} differs from the canonical compiled bytes.`,
        { path: `${GENERATED_OUTPUT_DIR}/${path}`, repair: 'Run the canonical skill generator to refresh the drifted output.' },
      );
    }
  }
  return Object.freeze({ state: 'current', checked: true, outputDir: GENERATED_OUTPUT_DIR });
}
