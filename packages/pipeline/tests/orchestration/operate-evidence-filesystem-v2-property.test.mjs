import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, resolveLocalFilesystemEvidenceV2 } from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url), 'utf8',
));

test('filesystem path normalisation fails closed for generated absolute, traversal, separator, and empty-segment paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'operate-evidence-filesystem-property-'));
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes/evidence.txt'), 'safe\n', 'utf8');
    const valid = fixture('evidence-filesystem-valid.json');
    const provider = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers.find(({ providerId }) => providerId === 'local-filesystem-evidence-provider');
    const resolver = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.find(({ resolverId }) => resolverId === 'local-filesystem-evidence-resolver');
    const invalidPaths = [
      '/tmp/file', '../escape', 'notes/../escape', './notes/evidence.txt',
      'notes//evidence.txt', 'notes\\evidence.txt', '', 'notes/.',
    ];
    for (const path of invalidPaths) {
      const candidate = structuredClone(valid.candidate);
      candidate.locator.path = path;
      const result = resolveLocalFilesystemEvidenceV2(candidate, {
        provider,
        resolver,
        capabilities: ['evidence.filesystem.read'],
        filesystemRoots: [{
          ...valid.sourceRoot,
          rootPath: root,
          sourceContract: { id: 'context-manifest', version: '1.0.0' },
        }],
      });
      assert.equal(result.status, 'rejected', path);
      assert.equal(result.error.code, 'EVIDENCE_LOCATOR_INVALID', path);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
