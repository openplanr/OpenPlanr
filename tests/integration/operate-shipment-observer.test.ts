import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import {
  createOperatingOutcome,
  evaluateOperatingOutcome,
  reconcileOperatingOutcomeFiles,
} from '../../src/services/operate/outcomes.js';
import { reconcileOperatingShipObservations } from '../../src/services/operate/shipment-observer.js';
import type { OperatingOutcome } from '../../src/services/operate/types.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

interface ShipmentFixture {
  projectRoot: string;
  localRoot: string;
  specDirectory: string;
  outcome: OperatingOutcome;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function appendEvent(
  store: OperatingEventStore,
  input: Parameters<OperatingEventStore['append']>[0],
): Promise<void> {
  const head = (await store.replay()).eventHead;
  await store.append({ ...input, expectedHead: head.hash });
}

function manifestRecord(
  stage: string,
  exitStatus: 'success' | 'failure' | 'skipped' = 'success',
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    stage,
    agent: stage === 'qa-gate' ? 'qa-agent' : null,
    started_at: '2026-07-28T12:00:00.000Z',
    ended_at: '2026-07-28T12:04:00.000Z',
    files_written: [],
    files_modified: [],
    exit_status: exitStatus,
    error_summary: exitStatus === 'failure' ? 'fixture failed' : null,
    ...overrides,
  });
}

async function initializeShipmentFixture(): Promise<ShipmentFixture> {
  const projectRoot = await temporaryDirectory('openplanr-operate-shipment-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-shipment-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'README.md'), '# Shipment observer fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'engineering',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    charter: {
      purpose: 'Verify shipped outcomes from deterministic pipeline evidence.',
      goals: ['Observe shipment before evaluating its outcome.'],
    },
    now: '2026-07-28T11:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });

  const outcome = await createOperatingOutcome({
    id: 'OUT-001',
    sourceCycle: 'CYCLE-001',
    sourceFinding: 'FND-001',
    specId: 'SPEC-001',
    outcomeKind: 'operational',
    metric: 'verified shipment',
    unit: 'release',
    queryIdentity: 'pipeline.shipment.v1',
    direction: 'increase',
    operator: 'gte',
    aggregation: 'latest',
    baselineWindow: {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.000Z',
    },
    targetWindow: {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.000Z',
    },
    threshold: { value: 1 },
    minimumCoverage: 1,
    minimumSample: 1,
    stalePolicy: 'create-gap',
    missingPolicy: 'create-gap',
    guardrailPrecedence: 'block-on-breach',
    guardrails: [],
    source: 'planr-pipeline',
    observationWindow: '30d',
    verifyAfter: '2026-08-01',
    rollout: 'Observe the verified shipped state.',
    rollback: 'Remove only the operating observation if it was recorded incorrectly.',
    evidenceRefs: ['EVD-shipment-fixture'],
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  const specLink = {
    kind: 'operating-spec-link',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    specId: 'SPEC-001',
    sourceCycle: 'CYCLE-001',
    sourceFinding: 'FND-001',
    planningEngine: 'openplanr',
    evidenceRefs: ['EVD-shipment-fixture'],
    outcome: {
      kind: 'operational',
      metric: outcome.metric,
      unit: outcome.unit,
      queryIdentity: outcome.queryIdentity,
      direction: outcome.direction,
      operator: outcome.operator,
      aggregation: outcome.aggregation,
      baselineWindow: outcome.baselineWindow,
      targetWindow: outcome.targetWindow,
      threshold: outcome.threshold,
      minimumCoverage: outcome.minimumCoverage,
      minimumSample: outcome.minimumSample,
      stalePolicy: outcome.stalePolicy,
      missingPolicy: outcome.missingPolicy,
      guardrailPrecedence: outcome.guardrailPrecedence,
      source: outcome.source,
      observationWindow: outcome.observationWindow,
      verifyAfter: outcome.verifyAfter,
    },
    guardrails: ['Build and tests must pass.'],
    rollout: outcome.rollout,
    rollback: outcome.rollback,
  } as const;
  const store = new OperatingEventStore(projectRoot, { localRoot });
  await appendEvent(store, {
    type: 'spec.linked',
    cycleId: 'CYCLE-001',
    entityId: 'SPEC-001',
    evidenceRefs: specLink.evidenceRefs,
    payload: { record: specLink },
  });
  await appendEvent(store, {
    type: 'outcome.registered',
    cycleId: 'CYCLE-001',
    entityId: outcome.id,
    evidenceRefs: outcome.evidenceRefs,
    payload: { record: outcome },
  });
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  await mkdir(paths.outcomes, { recursive: true });
  await writeFile(join(paths.outcomes, `${outcome.id}.json`), `${JSON.stringify(outcome)}\n`);

  const specDirectory = join(projectRoot, '.planr', 'specs', 'SPEC-001-shipped-outcome');
  await mkdir(specDirectory, { recursive: true });
  await writeFile(
    join(specDirectory, 'SPEC-001-shipped-outcome.md'),
    '---\nid: "SPEC-001"\ntitle: "Shipped outcome"\nstatus: "done"\n---\n\n# Shipped outcome\n',
  );
  await writeFile(
    join(specDirectory, '.pipeline-shipped'),
    [
      'shipped_at: "2026-07-28T12:05:00.000Z"',
      'pipeline_version: "0.30.0"',
      'runtime: "codex"',
      'mode: "spec-driven"',
      'feature: "shipped-outcome"',
      'tasks_executed: 1',
      'tasks_failed: 0',
      'qa_gate_status: "passed"',
      'duration_seconds: 300',
      'agents_invoked:',
      '  - "backend-agent"',
      '  - "qa-agent"',
      'devops_status: "skipped"',
      'docs_status: "skipped"',
      'snapshot_status: "refreshed"',
      'error_reports: []',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(specDirectory, '.run-manifest.jsonl'),
    [
      manifestRecord('ship.bootstrap'),
      manifestRecord('ship.phase1'),
      manifestRecord('ship.runtime-detected', 'success', {
        cost_hint: 'runtime=codex',
      }),
      manifestRecord('ship.task:T-001', 'success', { agent: 'backend-agent' }),
      manifestRecord('qa-gate', 'success', { agent: 'qa-agent' }),
      manifestRecord('devops-bundle', 'skipped'),
      manifestRecord('doc-gen-bundle', 'skipped'),
      manifestRecord('snapshot'),
      manifestRecord('marker-write'),
      '',
    ].join('\n'),
  );
  await writeFile(
    join(specDirectory, 'qa-report.md'),
    [
      '# QA Report — SPEC-001-shipped-outcome',
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| Total tasks | 1 |',
      '| Passed | 1 |',
      '| Failed | 0 |',
      '| Build status | pass |',
      '| Test status | pass |',
      '',
      '## Overall Verdict',
      '',
      '[PASS — proceed to /snapshot]',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(projectRoot, '.planr', 'provenance.jsonl'),
    `${JSON.stringify({
      schema_version: '1.0.0',
      event_id: 'shipment-fixture-event',
      timestamp: '2026-07-28T12:05:01.000Z',
      artifact_id: 'SPEC-001',
      artifact_path: '.planr/specs/SPEC-001-shipped-outcome/SPEC-001-shipped-outcome.md',
      operation: 'shipped',
      producer: {
        product: 'planr-pipeline',
        version: '0.30.0',
        runtime: 'codex',
        phase: 'delivery',
      },
      run_id: 'shipment-fixture-run',
    })}\n`,
  );
  return { projectRoot, localRoot, specDirectory, outcome };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('Operating Board shipped-outcome reconciliation', () => {
  it('emits ship.observed before evaluating a due outcome observation', async () => {
    const fixture = await initializeShipmentFixture();
    const observation = await evaluateOperatingOutcome({
      outcome: fixture.outcome,
      observationId: 'OBS-shipment-001',
      observedAt: '2026-08-01T12:00:00.000Z',
      window: fixture.outcome.targetWindow,
      value: 1,
      unit: fixture.outcome.unit,
      queryIdentity: fixture.outcome.queryIdentity,
      aggregation: fixture.outcome.aggregation,
      sampleSize: 1,
      coverage: 1,
      freshness: 'fresh',
      guardrailValues: {},
      evidenceRefs: ['EVD-shipment-observed'],
    });
    const observations = join(
      resolveOperatingPaths(fixture.projectRoot, { localRoot: fixture.localRoot }).outcomes,
      'observations',
    );
    await mkdir(observations, { recursive: true });
    await writeFile(
      join(observations, `${observation.id}.json`),
      `${JSON.stringify(observation)}\n`,
    );

    const result = await reconcileOperatingOutcomeFiles({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
    });
    const replay = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).replay();
    const types = replay.events.map((event) => event.type);

    expect(result).toMatchObject({ shipObserved: 1, reconciled: 1 });
    expect(types.indexOf('ship.observed')).toBeLessThan(types.indexOf('outcome.observed'));
    expect(result.state.specLinks).toContainEqual(
      expect.objectContaining({ specId: 'SPEC-001', state: 'shipped' }),
    );
  });

  it('does not emit when the manifest, QA, or provenance evidence is incomplete or contradictory', async () => {
    const failedManifest = await initializeShipmentFixture();
    const manifestPath = join(failedManifest.specDirectory, '.run-manifest.jsonl');
    const manifest = (await readFile(manifestPath, 'utf8')).replace(
      manifestRecord('qa-gate', 'success', { agent: 'qa-agent' }),
      manifestRecord('qa-gate', 'failure', { agent: 'qa-agent' }),
    );
    await writeFile(manifestPath, manifest);
    const manifestResult = await reconcileOperatingShipObservations({
      projectRoot: failedManifest.projectRoot,
      localRoot: failedManifest.localRoot,
    });

    const missingQa = await initializeShipmentFixture();
    await rm(join(missingQa.specDirectory, 'qa-report.md'));
    const blockedObservation = await evaluateOperatingOutcome({
      outcome: missingQa.outcome,
      observationId: 'OBS-blocked-unshipped',
      observedAt: '2026-08-01T12:00:00.000Z',
      window: missingQa.outcome.targetWindow,
      value: 1,
      unit: missingQa.outcome.unit,
      queryIdentity: missingQa.outcome.queryIdentity,
      aggregation: missingQa.outcome.aggregation,
      sampleSize: 1,
      coverage: 1,
      freshness: 'fresh',
      guardrailValues: {},
      evidenceRefs: ['EVD-blocked-unshipped'],
    });
    const missingQaObservations = join(
      resolveOperatingPaths(missingQa.projectRoot, { localRoot: missingQa.localRoot }).outcomes,
      'observations',
    );
    await mkdir(missingQaObservations, { recursive: true });
    await writeFile(
      join(missingQaObservations, `${blockedObservation.id}.json`),
      `${JSON.stringify(blockedObservation)}\n`,
    );
    const missingResult = await reconcileOperatingOutcomeFiles({
      projectRoot: missingQa.projectRoot,
      localRoot: missingQa.localRoot,
    });

    const mismatchedProvenance = await initializeShipmentFixture();
    const provenancePath = join(mismatchedProvenance.projectRoot, '.planr', 'provenance.jsonl');
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
    provenance.producer.runtime = 'cursor';
    await writeFile(provenancePath, `${JSON.stringify(provenance)}\n`);
    const mismatchResult = await reconcileOperatingShipObservations({
      projectRoot: mismatchedProvenance.projectRoot,
      localRoot: mismatchedProvenance.localRoot,
    });

    expect(manifestResult.observed).toBe(0);
    expect(missingResult).toMatchObject({ shipObserved: 0, reconciled: 0 });
    expect(mismatchResult.observed).toBe(0);
    for (const fixture of [failedManifest, missingQa, mismatchedProvenance]) {
      const replay = await new OperatingEventStore(fixture.projectRoot, {
        localRoot: fixture.localRoot,
      }).replay();
      expect(replay.events.some((event) => event.type === 'ship.observed')).toBe(false);
    }
  });

  it('is idempotent when the same shipment proof is reconciled repeatedly', async () => {
    const fixture = await initializeShipmentFixture();
    const first = await reconcileOperatingShipObservations({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
    });
    const second = await reconcileOperatingShipObservations({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
    });
    const replay = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).replay();

    expect(first.observed).toBe(1);
    expect(second.observed).toBe(0);
    expect(replay.events.filter((event) => event.type === 'ship.observed')).toHaveLength(1);
  });
});
