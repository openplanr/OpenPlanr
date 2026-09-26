import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertInvestigationRequest,
  investigationArtifactId,
} from '../../lib/pipeline/investigation-contracts.mjs';
import { captureInvestigationBaseline } from '../../lib/pipeline/investigation-identity.mjs';
import {
  advanceStoredInvestigation,
  createInvestigationReadOnlyCommandHost,
  finalizeStoredInvestigation,
  issueInvestigationFixStartCapability,
  prepareStoredInvestigationFixAuthorization,
  readInvestigationReceipt,
  startStoredInvestigation,
  verifyStoredInvestigation,
} from '../../lib/pipeline/investigation-runtime.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'planr-investigation-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  return {
    root,
    projectRoot: root,
    featureRoot: root,
    repositoryRoots: { project: root },
    scope: [{ repositoryKey: 'project', path: 'src/app.js' }],
  };
}

function clock() {
  let value = Date.parse('2026-08-24T12:00:00.000Z');
  return () => new Date((value += 1_000)).toISOString();
}

function command(id, expectedExitCodes = [0], effect = 'read-only') {
  return {
    id,
    repositoryKey: 'project',
    argv: ['node', '--version'],
    inputPaths: ['src/app.js'],
    expectedExitCodes,
    effect,
  };
}

function diagnoseRequest(scope, reproduction = command('reproduce-defect', [1])) {
  return {
    kind: 'investigation-request',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    mode: 'diagnose',
    feature: {
      mode: 'spec-driven',
      featureId: 'SPEC-028',
      slug: 'professional-power-skills-and-adaptive-review',
    },
    question: 'Why does the deterministic fixture return the wrong value?',
    targetScope: scope,
    reproduction,
  };
}

function runner(calls, output = Buffer.from('bounded evidence')) {
  return (descriptor) => {
    calls.push(descriptor.id);
    return {
      exitCode: descriptor.id === 'reproduce-defect' ? 1 : 0,
      stdoutBytes: output,
      stderrBytes: Buffer.alloc(0),
      unavailable: false,
    };
  };
}

function commandHost(calls, output = Buffer.from('bounded evidence')) {
  return createInvestigationReadOnlyCommandHost({ execute: runner(calls, output) });
}

function observationFrom(
  summary,
  fact = 'The fixture returns value 1 while the accepted contract requires value 2.',
) {
  const identity = {
    source: { kind: 'reproduction', id: summary.reproduction.commandId },
    fact,
    evidenceDigest: summary.reproduction.evidenceDigest,
  };
  return { id: investigationArtifactId('obs', identity), ...identity };
}

function hypothesesFrom(observationId) {
  return [
    {
      rank: 1,
      statement: 'The exported constant has the wrong literal value.',
      observationIds: [observationId],
    },
    {
      rank: 2,
      statement: 'The runtime loader substitutes the exported value.',
      observationIds: [observationId],
    },
  ].map((identity) => ({ id: investigationArtifactId('hyp', identity), ...identity }));
}

function experimentFrom(
  hypotheses,
  { kind = 'read-only', approval = null, results = ['supported', 'rejected'] } = {},
) {
  const design = {
    name: 'Compare source literal with direct module evaluation',
    kind,
    command: command('discriminate-cause', [0], kind),
    hypothesisIds: hypotheses.map(({ id }) => id),
    predictions: hypotheses.map(({ id }, index) => ({
      hypothesisId: id,
      expected:
        index === 0
          ? 'The source literal is value 1.'
          : 'The source literal is value 2 before loading.',
    })),
  };
  return {
    id: investigationArtifactId('exp', design),
    ...design,
    outcome: 'The source literal is value 1 and direct evaluation preserves it.',
    resultByHypothesis: hypotheses.map(({ id }, index) => ({
      hypothesisId: id,
      disposition: results[index],
    })),
    approval,
  };
}

function advanceDiagnosis(options, calls) {
  const host = commandHost(calls);
  let summary = startStoredInvestigation({
    ...options,
    request: diagnoseRequest(options.scope),
    runId: 'inv_11111111111111111111111111111111',
    clock: clock(),
    commandHost: host,
  });
  const observation = observationFrom(summary);
  summary = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event: { type: 'observation.recorded', expectedGeneration: summary.generation, observation },
  });
  const hypotheses = hypothesesFrom(observation.id);
  summary = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event: { type: 'hypotheses.registered', expectedGeneration: summary.generation, hypotheses },
  });
  const experiment = experimentFrom(hypotheses);
  const event = { type: 'experiment.ran', expectedGeneration: summary.generation, experiment };
  summary = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event,
  });
  const replay = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event,
  });
  assert.equal(replay.replayed, true);
  assert.equal(calls.filter((id) => id === 'discriminate-cause').length, 1);
  const diagnosis = {
    status: 'proven',
    causeHypothesisId: hypotheses[0].id,
    experimentIds: [experiment.id],
    confidence: 0.98,
    affectedScope: options.scope,
    proposedRegression: command('regression-test'),
    summary:
      'The named discriminating experiment supports the source-literal cause and rejects loader substitution.',
  };
  summary = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event: { type: 'diagnosis.concluded', expectedGeneration: summary.generation, diagnosis },
  });
  summary = finalizeStoredInvestigation({ ...options, runId: summary.runId, clock: clock() });
  return {
    summary,
    receipt: readInvestigationReceipt({
      projectRoot: options.root,
      featureRoot: options.featureRoot,
      receiptHash: summary.receiptHash,
    }),
  };
}

test('proven diagnosis stays read-only and authorized fix runs each frozen verification command once', () => {
  const options = fixture();
  const original = readFileSync(join(options.root, 'src', 'app.js'), 'utf8');
  const calls = [];
  const diagnosis = advanceDiagnosis(options, calls);
  assert.equal(diagnosis.summary.state, 'proven');
  assert.equal(readFileSync(join(options.root, 'src', 'app.js'), 'utf8'), original);
  assert.equal(diagnosis.receipt.diagnosis.experimentIds.length, 1);
  assert.match(diagnosis.summary.receiptHash, /^sha256:/);

  const authority = {
    kind: 'investigation-fix-authority',
    schemaVersion: '1.0.0',
    authorityId: 'auth_22222222222222222222222222222222',
    actorId: 'owner.1',
    reason: 'Apply the smallest diagnosis-bound literal correction.',
    diagnosisReceiptHash: diagnosis.summary.receiptHash,
    targetBaselineDigest: diagnosis.receipt.terminal.finalBaselineDigest,
    scope: options.scope,
    issuedAt: '2026-08-24T12:10:00.000Z',
    expiresAt: null,
    digest: null,
  };
  authority.digest = sha256Jcs(authority);
  const request = {
    kind: 'investigation-request',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    mode: 'fix',
    feature: diagnoseRequest(options.scope).feature,
    diagnosisReceiptHash: diagnosis.summary.receiptHash,
    authority,
    regression: command('regression-test'),
    relevantSuite: command('relevant-suite'),
  };
  const host = commandHost(calls);
  const runId = 'inv_33333333333333333333333333333333';
  assert.throws(
    () =>
      startStoredInvestigation({ ...options, request, runId, clock: clock(), commandHost: host }),
    { code: 'E_INVESTIGATION_FIX_AUTHORITY_REQUIRED' },
  );
  assert.equal(existsSync(join(options.root, '.investigation', 'active', `${runId}.json`)), false);
  const preview = prepareStoredInvestigationFixAuthorization({
    ...options,
    request,
    clock: clock(),
  });
  const fixCapability = issueInvestigationFixStartCapability(preview);
  assert.throws(() => issueInvestigationFixStartCapability(preview), {
    code: 'E_INVESTIGATION_FIX_AUTHORITY_REQUIRED',
  });
  assert.throws(
    () =>
      startStoredInvestigation({
        ...options,
        request,
        runId,
        clock: clock(),
        commandHost: host,
        fixCapability: structuredClone(fixCapability),
      }),
    { code: 'E_INVESTIGATION_FIX_AUTHORITY_REQUIRED' },
  );
  let fix = startStoredInvestigation({
    ...options,
    request,
    runId,
    clock: clock(),
    commandHost: host,
    fixCapability,
  });
  writeFileSync(join(options.root, 'src', 'app.js'), 'export const value = 2;\n');
  fix = advanceStoredInvestigation({
    ...options,
    runId: fix.runId,
    clock: clock(),
    commandHost: host,
    event: {
      type: 'change.recorded',
      expectedGeneration: fix.generation,
      summary: 'Change only the proven wrong literal.',
    },
  });
  assert.deepEqual(fix.changedPaths, [
    { repositoryKey: 'project', path: 'src/app.js', changeType: 'modify' },
  ]);
  fix = verifyStoredInvestigation({
    ...options,
    runId: fix.runId,
    clock: clock(),
    commandHost: host,
  });
  const verificationReplay = verifyStoredInvestigation({
    ...options,
    runId: fix.runId,
    clock: clock(),
    commandHost: host,
  });
  assert.equal(verificationReplay.replayed, true);
  assert.equal(calls.filter((id) => id === 'regression-test').length, 1);
  assert.equal(calls.filter((id) => id === 'relevant-suite').length, 1);
  fix = finalizeStoredInvestigation({ ...options, runId: fix.runId, clock: clock() });
  assert.equal(fix.state, 'passed');
  const replay = startStoredInvestigation({
    ...options,
    request,
    runId: fix.runId,
    clock: clock(),
    commandHost: host,
    fixCapability,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptHash, fix.receiptHash);
  assert.throws(
    () =>
      startStoredInvestigation({
        ...options,
        request,
        runId: 'inv_99999999999999999999999999999999',
        clock: clock(),
        commandHost: host,
        fixCapability,
      }),
    { code: 'E_INVESTIGATION_FIX_AUTHORITY_REPLAYED' },
  );
});

test('fabricated observations, circular proof, private evidence, and unapproved risky experiments fail before persistence or execution', () => {
  const options = fixture();
  const calls = [];
  const host = commandHost(calls);
  let summary = startStoredInvestigation({
    ...options,
    request: diagnoseRequest(options.scope),
    runId: 'inv_44444444444444444444444444444444',
    clock: clock(),
    commandHost: host,
  });
  const fabricated = observationFrom(summary);
  fabricated.evidenceDigest = sha256Jcs({ fabricated: true });
  assert.throws(
    () =>
      advanceStoredInvestigation({
        ...options,
        runId: summary.runId,
        clock: clock(),
        commandHost: host,
        event: { type: 'observation.recorded', expectedGeneration: 0, observation: fabricated },
      }),
    { code: 'E_INVESTIGATION_OBSERVATION_FABRICATED' },
  );
  assert.throws(
    () =>
      advanceStoredInvestigation({
        ...options,
        runId: summary.runId,
        clock: clock(),
        commandHost: host,
        event: {
          type: 'observation.recorded',
          expectedGeneration: 0,
          observation: observationFrom(
            summary,
            'Raw file /Users/person/private/project/config.js proves it.',
          ),
        },
      }),
    { code: 'E_INVESTIGATION_PRIVATE_DATA' },
  );
  const observation = observationFrom(summary);
  summary = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event: { type: 'observation.recorded', expectedGeneration: 0, observation },
  });
  const hypotheses = hypothesesFrom(observation.id);
  summary = advanceStoredInvestigation({
    ...options,
    runId: summary.runId,
    clock: clock(),
    commandHost: host,
    event: { type: 'hypotheses.registered', expectedGeneration: 1, hypotheses },
  });
  const risky = experimentFrom(hypotheses, { kind: 'network' });
  const before = calls.length;
  assert.throws(
    () =>
      advanceStoredInvestigation({
        ...options,
        runId: summary.runId,
        clock: clock(),
        commandHost: host,
        event: { type: 'experiment.ran', expectedGeneration: 2, experiment: risky },
      }),
    { code: 'E_INVESTIGATION_APPROVAL_REQUIRED' },
  );
  assert.equal(calls.length, before);
  assert.throws(
    () =>
      advanceStoredInvestigation({
        ...options,
        runId: summary.runId,
        clock: clock(),
        commandHost: host,
        event: {
          type: 'diagnosis.concluded',
          expectedGeneration: 2,
          diagnosis: {
            status: 'proven',
            causeHypothesisId: hypotheses[0].id,
            experimentIds: [],
            confidence: 0.9,
            affectedScope: options.scope,
            proposedRegression: command('regression-test'),
            summary: 'The symptom disappeared after a patch.',
          },
        },
      }),
    { code: 'E_INVESTIGATION_CAUSE_UNPROVEN' },
  );
  const active = JSON.parse(
    readFileSync(join(options.root, '.investigation', 'active', `${summary.runId}.json`), 'utf8'),
  );
  assert.equal(active.generation, 2);
});

test('diagnose detects byte drift and oversized command output is retained only as bounded digest evidence', () => {
  const drift = fixture();
  let captures = 0;
  const captureBaseline = (options) => {
    const value = captureInvestigationBaseline(options);
    captures += 1;
    return captures === 2 ? { ...value, digest: sha256Jcs({ drift: true }) } : value;
  };
  const bytes = readFileSync(join(drift.root, 'src', 'app.js'));
  assert.throws(
    () =>
      startStoredInvestigation({
        ...drift,
        request: diagnoseRequest(drift.scope),
        runId: 'inv_55555555555555555555555555555555',
        clock: clock(),
        commandHost: commandHost([]),
        captureBaseline,
      }),
    { code: 'E_INVESTIGATION_DIAGNOSIS_DRIFT' },
  );
  assert.deepEqual(readFileSync(join(drift.root, 'src', 'app.js')), bytes);
  assert.equal(
    existsSync(
      join(drift.root, '.investigation', 'active', 'inv_55555555555555555555555555555555.json'),
    ),
    false,
  );

  const oversized = fixture();
  const secretOutput = Buffer.alloc(1_048_577, 120);
  const summary = startStoredInvestigation({
    ...oversized,
    request: diagnoseRequest(oversized.scope),
    runId: 'inv_66666666666666666666666666666666',
    clock: clock(),
    commandHost: commandHost([], secretOutput),
  });
  assert.equal(summary.reproduction.truncated, true);
  assert.equal(summary.reproduction.status, 'output-limit');
  const portable = JSON.stringify(summary);
  assert.equal(portable.includes(secretOutput.subarray(0, 64).toString()), false);
  assert.ok(portable.length < 16_000);
});

test('fix request rejects absent, foreign, stale, or divergent authority identity', () => {
  const feature = diagnoseRequest([{ repositoryKey: 'project', path: 'src/app.js' }]).feature;
  const regression = command('regression-test');
  const relevantSuite = command('relevant-suite');
  assert.throws(
    () =>
      assertInvestigationRequest({
        kind: 'investigation-request',
        schemaVersion: '1.0.0',
        protocolVersion: '1.1.0',
        mode: 'fix',
        feature,
        diagnosisReceiptHash: sha256Jcs({ diagnosis: 1 }),
        regression,
        relevantSuite,
      }),
    { code: 'E_INVESTIGATION_CONTRACT_INVALID' },
  );
  const authority = {
    kind: 'investigation-fix-authority',
    schemaVersion: '1.0.0',
    authorityId: 'auth_77777777777777777777777777777777',
    actorId: 'owner.1',
    reason: 'Bound fix.',
    diagnosisReceiptHash: sha256Jcs({ diagnosis: 2 }),
    targetBaselineDigest: sha256Jcs({ baseline: 1 }),
    scope: [{ repositoryKey: 'project', path: 'src/app.js' }],
    issuedAt: '2026-08-24T12:00:00.000Z',
    expiresAt: null,
    digest: null,
  };
  authority.digest = sha256Jcs(authority);
  assert.throws(
    () =>
      assertInvestigationRequest({
        kind: 'investigation-request',
        schemaVersion: '1.0.0',
        protocolVersion: '1.1.0',
        mode: 'fix',
        feature,
        diagnosisReceiptHash: sha256Jcs({ diagnosis: 1 }),
        authority,
        regression,
        relevantSuite,
      }),
    { code: 'E_INVESTIGATION_AUTHORITY_FOREIGN' },
  );
  assert.throws(
    () =>
      assertInvestigationRequest({
        kind: 'investigation-request',
        schemaVersion: '1.0.0',
        protocolVersion: '1.1.0',
        mode: 'fix',
        feature,
        diagnosisReceiptHash: authority.diagnosisReceiptHash,
        authority: { ...authority, reason: 'Divergent.' },
        regression,
        relevantSuite,
      }),
    { code: 'E_INVESTIGATION_AUTHORITY_INVALID' },
  );
});

test('portable investigation refuses arbitrary process authority before out-of-scope, network, or destructive commands can run', () => {
  const options = fixture();
  const sibling = join(options.root, 'sibling.txt');
  writeFileSync(sibling, 'preserve me\n');
  const rawCalls = [];
  for (const argv of [
    ['rm', '-f', 'sibling.txt'],
    ['curl', 'http://127.0.0.1:9'],
    ['node', '-e', "require('node:child_process').spawnSync('node', ['--version'])"],
  ]) {
    const reproduction = { ...command('hostile-reproduction', [0]), argv };
    assert.throws(
      () =>
        startStoredInvestigation({
          ...options,
          request: diagnoseRequest(options.scope, reproduction),
          runId: `inv_${String(rawCalls.length + 7).repeat(32)}`,
          clock: clock(),
          runCommand: runner(rawCalls),
        }),
      { code: 'E_INVESTIGATION_COMMAND_HOST_REQUIRED' },
    );
  }
  assert.equal(rawCalls.length, 0);
  assert.equal(readFileSync(sibling, 'utf8'), 'preserve me\n');
  assert.equal(existsSync(join(options.root, '.investigation')), false);

  const forgedHost = {
    kind: 'investigation-command-host',
    schemaVersion: '1.0.0',
    capability: {
      filesystem: 'read-only',
      network: 'denied',
      processEffects: 'denied',
      scope: 'declared-inputs-only',
    },
  };
  assert.throws(
    () =>
      startStoredInvestigation({
        ...options,
        request: diagnoseRequest(options.scope),
        runId: 'inv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        clock: clock(),
        commandHost: forgedHost,
      }),
    { code: 'E_INVESTIGATION_COMMAND_HOST_REQUIRED' },
  );

  const confinedCalls = [];
  const outOfScope = { ...command('out-of-scope'), inputPaths: ['sibling.txt'] };
  assert.throws(
    () =>
      startStoredInvestigation({
        ...options,
        request: diagnoseRequest(options.scope, outOfScope),
        runId: 'inv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        clock: clock(),
        commandHost: commandHost(confinedCalls),
      }),
    { code: 'E_INVESTIGATION_SCOPE_VIOLATION' },
  );
  assert.equal(confinedCalls.length, 0);
  assert.equal(readFileSync(sibling, 'utf8'), 'preserve me\n');
});
