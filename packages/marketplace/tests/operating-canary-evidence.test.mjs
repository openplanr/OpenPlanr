import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REQUIRED_OPERATING_CANARY_EVIDENCE,
  createOperatingCanaryReport,
  validateOperatingCanaryEvidence,
} from '../scripts/operating-canary-evidence.mjs';
import { materializeOperatingCanary } from '../scripts/materialize-operating-canary.mjs';

const pendingEvidence = () =>
  REQUIRED_OPERATING_CANARY_EVIDENCE.map((id) => ({
    id,
    status: 'pending',
    url: null,
    digest: null,
    checkedAt: null,
  }));

test('draft evidence is valid but cannot satisfy the verified release gate', () => {
  const evidence = pendingEvidence();
  assert.deepEqual(validateOperatingCanaryEvidence(evidence), []);
  const errors = validateOperatingCanaryEvidence(evidence, { requirePassed: true });
  assert.equal(errors.length, REQUIRED_OPERATING_CANARY_EVIDENCE.length);
  assert.ok(errors.every((error) => error.includes('must pass')));
});

test('release evidence must originate from the deterministic marketplace canary', () => {
  const evidence = pendingEvidence().map((entry) => ({
    ...entry,
    status: 'passed',
    url: 'https://example.com/manually-claimed-proof',
    digest: `sha256:${'a'.repeat(64)}`,
    checkedAt: '2026-07-28T13:00:00.000Z',
  }));
  const errors = validateOperatingCanaryEvidence(evidence, { requirePassed: true });
  assert.equal(errors.length, REQUIRED_OPERATING_CANARY_EVIDENCE.length);
  assert.ok(errors.every((error) => error.includes('marketplace canary run URL')));
});

test('canary report hashes one non-empty artifact for every required release proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openplanr-operating-canary-'));
  try {
    for (const id of REQUIRED_OPERATING_CANARY_EVIDENCE) {
      await writeFile(join(directory, `${id}.log`), `${id}: passed\n`);
    }
    const report = createOperatingCanaryReport({
      directory,
      url: 'https://github.com/openplanr/marketplace/actions/runs/123',
      checkedAt: '2026-07-28T13:00:00.000Z',
    });
    assert.equal(report.kind, 'openplanr-operating-canary-report');
    assert.deepEqual(
      report.evidence.map(({ id }) => id),
      REQUIRED_OPERATING_CANARY_EVIDENCE,
    );
    assert.ok(report.evidence.every(({ status }) => status === 'passed'));
    assert.ok(report.evidence.every(({ digest }) => /^sha256:[a-f0-9]{64}$/.test(digest)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('materialized evidence binds the successful matrix to exact participant commits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openplanr-operating-materialized-'));
  try {
    const participants = {
      pipelineCommit: 'a'.repeat(40),
      cliCommit: 'b'.repeat(40),
      skillsCommit: 'c'.repeat(40),
    };
    const result = materializeOperatingCanary({
      directory,
      ...participants,
      runId: '126',
      repository: 'openplanr/marketplace',
    });
    assert.equal(result.count, REQUIRED_OPERATING_CANARY_EVIDENCE.length);
    const proof = JSON.parse(await readFile(join(directory, 'packed-cli.log'), 'utf8'));
    assert.deepEqual(proof.participants, {
      pipeline: participants.pipelineCommit,
      cli: participants.cliCommit,
      skills: participants.skillsCommit,
    });
    assert.equal(proof.runId, '126');
    assert.equal(proof.status, 'passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing, empty, duplicate, or failed evidence cannot certify a release', async () => {
  const duplicate = pendingEvidence();
  duplicate[4].id = duplicate[3].id;
  assert.ok(validateOperatingCanaryEvidence(duplicate).some((error) => error.includes('ordered')));
  assert.ok(validateOperatingCanaryEvidence(duplicate).some((error) => error.includes('duplicate')));

  const failed = pendingEvidence().map((entry) => ({
    ...entry,
    status: 'failed',
    url: 'https://github.com/openplanr/marketplace/actions/runs/124',
    digest: `sha256:${'a'.repeat(64)}`,
    checkedAt: '2026-07-28T13:00:00.000Z',
  }));
  assert.equal(validateOperatingCanaryEvidence(failed).length, 0);
  assert.ok(
    validateOperatingCanaryEvidence(failed, { requirePassed: true }).every((error) =>
      error.includes('must pass'),
    ),
  );

  const directory = await mkdtemp(join(tmpdir(), 'openplanr-operating-canary-empty-'));
  try {
    for (const id of REQUIRED_OPERATING_CANARY_EVIDENCE) {
      await writeFile(join(directory, `${id}.log`), id === 'packed-cli' ? '' : 'passed\n');
    }
    assert.throws(
      () =>
        createOperatingCanaryReport({
          directory,
          url: 'https://github.com/openplanr/marketplace/actions/runs/125',
        }),
      /packed-cli\.log is empty/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
