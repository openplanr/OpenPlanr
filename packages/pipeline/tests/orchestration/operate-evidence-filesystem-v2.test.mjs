import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  dispatchOperateEvidenceResolverV2,
  resolveLocalFilesystemEvidenceV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const clone = (value) => structuredClone(value);
const SOURCE_CONTRACT = { id: 'context-manifest', version: '1.0.0' };

function createRoots() {
  const parent = mkdtempSync(join(tmpdir(), 'operate-evidence-filesystem-'));
  const root = join(parent, 'root');
  const outside = join(parent, 'outside.txt');
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, 'notes/evidence.txt'), 'exact evidence\n', 'utf8');
  writeFileSync(join(root, 'notes/secret.txt'), '-----BEGIN PRIVATE KEY-----\n', 'utf8');
  writeFileSync(join(root, 'notes/oversized.txt'), 'x'.repeat(2048), 'utf8');
  writeFileSync(outside, 'outside\n', 'utf8');
  symlinkSync(outside, join(root, 'notes/outside-link.txt'));
  return { parent, root };
}

function resolve(candidate, roots, extra = {}) {
  const valid = fixture('evidence-filesystem-valid.json');
  return dispatchOperateEvidenceResolverV2(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, candidate, {
    scope: valid.scope,
    capabilities: ['evidence.filesystem.read'],
    filesystemRoots: [{ ...valid.sourceRoot, rootPath: roots.root, sourceContract: SOURCE_CONTRACT }],
    ...extra,
  });
}

function resolveDirect(candidate, roots, extra = {}) {
  const valid = fixture('evidence-filesystem-valid.json');
  return resolveLocalFilesystemEvidenceV2(candidate, {
    provider: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers.find(({ providerId }) => providerId === 'local-filesystem-evidence-provider'),
    resolver: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.find(({ resolverId }) => resolverId === 'local-filesystem-evidence-resolver'),
    capabilities: ['evidence.filesystem.read'],
    filesystemRoots: [{ ...valid.sourceRoot, rootPath: roots.root, sourceContract: SOURCE_CONTRACT }],
    ...extra,
  });
}

test('filesystem evidence is registered-root-relative and exact-byte read-only', () => {
  const roots = createRoots();
  try {
    const valid = fixture('evidence-filesystem-valid.json');
    const resolved = resolve(valid.candidate, roots);
    assert.equal(resolved.status, 'resolved');
    const bytes = Buffer.from(resolved.capture.contentBase64, 'base64');
    assert.equal(bytes.toString('utf8'), 'exact evidence\n');
    assert.equal(resolved.capture.rawHash, digest(bytes));
    assert.deepEqual(resolved.capture.sourceContract, SOURCE_CONTRACT);
    assert.deepEqual(resolved.capture.locator, { sourceRootId: 'workspace-root', path: 'notes/evidence.txt' });
    assert.deepEqual(resolved.capture.provenance, { sourceRootId: 'workspace-root', path: 'notes/evidence.txt' });
  } finally {
    rmSync(roots.parent, { recursive: true, force: true });
  }
});

test('filesystem evidence refuses an unclassified trusted source instead of widening its semantics', () => {
  const roots = createRoots();
  try {
    const valid = fixture('evidence-filesystem-valid.json');
    const result = resolve(valid.candidate, roots, {
      filesystemRoots: [{ ...valid.sourceRoot, rootPath: roots.root }],
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, 'EVIDENCE_LOCATOR_INVALID');
  } finally {
    rmSync(roots.parent, { recursive: true, force: true });
  }
});

test('filesystem evidence rejects capability gaps, root/path escapes, symlinks, sensitive, and oversized files', () => {
  const roots = createRoots();
  try {
    const valid = fixture('evidence-filesystem-valid.json');
    const invalid = fixture('evidence-filesystem-invalid.json');
    const base = clone(valid.candidate);

    assert.equal(resolve(base, roots, { filesystemRoots: [] }).error.code, invalid.missingSource);
    assert.equal(resolve(base, roots, { capabilities: [] }).error.code, invalid.denied);

    for (const [path, code] of [
      ['/private/secret', invalid.absolutePath],
      ['../outside.txt', invalid.traversal],
      ['notes/missing.txt', invalid.missingPath],
      ['notes/outside-link.txt', invalid.symlinkEscape],
      ['notes/oversized.txt', invalid.oversized],
      ['notes/secret.txt', invalid.secret],
    ]) {
      const candidate = clone(base);
      candidate.locator.path = path;
      const result = path.startsWith('/') || path.includes('..') ? resolveDirect(candidate, roots) : resolve(candidate, roots);
      assert.equal(result.error.code, code, path);
    }
  } finally {
    rmSync(roots.parent, { recursive: true, force: true });
  }
});
