import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  dispatchOperateEvidenceResolverV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const SOURCE_CONTRACT = { id: 'repository-architecture', version: '1.0.0' };

function runGit(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'operate-evidence-git-'));
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, 'notes/evidence.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  runGit(root, ['init', '--quiet']);
  runGit(root, ['add', 'notes/evidence.txt']);
  runGit(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'initial',
  ]);
  const first = runGit(root, ['rev-parse', 'HEAD']);
  runGit(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'tag',
    '-a',
    'release-one',
    '-m',
    'release one',
  ]);
  writeFileSync(join(root, 'notes/evidence.txt'), 'alpha\nbeta\ngamma\ndelta\n', 'utf8');
  runGit(root, ['add', 'notes/evidence.txt']);
  runGit(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'second',
  ]);
  return { root, first, second: runGit(root, ['rev-parse', 'HEAD']) };
}

function resolve(candidate, repository, extra = {}) {
  const valid = fixture('evidence-git-valid.json');
  return dispatchOperateEvidenceResolverV2(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, candidate, {
    scope: valid.scope,
    capabilities: ['evidence.git.read'],
    gitRepositories: [
      { ...valid.repository, rootPath: repository.root, sourceContract: SOURCE_CONTRACT },
    ],
    ...extra,
  });
}

test('OP-15: local Git resolution separately pins revision, path, lines, bytes, and dirty worktree state', () => {
  const repository = createRepository();
  try {
    const valid = fixture('evidence-git-valid.json');
    const candidate = clone(valid.candidate);
    candidate.locator.revision = repository.second;
    const resolved = resolve(candidate, repository);

    assert.equal(resolved.status, 'resolved');
    assert.equal(
      Buffer.from(resolved.capture.contentBase64, 'base64').toString('utf8'),
      'beta\ngamma\n',
    );
    assert.equal(resolved.capture.rawHash, digest(Buffer.from('beta\ngamma\n')));
    assert.equal(resolved.capture.locator.revision, repository.second);
    assert.equal(resolved.capture.locator.objectType, 'blob');
    assert.equal(resolved.capture.provenance.worktreeState, 'clean');
    assert.equal(resolved.capture.freshness, 'current');
    assert.deepEqual(resolved.capture.sourceContract, SOURCE_CONTRACT);

    writeFileSync(join(repository.root, 'notes/evidence.txt'), 'uncommitted\n', 'utf8');
    const dirty = resolve(candidate, repository);
    assert.equal(dirty.status, 'resolved');
    assert.equal(dirty.capture.provenance.worktreeState, 'dirty');
    assert.equal(
      Buffer.from(dirty.capture.contentBase64, 'base64').toString('utf8'),
      'beta\ngamma\n',
    );
    assert.equal(dirty.capture.freshness, 'historical');
  } finally {
    rmSync(repository.root, { recursive: true, force: true });
  }
});

test('Git evidence refuses an unclassified trusted repository instead of assigning a semantic default', () => {
  const repository = createRepository();
  try {
    const valid = fixture('evidence-git-valid.json');
    const candidate = clone(valid.candidate);
    candidate.locator.revision = repository.second;
    const result = resolve(candidate, repository, {
      gitRepositories: [{ ...valid.repository, rootPath: repository.root }],
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, 'EVIDENCE_LOCATOR_INVALID');
  } finally {
    rmSync(repository.root, { recursive: true, force: true });
  }
});

test('OP-15: object, revision, path, range, and requested ancestry emit independent outcomes', () => {
  const repository = createRepository();
  try {
    const valid = fixture('evidence-git-valid.json');
    const invalid = fixture('evidence-git-invalid.json');
    const base = clone(valid.candidate);
    base.locator.revision = repository.second;

    const missingSource = resolve(base, repository, { gitRepositories: [] });
    assert.equal(missingSource.error.code, invalid.missingSource);

    const missingRevision = clone(base);
    missingRevision.locator.revision = 'ffffffffffffffffffffffffffffffffffffffff';
    assert.equal(resolve(missingRevision, repository).error.code, invalid.missingRevision);

    const wrongType = clone(base);
    wrongType.locator.objectType = 'tree';
    assert.equal(resolve(wrongType, repository).error.code, invalid.wrongType);

    const missingPath = clone(base);
    missingPath.locator.path = 'notes/missing.txt';
    assert.equal(resolve(missingPath, repository).error.code, invalid.missingPath);

    const invalidRange = clone(base);
    invalidRange.locator.lines = { start: 1, end: 999 };
    assert.equal(resolve(invalidRange, repository).error.code, invalid.invalidRange);

    const wrongAncestry = clone(base);
    wrongAncestry.locator.ancestry = { ancestorRevision: repository.second };
    wrongAncestry.locator.revision = repository.first;
    assert.equal(resolve(wrongAncestry, repository).error.code, invalid.wrongAncestry);

    const noAncestry = clone(base);
    noAncestry.locator.revision = repository.first;
    delete noAncestry.locator.ancestry;
    assert.equal(
      resolve(noAncestry, repository).status,
      'resolved',
      'a valid revision has no implicit ancestry constraint',
    );

    const denied = resolve(base, repository, { capabilities: [] });
    assert.equal(denied.error.code, invalid.denied);
  } finally {
    rmSync(repository.root, { recursive: true, force: true });
  }
});

test('OP-15: Git captures commit, tree, blob, and tag objects without shell or network fallback', () => {
  const repository = createRepository();
  try {
    const valid = fixture('evidence-git-valid.json');
    for (const [revision, objectType] of [
      [repository.second, 'commit'],
      [runGit(repository.root, ['rev-parse', `${repository.second}^{tree}`]), 'tree'],
      [runGit(repository.root, ['rev-parse', `${repository.second}:notes/evidence.txt`]), 'blob'],
      ['release-one', 'tag'],
    ]) {
      const candidate = clone(valid.candidate);
      candidate.locator = { repositoryId: 'repo-control', revision, objectType };
      const resolved = resolve(candidate, repository);
      assert.equal(resolved.status, 'resolved', `${objectType} resolves`);
      assert.equal(resolved.capture.provenance.resolvedObjectType, objectType);
      assert.equal(
        resolved.capture.sizeBytes,
        Buffer.from(resolved.capture.contentBase64, 'base64').byteLength,
      );
    }
  } finally {
    rmSync(repository.root, { recursive: true, force: true });
  }
});
