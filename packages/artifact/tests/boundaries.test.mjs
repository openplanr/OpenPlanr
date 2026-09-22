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
  const result = await build({
    absWorkingDir: root, entryPoints: [resolve(authoringRoot, 'index.mjs')],
    bundle: true, platform: 'browser', format: 'esm', treeShaking: false,
    write: false, metafile: true, target: 'es2022', logLevel: 'silent',
  });
  const inputs = Object.entries(result.metafile.inputs);
  assert.ok(inputs.length > 1, 'Inspect the transitive graph, not only the entry module');
  for (const [path, input] of inputs) {
    const absolute = resolve(root, path);
    assert.ok(absolute.startsWith(`${authoringRoot}${sep}`) || absolute.startsWith(`${protocolRoot}${sep}`),
      `Unexpected diagram authoring dependency: ${path}`);
    for (const dependency of input.imports) {
      assert.equal(Boolean(dependency.external), false, `Unbundled platform or model dependency: ${dependency.path}`);
    }
  }
  // Building this whole graph for the browser also rejects Node builtins, native
  // rasterizers and filesystem-based Protocol loaders before any runtime test.
});
