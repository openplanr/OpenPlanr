import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { validateProtocolArtifact } from '@openplanr/protocol/contracts';
import { linkSkillProjections } from '../linker/index.mjs';

import { isSkillAssetPath } from '../compiler/index.mjs';

import {
  GENERATED_ASSET_MANIFEST,
  GENERATED_CUSTODY_MANIFEST,
  GENERATED_OUTPUT_DIR,
  buildCompiledManifests,
  compileHostProjections,
  flattenCompiledAssets,
} from './compiled-assets.mjs';
import { SkillAuthoringError } from './diagnostics.mjs';
import { acquireGenerationLock } from './generation-lock.mjs';
import { describeAuthoringGraph } from './command-contract.mjs';
import { loadComposedSkill } from './loader.mjs';
import { runOperation } from './operation-result.mjs';

const DIST_DIR = GENERATED_OUTPUT_DIR;
const GENERATED_MANIFEST = GENERATED_ASSET_MANIFEST;
const CUSTODY_MANIFEST = GENERATED_CUSTODY_MANIFEST;

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isOutside(root, candidate) {
  const within = relative(root, candidate);
  return within === '..' || within.startsWith(`..${sep}`);
}

function belongsToSkill(asset, skillId) {
  if (typeof asset?.host !== 'string' || typeof asset?.path !== 'string') return false;
  try {
    return isSkillAssetPath(asset.host, skillId, asset.path);
  } catch {
    return false;
  }
}

function assertOwnedOutput(outputRoot, skillId) {
  const stat = lstatSync(outputRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SkillAuthoringError(
      'E_SKILL_OUTPUT_UNOWNED',
      `${outputRoot} is not a generated skill-output directory.`,
      {
        path: outputRoot,
        repair: `Move the existing ${DIST_DIR} path, then run generation again.`,
      },
    );
  }

  const manifestPath = join(outputRoot, ...GENERATED_MANIFEST.split('/'));
  const custodyPath = join(outputRoot, ...CUSTODY_MANIFEST.split('/'));
  let manifest;
  let custody;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    custody = JSON.parse(readFileSync(custodyPath, 'utf8'));
  } catch {
    throw new SkillAuthoringError(
      'E_SKILL_OUTPUT_UNOWNED',
      `${outputRoot} does not contain readable OpenPlanr generated manifests.`,
      {
        path: manifestPath,
        repair: `Move the existing ${DIST_DIR} directory, then run generation again.`,
      },
    );
  }
  const manifestErrors = validateProtocolArtifact('generated-asset-manifest', manifest, {
    protocolVersion: '1.6.0',
  });
  if (
    manifestErrors.length > 0 ||
    manifest.sourceFormat !== 'composed-v1' ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length === 0 ||
    manifest.assets.some((asset) => !belongsToSkill(asset, skillId)) ||
    custody.kind !== 'openplanr-skill-generated-custody' ||
    custody.assetSetId !== manifest.assetSetId ||
    !Array.isArray(custody.assets) ||
    custody.assets.length !== manifest.assets.length ||
    custody.assets.some((asset) => !belongsToSkill(asset, skillId))
  ) {
    throw new SkillAuthoringError(
      'E_SKILL_OUTPUT_UNOWNED',
      `${outputRoot} is not owned by composed skill ${skillId}.`,
      {
        path: manifestPath,
        repair: `Move the existing ${DIST_DIR} directory, then run generation again.`,
      },
    );
  }
}

function writeOutputTree(stagingRoot, assets, generatedManifest, custodyManifest) {
  for (const asset of assets) {
    const outputPath = resolve(stagingRoot, asset.host, ...asset.path.split('/'));
    if (isOutside(stagingRoot, outputPath)) {
      throw new SkillAuthoringError(
        'E_SKILL_OUTPUT_PATH_INVALID',
        `Generated path ${asset.path} escapes the output directory.`,
        { path: asset.path },
      );
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, asset.bytes, 'utf8');
  }
  const generatedPath = join(stagingRoot, ...GENERATED_MANIFEST.split('/'));
  const custodyPath = join(stagingRoot, ...CUSTODY_MANIFEST.split('/'));
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, stableJson(generatedManifest), 'utf8');
  writeFileSync(custodyPath, stableJson(custodyManifest), 'utf8');
}

function replaceOutputTree(skillDir, stagingRoot, outputRoot, skillId) {
  let backupRoot;
  try {
    if (existsSync(outputRoot)) {
      assertOwnedOutput(outputRoot, skillId);
      backupRoot = mkdtempSync(join(skillDir, '.openplanr-backup-'));
      renameSync(outputRoot, join(backupRoot, DIST_DIR));
    }
    renameSync(stagingRoot, outputRoot);
    if (backupRoot) rmSync(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (backupRoot && !existsSync(outputRoot)) {
      renameSync(join(backupRoot, DIST_DIR), outputRoot);
    }
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    if (backupRoot && existsSync(backupRoot)) rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Compile every declared host profile, then stage and promote one complete output set. */
export function generateSkill({ skillDir }) {
  return runOperation('generate', () => {
    const loaded = loadComposedSkill({ skillDir });
    const releaseLock = acquireGenerationLock(loaded.skillDir);
    try {
      const projections = compileHostProjections(loaded);
      const content = linkSkillProjections(projections);
      const compiled = {
        skillDir: loaded.skillDir,
        skillId: loaded.skillSource.skillId,
        skillVersion: loaded.skillSource.skillVersion,
        assets: flattenCompiledAssets(projections),
      };
      const { generated: generatedManifest, custody: custodyManifest } = buildCompiledManifests(
        compiled.assets,
      );
      const manifestErrors = validateProtocolArtifact(
        'generated-asset-manifest',
        generatedManifest,
        { protocolVersion: '1.6.0' },
      );
      if (manifestErrors.length > 0) {
        throw new SkillAuthoringError(
          'E_SKILL_GENERATED_MANIFEST_INVALID',
          'Generated assets do not satisfy the Protocol 1.6 manifest contract.',
          { errors: manifestErrors },
        );
      }
      const outputRoot = join(compiled.skillDir, DIST_DIR);
      if (existsSync(outputRoot)) assertOwnedOutput(outputRoot, compiled.skillId);
      const stagingRoot = mkdtempSync(join(compiled.skillDir, '.openplanr-dist-'));
      try {
        writeOutputTree(stagingRoot, compiled.assets, generatedManifest, custodyManifest);
        replaceOutputTree(compiled.skillDir, stagingRoot, outputRoot, compiled.skillId);
      } catch (error) {
        if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
        throw error;
      }

      return {
        skillId: compiled.skillId,
        skillVersion: compiled.skillVersion,
        graph: describeAuthoringGraph(loaded),
        outputDir: DIST_DIR,
        assetSetId: generatedManifest.assetSetId,
        assets: compiled.assets.map((asset) => ({
          host: asset.host,
          path: asset.path,
          outputPath: `${asset.host}/${asset.path}`,
          digest: asset.digest,
          byteLength: asset.byteLength,
        })),
        content,
        manifests: [GENERATED_MANIFEST, CUSTODY_MANIFEST],
      };
    } finally {
      releaseLock();
    }
  });
}
