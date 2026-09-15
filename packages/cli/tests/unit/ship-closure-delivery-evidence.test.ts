import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertShipClosure,
  buildShipClosureManifestRow,
  buildShipClosureMarker,
  buildShipClosureRunEvidence,
  renderShipClosureMarker,
  renderShipClosureQaReport,
} from 'planr-pipeline';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import {
  requireCurrentReceiptCustody,
  validateShipClosureDeliveryEvidence,
} from '../../src/services/operate/delivery-evidence.js';

vi.mock('planr-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('planr-pipeline')>();
  return {
    ...actual,
    prepareShip: () => ({ root: `/repo/${FEATURE_ROOT}` }),
    verifyShipCompatibilityProjection: () => true,
  };
});

const RUN_ID = `ship_${'1'.repeat(32)}`;
const RECEIPT_PATH = `.ship/receipts/${RUN_ID}.json`;
const FEATURE_ROOT = '.planr/specs/SPEC-001-retention-workflow';
const NOW = '2026-08-21T12:00:00.000Z';
const pipelineVersion = createRequire(import.meta.url)('planr-pipeline/package.json')
  .version as string;

function digest(value: unknown): string {
  return sha256Jcs(value as never);
}

function rawHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function runtimeEventReceipt(publicEvent: Record<string, unknown>, generation: number) {
  const eventId = `evt_${digest(publicEvent).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  return {
    eventId,
    type: String(publicEvent.type),
    inputDigest: digest({ ...publicEvent, eventId }),
    generation,
    at: NOW,
  };
}

function gateEventReceipt(
  phase: string,
  candidateDigest: string,
  evidence: Array<Record<string, unknown>>,
  generation: number,
) {
  const inputDigest = digest({ phase, candidateDigest, evidence });
  return {
    eventId: `evt_${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    type: 'gates.recorded',
    inputDigest,
    generation,
    at: NOW,
  };
}

function closureEventReceipt(
  state: string,
  candidateDigest: string,
  gateEvidenceDigest: string,
  generation: number,
) {
  const inputDigest = digest({ runId: RUN_ID, state, candidateDigest, gateEvidenceDigest });
  return {
    eventId: `evt_${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    type: 'closure.finalized',
    inputDigest,
    generation,
    at: NOW,
  };
}

const ORIGIN = {
  spec: { slug: 'retention-workflow' },
  correlationId: 'corr-spec-001',
  proposalId: `oprop_${'7'.repeat(32)}`,
  proposalHash: digest('proposal'),
  transaction: {
    transactionId: `txn_${'8'.repeat(32)}`,
    receiptHash: digest('transaction-receipt'),
  },
};

const OPERATING_CORRELATION = {
  correlation_id: ORIGIN.correlationId,
  proposal_id: ORIGIN.proposalId,
  proposal_hash: ORIGIN.proposalHash,
  transaction_id: ORIGIN.transaction.transactionId,
  receipt_hash: ORIGIN.transaction.receiptHash,
};

function buildFixture() {
  const reviewerRoster = ['qa-agent'];
  const gates = [
    {
      id: 'unit',
      repositoryKey: 'project',
      argv: ['npm', 'test'],
      inputs: [{ repositoryKey: 'project', path: 'src/retention.ts' }],
      dependsOn: [],
      finalRelevantSuite: true,
    },
  ];
  const inventory = [
    {
      repositoryKey: 'docs',
      path: 'README.md',
      changeType: 'added',
      kind: 'file',
      mode: 0o644,
      contentDigest: digest('docs'),
      symlinkTarget: null,
      originalPath: null,
    },
    {
      repositoryKey: 'project',
      path: 'src/retention.ts',
      changeType: 'modified',
      kind: 'file',
      mode: 0o644,
      contentDigest: digest('implementation'),
      symlinkTarget: null,
      originalPath: null,
    },
  ];
  const candidateRepositories = [
    {
      repositoryKey: 'docs',
      head: 'b'.repeat(40),
      baselineDigest: digest('docs-baseline'),
      inventoryDigest: digest(inventory.filter(({ repositoryKey }) => repositoryKey === 'docs')),
    },
    {
      repositoryKey: 'project',
      head: 'a'.repeat(40),
      baselineDigest: digest('project-baseline'),
      inventoryDigest: digest(inventory.filter(({ repositoryKey }) => repositoryKey === 'project')),
    },
  ];
  const candidateIdentity = { repositories: candidateRepositories, inventory };
  const candidate = {
    revision: 1,
    ...candidateIdentity,
    sealedAt: NOW,
    digest: digest(candidateIdentity),
  };
  const gateEvidence = ['initial', 'final'].map((phase) => ({
    gateId: 'unit',
    phase,
    candidateDigest: candidate.digest,
    inputDigest: digest(`unit-input-${phase}`),
    status: 'passed',
    startedAt: NOW,
    endedAt: NOW,
    exitCode: 0,
    stdoutDigest: digest('stdout'),
    stderrDigest: digest('stderr'),
    stdoutExcerpt: 'Unit tests passed.',
    stderrExcerpt: '',
    reusedFromPhase: null,
  }));
  const approvedScopeIdentity = {
    featureRoot: FEATURE_ROOT,
    tasks: [
      {
        id: 'T-001',
        storyId: 'US-001',
        path: {
          repositoryKey: 'project',
          path: `${FEATURE_ROOT}/tasks/TASK-001-retention.md`,
        },
        dependsOn: [],
        preserve: [],
      },
    ],
  };
  const receipt = {
    kind: 'ship-closure',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    recordType: 'receipt',
    runId: RUN_ID,
    generation: 6,
    state: 'passed',
    feature: 'retention-workflow',
    mode: 'spec-driven',
    runtime: 'codex',
    createdAt: NOW,
    updatedAt: NOW,
    approvedScope: {
      featureRoot: FEATURE_ROOT,
      taskIds: ['T-001'],
      digest: digest(approvedScopeIdentity),
    },
    tasks: [
      {
        ...approvedScopeIdentity.tasks[0],
        status: 'completed',
        agent: 'backend-agent',
        filesWritten: [],
        filesModified: [{ repositoryKey: 'project', path: 'src/retention.ts' }],
        blockedReason: null,
      },
    ],
    repositories: [
      {
        repositoryKey: 'docs',
        root: null,
        head: 'b'.repeat(40),
        baselineDigest: digest('docs-baseline'),
      },
      {
        repositoryKey: 'project',
        root: null,
        head: 'a'.repeat(40),
        baselineDigest: digest('project-baseline'),
      },
    ],
    reviewerRoster,
    rosterDigest: digest(reviewerRoster),
    gates,
    gateSetDigest: digest(gates),
    candidateRevisions: [candidate],
    reviews: [
      {
        phase: 'initial',
        candidateRevision: 1,
        reviewerIds: reviewerRoster,
        contributions: [
          {
            reviewerId: 'qa-agent',
            summary: 'QA completed the initial review contribution.',
            evidenceDigest: digest('qa-review-evidence'),
          },
        ],
        candidateDigest: candidate.digest,
        rosterDigest: digest(reviewerRoster),
        gateSetDigest: digest(gates),
        summary: 'No blocking findings.',
        reviewedFindingIds: [],
        findings: [],
        closedAt: NOW,
      },
    ],
    gateEvidence,
    events: [] as Array<{
      eventId: string;
      type: string;
      inputDigest: string;
      generation: number;
      at: string;
    }>,
    correctionImpact: null,
    terminal: {
      status: 'passed',
      at: NOW,
      reason: null,
      candidateDigest: candidate.digest,
      gateEvidenceDigest: digest(gateEvidence),
    },
    receiptHash: null as string | null,
    startedFromReceiptHash: null,
    reopenReason: null,
    operatingOriginCorrelation: OPERATING_CORRELATION,
  };
  const task = receipt.tasks[0];
  const review = receipt.reviews[0];
  receipt.events = [
    runtimeEventReceipt(
      {
        type: 'task.completed',
        expectedGeneration: 0,
        taskId: task.id,
        agent: task.agent,
        filesWritten: task.filesWritten,
        filesModified: task.filesModified,
      },
      1,
    ),
    runtimeEventReceipt({ type: 'review.opened', expectedGeneration: 1 }, 2),
    gateEventReceipt(
      'initial',
      candidate.digest,
      gateEvidence.filter(({ phase }) => phase === 'initial'),
      3,
    ),
    runtimeEventReceipt(
      {
        type: 'review.closed',
        expectedGeneration: 3,
        phase: review.phase,
        candidateRevision: review.candidateRevision,
        candidateDigest: review.candidateDigest,
        reviewerIds: review.reviewerIds,
        contributions: review.contributions,
        findings: review.findings,
        reviewedFindingIds: review.reviewedFindingIds,
        summary: review.summary,
        rosterDigest: review.rosterDigest,
        gateSetDigest: review.gateSetDigest,
      },
      4,
    ),
    gateEventReceipt(
      'final',
      candidate.digest,
      gateEvidence.filter(({ phase }) => phase === 'final'),
      5,
    ),
    closureEventReceipt('passed', candidate.digest, digest(gateEvidence), 6),
  ];
  receipt.receiptHash = digest(receipt);
  const body = `${JSON.stringify(receipt)}\n`;
  const receiptArtifactHash = rawHash(body);
  const input = {
    specId: 'SPEC-001',
    planRun: { status: 'succeeded' },
    shipRun: {
      runId: RUN_ID,
      runtime: 'codex',
      packageVersion: pipelineVersion,
      manifestHash: digest('manifest'),
      status: 'blocked',
    },
    tasks: [{ taskId: 'T-001', status: 'done', artifactHash: receiptArtifactHash }],
    changedSurfaces: ['docs:README.md', 'src/retention.ts'],
    qa: { status: 'failed', reportHash: null as string | null },
    artifacts: [
      {
        artifactId: 'ship-closure-receipt',
        path: RECEIPT_PATH,
        hash: receiptArtifactHash,
        classification: 'internal',
      },
    ],
    classification: 'internal' as const,
    summary: 'Retention implementation shipped.',
    deliveryStatus: 'blocked' as const,
    rollback: null,
    createdAt: NOW,
  };
  const shipEvent = {
    run_evidence: {
      manifest_hash: input.shipRun.manifestHash,
      manifest_start_line: 1,
      manifest_end_line: 1,
      marker_hash: digest('marker'),
      closure_receipt_hash: receipt.receiptHash,
      candidate_hash: receipt.terminal.candidateDigest,
      gate_evidence_hash: receipt.terminal.gateEvidenceDigest,
    },
  };
  const fixture = {
    receipt,
    body,
    receiptArtifactHash,
    input,
    shipEvent,
    bodies: new Map<string, string>(),
    bodiesById: new Map<string, string>(),
    aggregate: {
      status: 'blocked' as const,
      allDone: false,
      receiptCount: 1,
      tasksExecuted: 1,
      tasksFailed: 0,
    },
  };
  const refreshProjections = () => {
    fixture.body = `${JSON.stringify(fixture.receipt)}\n`;
    fixture.receiptArtifactHash = rawHash(fixture.body);
    for (const task of fixture.input.tasks) task.artifactHash = fixture.receiptArtifactHash;

    const manifestRow = buildShipClosureManifestRow(
      fixture.receipt as never,
      '/repo',
      `/repo/${FEATURE_ROOT}`,
    );
    const manifestBody = `${JSON.stringify(manifestRow)}\n`;
    const manifestHash = rawHash(manifestBody);
    const marker = buildShipClosureMarker(fixture.receipt as never, {
      manifestBytes: manifestBody,
      rowIndex: 0,
      aggregate: fixture.aggregate,
    });
    const markerBody = renderShipClosureMarker(marker);
    const qaBody = renderShipClosureQaReport(fixture.receipt as never, {
      aggregate: fixture.aggregate,
    });

    fixture.input.shipRun.manifestHash = manifestHash;
    fixture.input.qa.reportHash = rawHash(qaBody);
    fixture.input.artifacts = [
      {
        artifactId: 'ship-closure-receipt',
        path: RECEIPT_PATH,
        hash: fixture.receiptArtifactHash,
        classification: 'internal',
      },
      {
        artifactId: 'ship-manifest',
        path: '.run-manifest.jsonl',
        hash: manifestHash,
        classification: 'internal',
      },
      {
        artifactId: 'ship-marker',
        path: '.pipeline-shipped',
        hash: rawHash(markerBody),
        classification: 'internal',
      },
      {
        artifactId: 'qa-report',
        path: 'qa-report.md',
        hash: fixture.input.qa.reportHash,
        classification: 'internal',
      },
    ];
    Object.assign(
      fixture.shipEvent.run_evidence,
      buildShipClosureRunEvidence(fixture.receipt as never, marker, markerBody),
    );
    fixture.bodies = new Map([
      [RECEIPT_PATH, fixture.body],
      ['.run-manifest.jsonl', manifestBody],
      ['.pipeline-shipped', markerBody],
      ['qa-report.md', qaBody],
    ]);
    fixture.bodiesById = new Map([
      ['ship-closure-receipt', fixture.body],
      ['ship-manifest', manifestBody],
      ['ship-marker', markerBody],
      ['qa-report', qaBody],
    ]);
  };
  refreshProjections();
  return Object.assign(fixture, { refreshProjections });
}

function validate(fixture: ReturnType<typeof buildFixture>): void {
  validateShipClosureDeliveryEvidence(
    '/repo',
    `/repo/${FEATURE_ROOT}`,
    ORIGIN,
    fixture.input,
    new Map(fixture.bodies).set(RECEIPT_PATH, fixture.body),
    new Map(fixture.bodiesById).set('ship-closure-receipt', fixture.body),
    [],
    fixture.shipEvent,
    RECEIPT_PATH,
  );
}

describe('SHIP closure delivery evidence', () => {
  it('uses a fixture that satisfies the frozen closure contract', () => {
    expect(() => assertShipClosure(buildFixture().receipt)).not.toThrow();
  });

  it('rejects delivery evidence claiming a different producer package version', () => {
    const fixture = buildFixture();
    fixture.input.shipRun.packageVersion = `${pipelineVersion}-mismatched-producer`;

    expect(() => validate(fixture)).toThrow(/compatibility projection conflicts/u);
  });

  it('uses provenance to distinguish same-shape legacy fallback from missing current receipts', async () => {
    const specDir = await mkdtemp(path.join(tmpdir(), 'openplanr-ship-receipt-'));
    try {
      await expect(
        requireCurrentReceiptCustody(specDir, 'ship-run-legacy', new Map()),
      ).resolves.toBeNull();
      await expect(requireCurrentReceiptCustody(specDir, RUN_ID, new Map())).resolves.toBeNull();
      await expect(requireCurrentReceiptCustody(specDir, RUN_ID, new Map(), true)).rejects.toThrow(
        /cannot deliver before its terminal closure receipt exists/u,
      );

      const absoluteReceipt = path.join(specDir, ...RECEIPT_PATH.split('/'));
      await mkdir(path.dirname(absoluteReceipt), { recursive: true });
      await writeFile(absoluteReceipt, '{}\n');
      await expect(requireCurrentReceiptCustody(specDir, RUN_ID, new Map())).rejects.toThrow(
        /authoritative and must be included/u,
      );
      await expect(
        requireCurrentReceiptCustody(specDir, RUN_ID, new Map([[RECEIPT_PATH, '{}\n']])),
      ).resolves.toBe(RECEIPT_PATH);
    } finally {
      await rm(specDir, { recursive: true, force: true });
    }
  });

  it('accepts an explicit-task receipt with exact scoped compatibility projections', () => {
    const fixture = buildFixture();
    expect(fixture.receipt.approvedScope.taskIds).toEqual(['T-001']);
    expect(() => validate(fixture)).not.toThrow();

    const manifestRow = JSON.parse(String(fixture.bodies.get('.run-manifest.jsonl')));
    expect(manifestRow.files_modified).toEqual(['docs:README.md', 'src/retention.ts']);
    expect(String(fixture.bodies.get('qa-report.md'))).toContain('Status: BLOCKED');
    expect(String(fixture.bodies.get('qa-report.md'))).not.toContain('Feature closure:');
    expect(YAML.parse(String(fixture.bodies.get('.pipeline-shipped')))).toMatchObject({
      delivery_status: 'blocked',
      qa_gate_status: 'failed',
      tasks_executed: 1,
      tasks_failed: 0,
    });
  });

  it('rejects scoped PASS as feature success while reviewed planning tasks remain incomplete', () => {
    const fixture = buildFixture();
    fixture.input.shipRun.status = 'succeeded';
    fixture.input.qa.status = 'passed';
    Object.assign(fixture.input, { deliveryStatus: 'succeeded' });

    expect(() => validate(fixture)).toThrow(/aggregate SHIP compatibility projection/u);
  });

  it('rejects a receipt whose semantic self-hash no longer binds its content', () => {
    const fixture = buildFixture();
    fixture.receipt.updatedAt = '2026-08-21T12:00:01.000Z';
    fixture.body = `${JSON.stringify(fixture.receipt)}\n`;
    fixture.receiptArtifactHash = rawHash(fixture.body);
    fixture.input.artifacts[0].hash = fixture.receiptArtifactHash;
    fixture.input.tasks[0].artifactHash = fixture.receiptArtifactHash;

    expect(() => validate(fixture)).toThrow(/public or semantic contract/u);
  });

  it('rejects provenance that names a different terminal candidate', () => {
    const fixture = buildFixture();
    fixture.shipEvent.run_evidence.candidate_hash = digest('different-candidate');

    expect(() => validate(fixture)).toThrow(/exact run, candidate, gate, or SPEC binding/u);
  });

  it('binds each task to the raw receipt bytes, not the semantic receipt hash', () => {
    const fixture = buildFixture();
    fixture.input.tasks[0].artifactHash = String(fixture.receipt.receiptHash);

    expect(() => validate(fixture)).toThrow(/task status does not match/u);
  });

  it('projects dependency-unreachable terminal tasks as skipped', () => {
    const fixture = buildFixture();
    const pendingTask = {
      ...fixture.receipt.tasks[0],
      id: 'T-002',
      path: {
        repositoryKey: 'project',
        path: `${FEATURE_ROOT}/tasks/TASK-002-dependent.md`,
      },
      status: 'pending',
      dependsOn: ['T-001'],
      agent: null,
      filesModified: [],
      blockedReason: null,
    };
    Object.assign(fixture.receipt.tasks[0], {
      status: 'blocked',
      blockedReason: 'Implementation cannot continue.',
    });
    fixture.receipt.tasks.push(pendingTask);
    fixture.receipt.approvedScope.taskIds.push('T-002');
    fixture.receipt.approvedScope.digest = digest({
      featureRoot: FEATURE_ROOT,
      tasks: fixture.receipt.tasks.map(({ id, storyId, path, dependsOn }) => ({
        id,
        storyId,
        path,
        dependsOn,
        preserve: [],
      })),
    });
    fixture.receipt.state = 'blocked';
    fixture.receipt.generation = 2;
    fixture.receipt.reviews = [];
    fixture.receipt.gateEvidence = [];
    Object.assign(fixture.receipt.terminal, {
      status: 'blocked',
      reason: 'The approved task graph cannot complete.',
      gateEvidenceDigest: digest([]),
    });
    const blockedTask = fixture.receipt.tasks[0];
    fixture.receipt.events = [
      runtimeEventReceipt(
        {
          type: 'task.blocked',
          expectedGeneration: 0,
          taskId: blockedTask.id,
          agent: blockedTask.agent,
          reason: blockedTask.blockedReason,
          filesWritten: blockedTask.filesWritten,
          filesModified: blockedTask.filesModified,
        },
        1,
      ),
      closureEventReceipt(
        'blocked',
        fixture.receipt.terminal.candidateDigest,
        fixture.receipt.terminal.gateEvidenceDigest,
        2,
      ),
    ];
    fixture.receipt.receiptHash = null;
    fixture.receipt.receiptHash = digest(fixture.receipt);
    fixture.input.tasks = [
      { taskId: 'T-001', status: 'blocked', artifactHash: fixture.receiptArtifactHash },
      { taskId: 'T-002', status: 'skipped', artifactHash: fixture.receiptArtifactHash },
    ];
    fixture.input.shipRun.status = 'blocked';
    fixture.input.qa.status = 'failed';
    Object.assign(fixture.input, { deliveryStatus: 'blocked' });
    Object.assign(fixture.aggregate, {
      status: 'blocked',
      allDone: false,
      tasksExecuted: 0,
      tasksFailed: 1,
    });
    fixture.shipEvent.run_evidence.closure_receipt_hash = fixture.receipt.receiptHash;
    fixture.shipEvent.run_evidence.gate_evidence_hash = digest([]);
    fixture.refreshProjections();

    expect(() => validate(fixture)).not.toThrow();
  });

  it('accepts a final-gate BLOCKED receipt with zero blocked tasks and zero marker failures', () => {
    const fixture = buildFixture();
    const finalGate = fixture.receipt.gateEvidence.find(({ phase }) => phase === 'final');
    if (!finalGate) throw new Error('fixture final gate missing');
    Object.assign(finalGate, {
      status: 'failed',
      exitCode: 1,
      stdoutDigest: digest('failed-stdout'),
      stderrDigest: digest('failed-stderr'),
      stdoutExcerpt: '',
      stderrExcerpt: 'Unit tests failed.',
    });
    fixture.receipt.state = 'blocked';
    Object.assign(fixture.receipt.terminal, {
      status: 'blocked',
      reason: 'Final gates did not pass on the terminal candidate: unit.',
      gateEvidenceDigest: digest(fixture.receipt.gateEvidence),
    });
    fixture.receipt.events[4] = gateEventReceipt(
      'final',
      fixture.receipt.terminal.candidateDigest,
      [finalGate],
      5,
    );
    fixture.receipt.events[5] = closureEventReceipt(
      'blocked',
      fixture.receipt.terminal.candidateDigest,
      fixture.receipt.terminal.gateEvidenceDigest,
      6,
    );
    fixture.receipt.receiptHash = null;
    fixture.receipt.receiptHash = digest(fixture.receipt);
    fixture.input.shipRun.status = 'blocked';
    fixture.input.qa.status = 'failed';
    Object.assign(fixture.input, { deliveryStatus: 'blocked' });
    Object.assign(fixture.aggregate, {
      status: 'blocked',
      allDone: true,
      tasksExecuted: 1,
      tasksFailed: 0,
    });
    fixture.shipEvent.run_evidence.closure_receipt_hash = fixture.receipt.receiptHash;
    fixture.shipEvent.run_evidence.gate_evidence_hash = fixture.receipt.terminal.gateEvidenceDigest;
    fixture.refreshProjections();

    expect(() => validate(fixture)).not.toThrow();
    expect(YAML.parse(String(fixture.bodies.get('.pipeline-shipped'))).tasks_failed).toBe(0);
  });

  it('requires repository-qualified changed surfaces outside the project repository', () => {
    const fixture = buildFixture();
    fixture.input.changedSurfaces = ['README.md', 'src/retention.ts'];

    expect(() => validate(fixture)).toThrow(/terminal SHIP candidate inventory/u);
  });

  it.each([
    ['.run-manifest.jsonl', 'SHIP manifest'],
    ['.pipeline-shipped', 'SHIP marker'],
    ['qa-report.md', 'QA report'],
  ])('fails closed when the current receipt omits its %s projection', (projectionPath, label) => {
    const fixture = buildFixture();
    fixture.input.artifacts = fixture.input.artifacts.filter(
      (artifact) => artifact.path !== projectionPath,
    );
    fixture.bodies.delete(projectionPath);

    expect(() => validate(fixture)).toThrow(new RegExp(`exact immutable ${label}`, 'u'));
  });

  it('rejects a conflicting closure row even when its replacement bytes have valid custody', () => {
    const fixture = buildFixture();
    const row = JSON.parse(String(fixture.bodies.get('.run-manifest.jsonl')));
    row.files_modified = ['src/unrelated.ts'];
    const body = `${JSON.stringify(row)}\n`;
    const hash = rawHash(body);
    fixture.bodies.set('.run-manifest.jsonl', body);
    const artifact = fixture.input.artifacts.find(
      (candidate) => candidate.path === '.run-manifest.jsonl',
    );
    if (!artifact) throw new Error('fixture manifest missing');
    artifact.hash = hash;
    fixture.input.shipRun.manifestHash = hash;
    fixture.shipEvent.run_evidence.manifest_hash = hash;

    expect(() => validate(fixture)).toThrow(/manifest closure row conflicts/u);
  });

  it('rejects a marker whose closure binding conflicts even when provenance binds its bytes', () => {
    const fixture = buildFixture();
    const marker = YAML.parse(String(fixture.bodies.get('.pipeline-shipped')));
    marker.closure_receipt_hash = digest('different-receipt');
    const body = YAML.stringify(marker);
    const hash = rawHash(body);
    fixture.bodies.set('.pipeline-shipped', body);
    const artifact = fixture.input.artifacts.find(
      (candidate) => candidate.path === '.pipeline-shipped',
    );
    if (!artifact) throw new Error('fixture marker missing');
    artifact.hash = hash;
    fixture.shipEvent.run_evidence.marker_hash = hash;

    expect(() => validate(fixture)).toThrow(/compatibility projection conflicts/u);
  });

  it('rejects a QA projection whose replacement bytes are not the declared report', () => {
    const fixture = buildFixture();
    const body = `${String(fixture.bodies.get('qa-report.md'))}\nForged summary.\n`;
    const hash = rawHash(body);
    fixture.bodies.set('qa-report.md', body);
    const artifact = fixture.input.artifacts.find((candidate) => candidate.path === 'qa-report.md');
    if (!artifact) throw new Error('fixture QA report missing');
    artifact.hash = hash;

    expect(() => validate(fixture)).toThrow(/QA report conflicts/u);
  });

  it('rejects provenance that does not bind the exact manifest slice and marker bytes', () => {
    const fixture = buildFixture();
    fixture.shipEvent.run_evidence.manifest_end_line = 2;

    expect(() => validate(fixture)).toThrow(/provenance does not bind/u);
  });
});
