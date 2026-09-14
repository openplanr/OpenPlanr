import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  advanceShip,
  assertShipClosure,
  finalizeShipClosure,
  getShipClosure,
  preparePlan,
  renderShipClosureMarker,
  runShipGates,
  type ShipClosureRecord,
  startShip,
} from 'planr-pipeline';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import type { JsonRecord } from '../../src/services/operate/composition.js';
import { validateShipClosureDeliveryEvidence } from '../../src/services/operate/delivery-evidence.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const pipelineRoot = resolvePipelinePackageRoot();

function digest(value: unknown): string {
  return sha256Jcs(value as never);
}

function rawHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function projectPath(value: string): { repositoryKey: string; path: string } {
  return { repositoryKey: 'project', path: value };
}

function exactChangedSurfaces(receipt: ShipClosureRecord): string[] {
  const inventory = receipt.candidateRevisions.at(-1)?.inventory ?? [];
  return [
    ...new Set(
      inventory.flatMap((entry) => {
        const qualify = (value: string | null) =>
          value === null
            ? []
            : [entry.repositoryKey === 'project' ? value : `${entry.repositoryKey}:${value}`];
        return [...qualify(entry.path), ...qualify(entry.originalPath)];
      }),
    ),
  ].sort();
}

function createPartialProjectionFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-projection-parity-'));
  mkdirSync(path.join(root, '.planr'), { recursive: true });
  mkdirSync(path.join(root, 'input', 'tech'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  writeFileSync(
    path.join(root, '.planr', 'config.json'),
    `${JSON.stringify({ idPrefix: { spec: 'SPEC' } })}\n`,
  );
  writeFileSync(
    path.join(root, 'input', 'tech', 'stack.md'),
    [
      '# Stack',
      'BuildCommand: "node --check src/app.js"',
      'TestCommand: "node --test tests/smoke.test.mjs"',
      'LintCommand: ""',
    ].join('\n'),
  );
  writeFileSync(path.join(root, 'src', 'app.js'), 'export const value = 0;\n');
  writeFileSync(
    path.join(root, 'tests', 'smoke.test.mjs'),
    "import test from 'node:test'; test('ok', () => {});\n",
  );

  const prepared = preparePlan({
    projectRoot: root,
    feature: 'retention-workflow',
    scaffold: true,
  }) as { specDir: string };
  const specDir = prepared.specDir;
  const specName = readdirSync(specDir).find((name) => /^SPEC-.*\.md$/u.test(name));
  if (!specName) throw new Error('Scaffolded SPEC is missing.');
  const specPath = path.join(specDir, specName);
  const specId = specName.match(/^(SPEC-\d+)/u)?.[1];
  if (!specId) throw new Error('Scaffolded SPEC identity is missing.');
  const logicalSpecPath = path.relative(root, specPath).replaceAll(path.sep, '/');

  mkdirSync(path.join(specDir, 'stories'), { recursive: true });
  mkdirSync(path.join(specDir, 'tasks'), { recursive: true });
  writeFileSync(
    path.join(specDir, 'stories', 'US-001-retention.md'),
    `---\nid: "US-001"\nstatus: "pending"\nupdated: "2026-08-21"\n---\n`,
  );
  for (const taskId of ['T-001', 'T-002']) {
    writeFileSync(
      path.join(specDir, 'tasks', `${taskId}-retention.md`),
      [
        '---',
        `id: "${taskId}"`,
        'storyId: "US-001"',
        'status: "pending"',
        'updated: "2026-08-21"',
        'dependsOn: []',
        'preserve:',
        '  - repositoryKey: "project"',
        `    path: "${logicalSpecPath}"`,
        '---',
        '',
        '## Definition of done',
        '- [ ] complete',
      ].join('\n'),
    );
  }

  const bridge = JSON.parse(
    readFileSync(
      path.join(
        pipelineRoot,
        'conformance',
        'fixtures',
        'operating-runtime-v2',
        'experience-bridge-valid.json',
      ),
      'utf8',
    ),
  ) as JsonRecord;
  const origin = structuredClone(bridge['operating-origin']) as JsonRecord;
  const originSpec = origin.spec as JsonRecord;
  const originTransaction = origin.transaction as JsonRecord;
  origin.proposalId = `oprop_${'1'.repeat(32)}`;
  originTransaction.transactionId = `txn_${'2'.repeat(32)}`;
  Object.assign(originSpec, {
    specId,
    slug: 'retention-workflow',
    contentHash: rawHash(readFileSync(specPath, 'utf8')),
  });
  origin.originHash = digest(
    Object.fromEntries(Object.entries(origin).filter(([key]) => key !== 'originHash')),
  );
  writeFileSync(path.join(specDir, 'operating-origin.json'), `${JSON.stringify(origin)}\n`);

  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');

  const started = startShip({
    projectRoot: root,
    feature: 'retention-workflow',
    humanReviewConfirmed: true,
    runtime: 'codex',
    taskId: 'T-001',
  }) as { runId: string };
  writeFileSync(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  let summary = advanceShip({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
    event: {
      type: 'task.completed',
      expectedGeneration: 0,
      taskId: 'T-001',
      agent: 'backend-agent',
      filesWritten: [],
      filesModified: [projectPath('src/app.js')],
    },
  }) as { generation: number };
  summary = advanceShip({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
    event: { type: 'review.opened', expectedGeneration: summary.generation },
  }) as { generation: number };
  runShipGates({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
    phase: 'initial',
  });
  const reviewState = getShipClosure({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
  }) as ShipClosureRecord;
  const candidate = reviewState.candidateRevisions.at(-1);
  if (!candidate) throw new Error('Review candidate is missing.');
  advanceShip({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
    event: {
      type: 'review.closed',
      expectedGeneration: reviewState.generation,
      phase: 'initial',
      candidateRevision: candidate.revision,
      candidateDigest: candidate.digest,
      reviewerIds: [...reviewState.reviewerRoster],
      contributions: reviewState.reviewerRoster.map((reviewerId) => ({
        reviewerId,
        summary: `${reviewerId} completed the initial review contribution.`,
        evidenceDigest: digest({ reviewerId, candidateDigest: candidate.digest }),
      })),
      findings: [],
      reviewedFindingIds: [],
      summary: 'Initial consolidated review passed.',
      rosterDigest: reviewState.rosterDigest,
      gateSetDigest: reviewState.gateSetDigest,
    },
  });
  runShipGates({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
    phase: 'final',
  });
  const finalized = finalizeShipClosure({
    projectRoot: root,
    feature: 'retention-workflow',
    runId: started.runId,
  }) as { receiptPath: string };

  const receiptBody = readFileSync(finalized.receiptPath, 'utf8');
  const receipt = assertShipClosure(JSON.parse(receiptBody));
  const receiptPath = path.relative(specDir, finalized.receiptPath).replaceAll(path.sep, '/');
  const projectionPaths = ['.run-manifest.jsonl', '.pipeline-shipped', 'qa-report.md'] as const;
  const bodies = new Map<string, string>([[receiptPath, receiptBody]]);
  for (const projectionPath of projectionPaths) {
    bodies.set(projectionPath, readFileSync(path.join(specDir, projectionPath), 'utf8'));
  }
  const marker = YAML.parse(String(bodies.get('.pipeline-shipped'))) as JsonRecord;
  const artifacts = [
    { artifactId: 'ship-closure-receipt', path: receiptPath },
    { artifactId: 'ship-manifest', path: '.run-manifest.jsonl' },
    { artifactId: 'ship-marker', path: '.pipeline-shipped' },
    { artifactId: 'qa-report', path: 'qa-report.md' },
  ].map(({ artifactId, path: artifactPath }) => ({
    artifactId,
    path: artifactPath,
    hash: rawHash(String(bodies.get(artifactPath))),
    classification: 'internal',
  }));
  const provenanceEvents = readFileSync(path.join(root, '.planr', 'provenance.jsonl'), 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
  const shipEvent = provenanceEvents.find(
    (event) => event.operation === 'shipped' && event.run_id === receipt.runId,
  );
  if (!shipEvent) throw new Error('SHIP provenance is missing.');
  const receiptArtifact = artifacts[0];
  const manifestArtifact = artifacts[1];
  const qaArtifact = artifacts[3];
  const input = {
    specId,
    planRun: { status: 'succeeded' },
    shipRun: {
      runId: receipt.runId,
      runtime: receipt.runtime,
      packageVersion: marker.pipeline_version,
      manifestHash: manifestArtifact.hash,
      status: 'blocked',
    },
    tasks: [{ taskId: 'T-001', status: 'done', artifactHash: receiptArtifact.hash }],
    changedSurfaces: exactChangedSurfaces(receipt),
    qa: { status: 'failed', reportHash: qaArtifact.hash },
    artifacts,
    classification: 'internal' as const,
    summary: 'One explicitly selected task reached terminal receipt custody.',
    deliveryStatus: 'blocked' as const,
    rollback: null,
    createdAt: receipt.terminal.at,
  };
  const bodiesById = new Map(
    artifacts.map((artifact) => [artifact.artifactId, String(bodies.get(artifact.path))]),
  );
  const validate = () =>
    validateShipClosureDeliveryEvidence(
      root,
      specDir,
      origin,
      input,
      bodies,
      bodiesById,
      provenanceEvents,
      shipEvent,
      receiptPath,
    );
  return { root, specDir, receipt, input, bodies, shipEvent, validate };
}

describe('frozen SHIP compatibility projection parity', () => {
  it('accepts aggregate BLOCKED bytes for a scoped PASS and rejects marker or QA drift', () => {
    const fixture = createPartialProjectionFixture();
    try {
      expect(fixture.receipt.state).toBe('passed');
      expect(YAML.parse(String(fixture.bodies.get('.pipeline-shipped')))).toMatchObject({
        delivery_status: 'blocked',
        qa_gate_status: 'failed',
        tasks_executed: 1,
        tasks_failed: 0,
      });
      expect(String(fixture.bodies.get('qa-report.md'))).toContain('Status: BLOCKED');
      expect(fixture.validate).not.toThrow();

      const markerPath = path.join(fixture.specDir, '.pipeline-shipped');
      const originalMarker = String(fixture.bodies.get('.pipeline-shipped'));
      const marker = YAML.parse(originalMarker) as JsonRecord;
      marker.tasks_executed = 99;
      const forgedMarker = renderShipClosureMarker(marker);
      writeFileSync(markerPath, forgedMarker);
      fixture.bodies.set('.pipeline-shipped', forgedMarker);
      const markerArtifact = fixture.input.artifacts.find(
        (artifact) => artifact.path === '.pipeline-shipped',
      );
      if (!markerArtifact) throw new Error('Marker Artifact is missing.');
      markerArtifact.hash = rawHash(forgedMarker);
      expect(fixture.validate).toThrow(/compatibility projection conflicts/u);

      writeFileSync(markerPath, originalMarker);
      fixture.bodies.set('.pipeline-shipped', originalMarker);
      markerArtifact.hash = rawHash(originalMarker);
      const qaPath = path.join(fixture.specDir, 'qa-report.md');
      const forgedQa = `${String(fixture.bodies.get('qa-report.md'))}\nForged summary.\n`;
      writeFileSync(qaPath, forgedQa);
      fixture.bodies.set('qa-report.md', forgedQa);
      const qaArtifact = fixture.input.artifacts.find(
        (artifact) => artifact.path === 'qa-report.md',
      );
      if (!qaArtifact) throw new Error('QA Artifact is missing.');
      qaArtifact.hash = rawHash(forgedQa);
      fixture.input.qa.reportHash = qaArtifact.hash;
      expect(fixture.validate).toThrow(/compatibility projection conflicts/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
