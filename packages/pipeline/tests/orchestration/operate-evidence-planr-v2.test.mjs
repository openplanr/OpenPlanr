import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const SOURCE_CONTRACT = { id: 'planning-acceptance', version: '1.0.0' };

function createPlanrProject() {
  const root = mkdtempSync(join(tmpdir(), 'operate-evidence-planr-'));
  const artifactPath = join(root, '.planr/specs/SPEC-016-evidence.md');
  mkdirSync(join(root, '.planr/specs'), { recursive: true });
  writeFileSync(artifactPath, 'untracked planning evidence\n', 'utf8');
  return { root, artifactPath };
}

function resolve(candidate, projectRoot, extra = {}) {
  const valid = fixture('evidence-planr-valid.json');
  return dispatchOperateEvidenceResolverV2(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, candidate, {
    scope: valid.scope,
    capabilities: ['evidence.planr.read'],
    planrProjects: [{ ...valid.project, rootPath: projectRoot, sourceContract: SOURCE_CONTRACT }],
    ...extra,
  });
}

test('OP-14: a declared untracked .planr artifact resolves by Planr identity and exact bytes, never Git fabrication', () => {
  const project = createPlanrProject();
  try {
    const valid = fixture('evidence-planr-valid.json');
    const resolved = resolve(valid.candidate, project.root);

    assert.equal(resolved.status, 'resolved');
    const bytes = Buffer.from(resolved.capture.contentBase64, 'base64');
    assert.equal(bytes.toString('utf8'), 'untracked planning evidence\n');
    assert.equal(resolved.capture.rawHash, digest(bytes));
    assert.deepEqual(resolved.capture.locator, valid.candidate.locator);
    assert.deepEqual(resolved.capture.provenance, {
      projectId: 'project-default',
      artifactId: 'SPEC-016',
      artifactType: 'specification',
      contentHash: digest(bytes),
    });
    assert.equal(Object.hasOwn(resolved.capture.provenance, 'repositoryId'), false);
    assert.deepEqual(resolved.capture.sourceContract, SOURCE_CONTRACT);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test('Planr evidence refuses an unclassified project instead of inferring planning semantics', () => {
  const project = createPlanrProject();
  try {
    const valid = fixture('evidence-planr-valid.json');
    const result = resolve(valid.candidate, project.root, {
      planrProjects: [{ ...valid.project, rootPath: project.root }],
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, 'EVIDENCE_LOCATOR_INVALID');
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test('Planr evidence rejects source/scope/identity/path/hash/capability errors precisely', () => {
  const project = createPlanrProject();
  try {
    const valid = fixture('evidence-planr-valid.json');
    const invalid = fixture('evidence-planr-invalid.json');
    const base = clone(valid.candidate);

    assert.equal(
      resolve(base, project.root, { planrProjects: [] }).error.code,
      invalid.missingProject,
    );
    assert.equal(resolve(base, project.root, { capabilities: [] }).error.code, invalid.denied);

    const differentScope = clone(base);
    differentScope.scopeId = 'other-scope';
    assert.equal(
      resolve(differentScope, project.root, {
        scope: { ...valid.scope, scopeId: 'other-scope' },
      }).error.code,
      invalid.scopeMismatch,
    );

    const missingArtifact = clone(base);
    missingArtifact.locator.artifactId = 'SPEC-404';
    assert.equal(resolve(missingArtifact, project.root).error.code, invalid.missingArtifact);

    const wrongPath = clone(base);
    wrongPath.locator.path = '.planr/specs/other.md';
    assert.equal(resolve(wrongPath, project.root).error.code, invalid.wrongPath);

    const wrongHash = clone(base);
    wrongHash.locator.contentHash = `sha256:${'f'.repeat(64)}`;
    assert.equal(resolve(wrongHash, project.root).error.code, invalid.wrongHash);

    writeFileSync(project.artifactPath, 'changed untracked evidence\n', 'utf8');
    assert.equal(resolve(base, project.root).error.code, invalid.wrongHash);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test('an attempted Git dispatch for a Planr artifact is a kind mismatch, not a fabricated path', () => {
  const project = createPlanrProject();
  try {
    const valid = fixture('evidence-planr-valid.json');
    const invalid = fixture('evidence-planr-invalid.json');
    const candidate = clone(valid.candidate);
    candidate.provider = { id: 'local-git-evidence-provider', version: '2.0.0' };
    candidate.resolver = { id: 'local-git-evidence-resolver', version: '2.0.0' };
    const result = resolve(candidate, project.root, { capabilities: ['evidence.git.read'] });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, invalid.kindMismatch);
    assert.equal(result.error.context.evidenceKind, 'planr');
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});
