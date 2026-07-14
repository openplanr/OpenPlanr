import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { renderArtifactThemeAssets } from '../../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('generated role and adapter tables cover the canonical registries', () => {
  const roles = JSON.parse(readFileSync(join(root, 'registry', 'roles.json'), 'utf8'));
  const adapters = JSON.parse(readFileSync(join(root, 'registry', 'adapters.json'), 'utf8'));
  const roleDocs = readFileSync(join(root, 'docs', 'generated', 'roles.md'), 'utf8');
  const adapterDocs = readFileSync(join(root, 'docs', 'generated', 'adapters.md'), 'utf8');
  for (const role of roles.roles) {
    assert.match(roleDocs, new RegExp(`\\| ${role.id.replaceAll('-', '\\-')} \\|`));
    assert.match(roleDocs, new RegExp(role.capability));
  }
  for (const adapter of adapters.adapters) {
    assert.match(adapterDocs, new RegExp(`\\| ${adapter.id} \\| ${adapter.version.replaceAll('.', '\\.')} \\|`));
    assert.match(adapterDocs, new RegExp(adapter.capabilityLevel));
    assert.equal(adapter.capabilities.artifactReview, true);
    assert.match(adapterDocs, new RegExp(adapter.entrypoints.artifact.replaceAll('$', '\\$')));
  }
});

test('packaged artifact theme assets match the canonical registry byte-for-byte', () => {
  const generated = renderArtifactThemeAssets();
  for (const [target, expected] of Object.entries(generated)) {
    assert.equal(
      readFileSync(join(root, target), 'utf8'),
      expected,
      `${target} must be regenerated with npm run generate:artifact-shell`,
    );
  }
});
