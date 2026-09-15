#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LANDING_WORKFLOW_ASSET_PATHS,
  LANDING_WORKFLOW_CATALOG_PATH,
  LANDING_WORKFLOW_MANIFEST_PATH,
} from '../lib/pipeline/landing.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function renderManifest() {
  const catalogBytes = readFileSync(join(packageRoot, LANDING_WORKFLOW_CATALOG_PATH));
  return `${JSON.stringify(
    {
      kind: 'landing-workflow-assets',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      generator: 'scripts/generate-landing-workflow-assets.mjs',
      workflowCatalogDigest: digest(catalogBytes),
      assets: LANDING_WORKFLOW_ASSET_PATHS.map((path) => ({
        path,
        digest: digest(readFileSync(join(packageRoot, path))),
      })),
    },
    null,
    2,
  )}\n`;
}

function mode(argv) {
  if (argv.length === 1 && argv[0] === '--write') return 'write';
  if (argv.length === 1 && argv[0] === '--check') return 'check';
  throw new Error('Usage: generate-landing-workflow-assets.mjs (--write|--check)');
}

export function runLandingWorkflowAssetGenerator({ argv = process.argv.slice(2) } = {}) {
  const selectedMode = mode(argv);
  const target = join(packageRoot, LANDING_WORKFLOW_MANIFEST_PATH);
  const expected = renderManifest();
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (selectedMode === 'check' && current !== expected) {
    throw new Error(`Landing workflow asset manifest drifted: ${LANDING_WORKFLOW_MANIFEST_PATH}`);
  }
  if (selectedMode === 'write' && current !== expected) writeFileSync(target, expected);
  return Object.freeze({ changed: current !== expected, mode: selectedMode, path: target });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const result = runLandingWorkflowAssetGenerator();
    process.stdout.write(
      `${result.mode === 'write' ? 'Generated' : 'Checked'} ${LANDING_WORKFLOW_MANIFEST_PATH}${
        result.changed && result.mode === 'write' ? ' (updated)' : ''
      }.\n`,
    );
  } catch (error) {
    process.stderr.write(`E_LANDING_WORKFLOW_ASSETS: ${error.message}\n`);
    process.exitCode = 1;
  }
}
