import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canContinueDesignHandoff,
  compileDesignHandoffReadiness,
  designHandoffReadinessDigest,
} from '../lib/design/handoff-readiness.mjs';

const raw = character => character.repeat(64);
const readyInput = () => ({
  document: {
    kind: 'openplanr-design-document', schemaVersion: '1.0.0', id: 'checkout',
    selectedVariant: 'calm', variants: [{ id: 'calm', status: 'ready' }, { id: 'dense', status: 'rejected' }],
  },
  sourceRevision: raw('a'),
  studioState: { selectedVariant: 'calm' },
  specification: { path: 'design-spec.md', revision: raw('a'), digest: `sha256:${raw('b')}`, complete: true },
  verification: { path: '.design/verification/current.json', revision: raw('a'), digest: `sha256:${raw('c')}`, status: 'verified' },
  review: { path: '.design/review.json', revision: raw('a'), digest: `sha256:${raw('d')}`, current: true, pins: [] },
  reviewHandoff: {
    path: 'review-handoff.json', digest: `sha256:${raw('e')}`, status: 'approved', current: true,
    contentHash: raw('f'), approval: { contentHash: raw('f') },
    basis: { designId: 'checkout', sourceRevision: raw('a'), selectedVariant: 'calm' },
  },
});

const statusOf = (value, id) => value.checks.find(check => check.id === id).status;
const checkOf = (value, id) => value.checks.find(check => check.id === id);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('ready evidence compiles all stable checks and exposes only prepare-plan continuation', () => {
  const input = readyInput();
  const before = structuredClone(input);
  const value = compileDesignHandoffReadiness(input);
  assert.equal(value.status, 'ready');
  assert.equal(canContinueDesignHandoff(value), true);
  assert.throws(() => canContinueDesignHandoff({ kind: 'openplanr-design-handoff-readiness', continuation: { available: true } }));
  assert.deepEqual(value.continuation, { action: 'prepare-plan', available: true });
  assert.deepEqual(value.checks.map(check => check.id), [
    'current-revision', 'selected-direction', 'design-specification', 'rendered-verification',
    'review-freshness', 'review-dispositions', 'unresolved-blockers', 'approved-review-handoff',
  ]);
  assert.ok(value.checks.every(check => check.status === 'pass'));
  assert.deepEqual(input, before, 'the pure compiler does not mutate its evidence');
  assert.equal(designHandoffReadinessDigest(value), designHandoffReadinessDigest(compileDesignHandoffReadiness(structuredClone(input))));
});

test('missing, blocked, attention, and stale evidence produce exact recovery states', () => {
  const missing = readyInput(); delete missing.verification;
  let value = compileDesignHandoffReadiness(missing);
  assert.equal(value.status, 'blocked');
  assert.deepEqual(checkOf(value, 'rendered-verification'), {
    id: 'rendered-verification',
    status: 'blocked',
    message: 'Complete rendered design verification before continuing.',
    evidenceRefs: [],
    recoveryAction: { id: 'verify-rendered-design', label: 'Verify the rendered design' },
  });
  assert.equal(canContinueDesignHandoff(value), false);

  const blocking = readyInput();
  blocking.review.pins = [{ id: 'pin-1', revisionId: raw('a'), category: 'blocker', status: 'open', screenId: 'checkout' }];
  value = compileDesignHandoffReadiness(blocking);
  assert.deepEqual(checkOf(value, 'unresolved-blockers'), {
    id: 'unresolved-blockers',
    status: 'blocked',
    message: 'Blocking feedback must be resolved before continuing.',
    evidenceRefs: ['review-feedback'],
    recoveryAction: { id: 'resolve-review-blockers', label: 'Resolve the blocking feedback' },
  });
  assert.equal(value.status, 'blocked');

  const attention = readyInput();
  attention.review.pins = [{ id: 'pin-1', revisionId: raw('a'), category: 'suggestion', status: 'open', screenId: 'checkout' }];
  value = compileDesignHandoffReadiness(attention);
  assert.deepEqual(checkOf(value, 'review-dispositions'), {
    id: 'review-dispositions',
    status: 'attention',
    message: 'Some non-blocking review comments still need an owner decision.',
    evidenceRefs: ['review-feedback'],
    recoveryAction: { id: 'resolve-review-decisions', label: 'Record the remaining review decisions' },
  });
  assert.equal(value.status, 'attention');
  assert.equal(canContinueDesignHandoff(value), true);

  const stale = readyInput(); stale.verification.revision = raw('9');
  value = compileDesignHandoffReadiness(stale);
  assert.deepEqual(checkOf(value, 'rendered-verification'), {
    id: 'rendered-verification',
    status: 'stale',
    message: 'Rendered verification belongs to an earlier revision.',
    evidenceRefs: ['rendered-verification'],
    recoveryAction: { id: 'verify-rendered-design', label: 'Verify the rendered design' },
  });
  assert.equal(value.status, 'stale');
  assert.equal(canContinueDesignHandoff(value), false);
});

test('typed absence leaves ordinary work ungoverned and user guidance exposes no integrity mechanics', () => {
  const absent = compileDesignHandoffReadiness(null);
  assert.equal(absent.status, 'absent');
  assert.equal(canContinueDesignHandoff(absent), false);
  const values = [absent.message, absent.nextAction.label];
  for (const fixture of [readyInput(), (() => { const value = readyInput(); delete value.reviewHandoff; return value; })()]) {
    const report = compileDesignHandoffReadiness(fixture);
    for (const check of report.checks) values.push(check.message, check.recoveryAction?.label ?? '');
  }
  assert.doesNotMatch(values.join('\n'), /(?:sha256|hash|digest|checksum|canonical)/iu);
});

test('the private Design package packs the readiness runtime and declaration behind its explicit export', () => {
  const destination = mkdtempSync(join(tmpdir(), 'openplanr-design-handoff-pack-'));
  try {
    const result = spawnSync('npm', [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      destination,
    ], {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: join(destination, 'npm-cache') },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const [report] = JSON.parse(result.stdout);
    const files = new Set(report.files.map(({ path }) => path));
    assert.ok(files.has('lib/design/handoff-readiness.mjs'));
    assert.ok(files.has('lib/design/handoff-readiness.d.mts'));
    assert.ok(files.has('lib/design/handoff-resolution.mjs'));
    assert.ok(files.has('lib/design/handoff-resolution.d.mts'));
    assert.ok(files.has('lib/design/index.mjs'));
    assert.ok(files.has('package.json'));
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});

test('evidence order is canonical while hostile identities, anchors, versions, and paths fail closed', () => {
  const first = readyInput();
  first.review.pins = [
    { id: 'pin-b', revisionId: raw('a'), category: 'suggestion', disposition: 'deferred', screenId: 'checkout' },
    { id: 'pin-a', revisionId: raw('a'), category: 'question', disposition: 'rejected', screenId: 'checkout' },
  ];
  const second = structuredClone(first); second.review.pins.reverse();
  assert.equal(JSON.stringify(compileDesignHandoffReadiness(first)), JSON.stringify(compileDesignHandoffReadiness(second)));

  for (const mutate of [
    value => { value.document.schemaVersion = '2.0.0'; },
    value => { value.document.variants.push(structuredClone(value.document.variants[0])); },
    value => { value.review.pins = [{ id: 'pin', revisionId: raw('a'), anchorCount: 2 }]; },
    value => { value.specification.path = '../design-spec.md'; },
    value => { value.verification.digest = `sha256:${raw('A')}`; },
  ]) {
    const value = readyInput(); mutate(value);
    assert.throws(() => compileDesignHandoffReadiness(value));
  }
});
