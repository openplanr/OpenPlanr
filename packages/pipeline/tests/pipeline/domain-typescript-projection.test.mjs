import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderTypeScriptOutputs } from '../../../../scripts/typescript/compile-sources.mjs';

test('artifact projection ships compiled React modules and declarations without authoring sources', () => {
  const target = mkdtempSync(join(tmpdir(), 'planr-typed-projection-'));
  try {
    const script = fileURLToPath(
      new URL('../../../../scripts/domains/project-domains.mjs', import.meta.url),
    );
    execFileSync(process.execPath, [script, '--write', '--domain', 'artifact', '--target', target]);
    const manifest = JSON.parse(
      readFileSync(join(target, 'lib/generated/domain-projections/artifact.json'), 'utf8'),
    );
    const targets = manifest.entries.map((entry) => entry.target);
    assert.ok(targets.includes('lib/artifact/ui/studio-shell-mount-impl.mjs'));
    assert.ok(targets.includes('lib/artifact/ui/studio-shell-mount-impl.d.mts'));
    assert.ok(targets.includes('lib/artifact/ui/studio-shell-components.mjs'));
    assert.ok(targets.includes('lib/artifact/ui/studio-shell-components.d.mts'));
    assert.ok(targets.includes('lib/artifact/internal/credential-writer.mjs'));
    assert.ok(targets.includes('lib/artifact/internal/credential-writer.d.mts'));
    assert.ok(
      targets.every(
        (path) => !path.endsWith('.tsx') && (!path.endsWith('.mts') || path.endsWith('.d.mts')),
      ),
    );
    const compiled = readFileSync(
      join(target, 'lib/artifact/ui/studio-shell-mount-impl.mjs'),
      'utf8',
    );
    assert.ok(!compiled.includes('@openplanr/artifact/'));
    const assetManifest = JSON.parse(
      readFileSync(join(target, 'lib/artifact/ui/generated/artifact-shell-assets.json'), 'utf8'),
    );
    const artifactRoot = fileURLToPath(new URL('../../../artifact/', import.meta.url));
    for (const asset of assetManifest.assets) {
      const projected = readFileSync(join(target, asset.path));
      assert.deepEqual(projected, readFileSync(join(artifactRoot, asset.path)), asset.path);
      assert.equal(projected.length, asset.bytes, asset.path);
      assert.equal(createHash('sha256').update(projected).digest('hex'), asset.sha256, asset.path);
    }
    const projectedModule = readFileSync(
      join(target, 'lib/artifact/diagram/editor/draft.mjs'),
      'utf8',
    );
    assert.ok(!projectedModule.includes('@openplanr/protocol/'));
    assert.ok(projectedModule.includes('lib/protocol/') || projectedModule.includes('protocol/'));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('compiled TypeScript siblings remain ignored generated outputs', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const outputs = Object.keys(renderTypeScriptOutputs({ root }));
  const ignored = new Set(
    execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: root,
      input: `${outputs.join('\n')}\n`,
      encoding: 'utf8',
    })
      .trim()
      .split('\n'),
  );
  assert.deepEqual(
    outputs.filter((path) => !ignored.has(path)),
    [],
    'Commit the canonical .mts/.tsx source; regenerate .mjs/.d.mts for package consumers.',
  );
});
