import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { checkPackageBoundaries } from '../../../scripts/domains/boundary-check.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Artifact never imports design, pipeline, CLI, or conformance code', () => {
  assert.deepEqual(checkPackageBoundaries(packageRoot, {
    sourceDirectories: ['lib', 'scripts'],
    allowedBare: [
      /^node:/u,
      /^@openplanr\/protocol(?:\/|$)/u,
      /^(?:@resvg\/resvg-js|esbuild|pako|parse5)$/u,
    ],
  }), []);
});


test('diagram authoring has a closed browser-safe Artifact and Protocol import graph', async () => {
  const requireArtifact = createRequire(new URL('../package.json', import.meta.url));
  const { build } = requireArtifact('esbuild');
  const root = resolve(packageRoot, '../..');
  const authoringRoot = resolve(packageRoot, 'lib/artifact/diagram/authoring');
  const protocolRoot = resolve(packageRoot, '../protocol/src');
  // Shared pure geometry/text helpers are reused; Node adapters remain excluded.
  const renderingHelpers = new Set([
    'diagram/rendering/layout.mjs', 'diagram/rendering/svg.mjs',
    'diagram/rendering/theme.mjs', 'diagram/accessibility.mjs',
    'diagram/source-map.mjs',
    'diagram/errors.mjs', 'internal/contrast.mjs',
  ].map(path => resolve(packageRoot, 'lib/artifact', path)));
  const result = await build({
    absWorkingDir: root, entryPoints: [resolve(authoringRoot, 'index.mjs')],
    bundle: true, platform: 'browser', format: 'esm', treeShaking: false,
    write: false, metafile: true, target: 'es2022', logLevel: 'silent',
  });
  const inputs = Object.entries(result.metafile.inputs);
  assert.ok(inputs.length > 1, 'Inspect the transitive graph, not only the entry module');
  for (const [path, input] of inputs) {
    const absolute = resolve(root, path);
    assert.ok(absolute.startsWith(`${authoringRoot}${sep}`) || absolute.startsWith(`${protocolRoot}${sep}`) || renderingHelpers.has(absolute),
      `Unexpected diagram authoring dependency: ${path}`);
    for (const dependency of input.imports) {
      assert.equal(Boolean(dependency.external), false, `Unbundled platform or model dependency: ${dependency.path}`);
    }
  }
  // Building this whole graph for the browser also rejects Node builtins, native
  // rasterizers and filesystem-based Protocol loaders before any runtime test.
});


test('portable editor bundles without filesystem, Design, hosted identity or Node adapters', async () => {
  const requireArtifact = createRequire(new URL('../package.json', import.meta.url));
  const { build } = requireArtifact('esbuild');
  const root = resolve(packageRoot, '../..');
  const result = await build({
    absWorkingDir: root, entryPoints: [resolve(packageRoot, 'lib/artifact/diagram/editor/index.mjs')],
    bundle: true, platform: 'browser', format: 'esm', treeShaking: false,
    write: false, metafile: true, target: 'es2022', logLevel: 'silent',
  });
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    assert.doesNotMatch(file, /(?:local-owner|review-server|authoring\/(?:store|exports|migration))\.mjs$/u, file);
    assert.ok(resolve(root, file).startsWith(packageRoot + sep) || resolve(root, file).startsWith(resolve(packageRoot, '../protocol') + sep), file);
    for (const dependency of input.imports) assert.equal(Boolean(dependency.external), false, dependency.path);
  }
});
