#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  importMermaid,
  renderDiagramOutputs,
} from '../../../packages/artifact/lib/artifact/diagram/index.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, '..', '..', '..');
const fixtureRoot = join(workspaceRoot, 'packages', 'artifact', 'fixtures', 'diagram', 'grammars');
const flowchartFixturePath = join(scriptDirectory, 'fixtures', 'flowchart.mmd');

const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function directoryBytes(root) {
  let total = 0;
  const visit = (target) => {
    const info = statSync(target);
    if (info.isFile()) {
      total += info.size;
      return;
    }
    if (!info.isDirectory()) return;
    for (const name of readdirSync(target)) visit(join(target, name));
  };
  visit(root);
  return total;
}

function packageRoot(packageName) {
  return dirname(fileURLToPath(import.meta.resolve(`${packageName}/package.json`)));
}

function activeRendererPayload() {
  const platformSuffix = process.platform === 'darwin'
    ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    : `linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}-gnu`;
  const packages = [
    '@resvg/resvg-js',
    `@resvg/resvg-js-${platformSuffix}`,
    '@expo-google-fonts/inter',
  ];
  const entries = packages.map((name) => ({ name, bytes: directoryBytes(packageRoot(name)) }));
  return { entries, totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0) };
}

function renderFixture(name) {
  const document = JSON.parse(readFileSync(join(fixtureRoot, name)));
  const output = renderDiagramOutputs(document);
  return {
    document,
    output,
    structuralDigest: digest(Buffer.concat([
      Buffer.from(output.svg),
      Buffer.from(output.html),
      output.png.bytes,
      Buffer.from(JSON.stringify(output.quality)),
    ])),
  };
}

function renderFlowchartSlice() {
  const { document } = importMermaid(readFileSync(flowchartFixturePath, 'utf8'), {
    diagramId: 'renderer-flowchart-slice',
    title: 'Offline renderer flowchart slice',
    summary: 'A committed source exercises import, semantic layout, SVG, HTML, PNG, and editable-scene projection.',
    sourcePath: 'evaluation/spikes/diagram-renderer/fixtures/flowchart.mmd',
  });
  const output = renderDiagramOutputs(document);
  return {
    document,
    output,
    structuralDigest: digest(Buffer.concat([
      Buffer.from(JSON.stringify(document)),
      Buffer.from(output.svg),
      Buffer.from(output.html),
      output.png.bytes,
      Buffer.from(JSON.stringify(output.quality)),
    ])),
  };
}

if (process.argv.includes('--single')) {
  renderFlowchartSlice();
  process.stdout.write('ok\n');
} else {
  let networkAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('Network is disabled by the diagram renderer spike.');
  };
  try {
    const stability = Array.from({ length: 3 }, () => renderFlowchartSlice().structuralDigest);
    const galleryStarted = performance.now();
    const gallery = readdirSync(fixtureRoot)
      .filter((name) => name.endsWith('.planr-diagram.json'))
      .sort()
      .map(renderFixture);
    const galleryMs = performance.now() - galleryStarted;
    const coldStarted = performance.now();
    const cold = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--single'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
      maxBuffer: 1024 * 1024,
    });
    const coldMs = performance.now() - coldStarted;
    if (cold.status !== 0 || cold.stdout.trim() !== 'ok') throw new Error(`Cold render failed: ${cold.stderr || cold.stdout}`);
    const payload = activeRendererPayload();
    process.stdout.write(`${JSON.stringify({
      kind: 'openplanr-diagram-renderer-spike-result',
      schemaVersion: '1.0.0',
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      selected: '@resvg/resvg-js@2.6.2',
      font: '@expo-google-fonts/inter@0.4.2/400Regular/Inter_400Regular.ttf',
      flowchart: {
        threeRunStable: new Set(stability).size === 1,
        structuralDigest: stability[0],
        coldMs: Number(coldMs.toFixed(3)),
      },
      gallery: {
        fixtures: gallery.length,
        durationMs: Number(galleryMs.toFixed(3)),
        totalPngBytes: gallery.reduce((total, entry) => total + entry.output.png.byteLength, 0),
      },
      payload,
      networkAttempts,
      passed: new Set(stability).size === 1
        && coldMs <= 2_000
        && gallery.length === 39
        && galleryMs <= 15_000
        && payload.totalBytes <= 15 * 1024 * 1024
        && networkAttempts === 0,
    }, null, 2)}\n`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
