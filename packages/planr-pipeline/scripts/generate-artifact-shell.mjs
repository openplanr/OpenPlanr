#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

import {
  loadArtifactTheme,
  renderArtifactThemeCss,
  renderArtifactThemeJson,
} from '../lib/artifact/ui/tokens.mjs';
import {
  ARTIFACT_SHELL_ASSET_PATHS,
  ARTIFACT_SHELL_VERSION,
  renderArtifactShellTemplate,
} from '../lib/artifact/ui/shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const GENERATED_ARTIFACT_THEME_TARGETS = Object.freeze({
  'lib/artifact/ui/generated/artifact-theme.css': 'css',
  'lib/artifact/ui/generated/artifact-theme.json': 'json',
});

export const GENERATED_ARTIFACT_SHELL_TARGETS = Object.freeze({
  ...GENERATED_ARTIFACT_THEME_TARGETS,
  [ARTIFACT_SHELL_ASSET_PATHS.template]: 'html',
  [ARTIFACT_SHELL_ASSET_PATHS.manifest]: 'manifest',
});

export class ArtifactThemeGenerationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactThemeGenerationError';
    this.code = code;
    this.details = details;
  }
}

export function renderArtifactThemeAssets({ registryPath } = {}) {
  const theme = loadArtifactTheme(registryPath ? { registryPath } : undefined);
  return {
    'lib/artifact/ui/generated/artifact-theme.css': renderArtifactThemeCss(theme),
    'lib/artifact/ui/generated/artifact-theme.json': renderArtifactThemeJson(theme),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

export function renderArtifactShellAssetManifest(assets) {
  const records = Object.entries(assets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => ({
      path,
      bytes: Buffer.byteLength(bytes, 'utf8'),
      sha256: sha256(bytes),
    }));
  return `${JSON.stringify({
    schemaVersion: '1.0.0',
    name: 'OpenPlanr Artifact Review Shell',
    shellVersion: ARTIFACT_SHELL_VERSION,
    entrypoint: ARTIFACT_SHELL_ASSET_PATHS.template,
    sync: 'byte-for-byte',
    browserApi: {
      stage: '__openPlanrArtifactStage',
      share: '__openPlanrArtifactShare',
      hostedViewer: '__openPlanrHostedArtifactViewer',
      injectedHandlers: [
        'share.prepareShare',
        'share.createShare',
        'share.copyText',
        'hosted.decodeFragment',
        'hosted.loadShort',
        'hosted.loadRoom',
        'hosted.onEnvelope',
      ],
    },
    assets: records,
  }, null, 2)}\n`;
}

/** Bundle the browser-neutral stage controller into one deterministic asset. */
export function renderArtifactStageRuntimeAsset({ projectRoot = root } = {}) {
  const result = buildSync({
    absWorkingDir: projectRoot,
    entryPoints: ['lib/artifact/ui/stage.mjs'],
    bundle: true,
    charset: 'utf8',
    format: 'iife',
    globalName: 'OpenPlanrArtifactStage',
    legalComments: 'none',
    logLevel: 'silent',
    minify: false,
    platform: 'browser',
    sourcemap: false,
    target: ['es2022'],
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles?.[0]?.text;
  if (typeof output !== 'string' || output.length === 0) {
    throw new ArtifactThemeGenerationError(
      'E_ARTIFACT_STAGE_GENERATION',
      'Artifact stage controller did not produce browser output.',
    );
  }
  return output.endsWith('\n') ? output : `${output}\n`;
}

export function renderDesignBoardAdapterAsset({ projectRoot = root } = {}) {
  const result = buildSync({
    absWorkingDir: projectRoot,
    entryPoints: ['lib/design-engine/board-adapter.mjs'],
    bundle: true,
    charset: 'utf8',
    format: 'iife',
    globalName: 'OpenPlanrDesignBoardAdapter',
    legalComments: 'none',
    logLevel: 'silent',
    minify: false,
    platform: 'browser',
    sourcemap: false,
    target: ['es2022'],
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles?.[0]?.text;
  if (typeof output !== 'string' || output.length === 0) {
    throw new ArtifactThemeGenerationError(
      'E_DESIGN_BOARD_ADAPTER_GENERATION',
      'Design-board adapter did not produce browser output.',
    );
  }
  return output.endsWith('\n') ? output : `${output}\n`;
}

/** Render every byte that local and hosted shell consumers synchronize. */
export function renderArtifactShellAssets({ registryPath, projectRoot = root } = {}) {
  const theme = loadArtifactTheme(registryPath ? { registryPath } : undefined);
  const assets = {
    'lib/artifact/ui/generated/artifact-theme.css': renderArtifactThemeCss(theme),
    'lib/artifact/ui/generated/artifact-theme.json': renderArtifactThemeJson(theme),
    [ARTIFACT_SHELL_ASSET_PATHS.stageRuntime]: renderArtifactStageRuntimeAsset({ projectRoot }),
    'templates/design/design-board-adapter.js': renderDesignBoardAdapterAsset({ projectRoot }),
    [ARTIFACT_SHELL_ASSET_PATHS.template]: renderArtifactShellTemplate({ theme }),
  };
  return {
    ...assets,
    [ARTIFACT_SHELL_ASSET_PATHS.manifest]: renderArtifactShellAssetManifest(assets),
  };
}

function staleTargets(projectRoot, expected) {
  return Object.entries(expected)
    .filter(([target, bytes]) => {
      const path = resolve(projectRoot, target);
      return !existsSync(path) || readFileSync(path, 'utf8') !== bytes;
    })
    .map(([target]) => target)
    .sort();
}

function writeAssets(projectRoot, expected) {
  const written = [];
  for (const [target, bytes] of Object.entries(expected).sort(([left], [right]) => left.localeCompare(right))) {
    const path = resolve(projectRoot, target);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path) || readFileSync(path, 'utf8') !== bytes) {
      writeFileSync(path, bytes, 'utf8');
      written.push(relative(projectRoot, path).split(sep).join('/'));
    }
  }
  return written;
}

export function staleArtifactThemeTargets({ projectRoot = root, assets } = {}) {
  const expected = assets ?? renderArtifactThemeAssets({
    registryPath: resolve(projectRoot, 'registry/artifact-theme.json'),
  });
  return staleTargets(projectRoot, expected);
}

export function writeArtifactThemeAssets({ projectRoot = root, assets } = {}) {
  const expected = assets ?? renderArtifactThemeAssets({
    registryPath: resolve(projectRoot, 'registry/artifact-theme.json'),
  });
  return writeAssets(projectRoot, expected);
}

export function staleArtifactShellTargets({ projectRoot = root, assets } = {}) {
  const expected = assets ?? renderArtifactShellAssets({
    registryPath: resolve(projectRoot, 'registry/artifact-theme.json'),
    projectRoot,
  });
  return staleTargets(projectRoot, expected);
}

export function writeArtifactShellAssets({ projectRoot = root, assets } = {}) {
  const expected = assets ?? renderArtifactShellAssets({
    registryPath: resolve(projectRoot, 'registry/artifact-theme.json'),
    projectRoot,
  });
  return writeAssets(projectRoot, expected);
}

function parseArgs(argv) {
  const unsupported = argv.filter((arg) => arg !== '--check');
  if (unsupported.length > 0) {
    throw new ArtifactThemeGenerationError(
      'E_ARTIFACT_THEME_GENERATOR_ARGUMENT',
      `Unsupported argument${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`,
      { unsupported },
    );
  }
  return { check: argv.includes('--check') };
}

export function runArtifactThemeGenerator({ argv = process.argv.slice(2), projectRoot = root } = {}) {
  const { check } = parseArgs(argv);
  const assets = renderArtifactThemeAssets({
    registryPath: resolve(projectRoot, 'registry/artifact-theme.json'),
  });
  const stale = staleArtifactThemeTargets({ projectRoot, assets });

  if (check) {
    if (stale.length > 0) {
      throw new ArtifactThemeGenerationError(
        'E_ARTIFACT_THEME_DRIFT',
        `Generated artifact shell assets are stale:\n${stale.map((target) => `  - ${target}`).join('\n')}\nRun: npm run generate:artifact-shell`,
        { staleTargets: stale },
      );
    }
    return { ok: true, mode: 'check', staleTargets: [] };
  }

  const written = writeArtifactThemeAssets({ projectRoot, assets });
  return { ok: true, mode: 'write', written };
}

export function runArtifactShellGenerator({ argv = process.argv.slice(2), projectRoot = root } = {}) {
  const { check } = parseArgs(argv);
  const assets = renderArtifactShellAssets({
    registryPath: resolve(projectRoot, 'registry/artifact-theme.json'),
    projectRoot,
  });
  const stale = staleArtifactShellTargets({ projectRoot, assets });

  if (check) {
    if (stale.length > 0) {
      throw new ArtifactThemeGenerationError(
        'E_ARTIFACT_SHELL_DRIFT',
        `Generated artifact shell assets are stale:\n${stale.map((target) => `  - ${target}`).join('\n')}\nRun: npm run generate:artifact-shell`,
        { staleTargets: stale },
      );
    }
    return { ok: true, mode: 'check', staleTargets: [] };
  }

  const written = writeArtifactShellAssets({ projectRoot, assets });
  return { ok: true, mode: 'write', written };
}

function main() {
  try {
    const result = runArtifactShellGenerator();
    if (result.mode === 'check') {
      process.stdout.write('Artifact shell assets are current.\n');
    } else if (result.written.length === 0) {
      process.stdout.write('Artifact shell assets already current.\n');
    } else {
      process.stdout.write(`Generated artifact shell assets:\n${result.written.map((target) => `  - ${target}`).join('\n')}\n`);
    }
  } catch (error) {
    const code = error?.code ?? 'E_ARTIFACT_THEME_GENERATION';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
