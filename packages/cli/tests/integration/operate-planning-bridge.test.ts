import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { confirmOperatingPlanningProposalV1 } from 'planr-pipeline/operate/planning-bridge-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOperateClient,
  type OperateToolRequestMapV2,
} from '../../src/services/operate/client.js';
import { createOperatePlanningGateway } from '../../src/services/operate/planning-handoff-gateway.js';
import {
  createSpecFromOperatingProposal,
  readSpecOperatingOrigin,
} from '../../src/services/operate/spec-operating-origin-service.js';
import {
  appendOpenPlanrProvenance,
  createOpenPlanrProvenanceEvent,
} from '../../src/services/provenance-service.js';
import {
  type OperatingSpecDraftInput,
  prepareOperatingSpecDraft,
} from '../../src/services/spec-service.js';
import { parseMarkdown } from '../../src/utils/markdown.js';
import {
  type AssignmentClaimV2,
  approveExactOwnerReviewForFixture,
  authoredChairResultForFixture,
  authoredChallengerResultForFixture,
  readIssuedAssignmentClaim,
  readPersistedActionSeedForFixture,
  submitAuthoredAdvisorAssignments,
  writeScreenedEvidenceFixture,
} from '../helpers/operate-business-board-lifecycle.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type RecordValue = Record<string, unknown>;
type Client = ReturnType<typeof createOperateClient>;
type Assignment = { assignmentId: string; roleId: string };

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

async function claimAndSubmit(
  client: Client,
  assignment: Assignment,
  body: (claim: AssignmentClaimV2) => RecordValue,
) {
  const actor = { actorId: `agent-${assignment.roleId}`, kind: 'agent' as const, runtime: 'codex' };
  const claimed = await client.dispatch({
    operation: 'operate.assignment.claim',
    request: {
      assignmentId: assignment.assignmentId,
      actor,
    },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  const claim = await readIssuedAssignmentClaim(client, claimed.data as RecordValue, actor);
  const submitted = await client.dispatch({
    operation: 'operate.assignment.submit',
    request: {
      assignmentId: assignment.assignmentId,
      submissionId: claim.submissionId,
      actor,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: Buffer.from(JSON.stringify(body(claim))).toString('base64'),
    },
  });
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
  return submitted.data as RecordValue;
}

async function approvedLifecycle(
  route: 'planning-work' | 'observe-only' = 'planning-work',
  actionTitle = 'Observe retention by cohort',
) {
  const project = await createTestProject(`operate-planning-${route}`);
  projects.push(project);
  await writeScreenedEvidenceFixture(project.dir);
  const client = createOperateClient(project.dir);
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      focus: ['retention'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: 'owner-test',
      deliveryRoute: route,
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const initial = started.data as {
    cycle: RecordValue & { cycleId: string };
    availableAssignments: Assignment[];
  };
  const actionSeed = await readPersistedActionSeedForFixture(project.dir);
  await submitAuthoredAdvisorAssignments(client, initial.cycle.cycleId, (assignment, body) =>
    claimAndSubmit(client, assignment, body),
  );
  const afterAdvisor = await client.dispatch({
    operation: 'operate.cycle.resume',
    request: { cycleId: initial.cycle.cycleId },
  });
  if (!afterAdvisor.ok) throw new Error(JSON.stringify(afterAdvisor));
  const challenger = (afterAdvisor.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmit(client, challenger, authoredChallengerResultForFixture);
  const beforeChair = await client.dispatch({
    operation: 'operate.cycle.get',
    request: { cycleId: initial.cycle.cycleId },
  });
  if (!beforeChair.ok) throw new Error(JSON.stringify(beforeChair));
  const chair = (beforeChair.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmit(client, chair, (claim) =>
    authoredChairResultForFixture(claim, {
      title: 'Measure retention before reallocating',
      question: 'What should the next bounded loop prioritize?',
      outcome: 'Measure retention before reallocating.',
      rationale: 'The challenged evidence supports reversible measurement-first work.',
      actionHypothesis: {
        title: actionTitle,
        objectiveId: actionSeed.objectiveId,
        metricId: actionSeed.metricId,
      },
    }),
  );
  const ownerActor = { actorId: 'owner-test', kind: 'human' as const, runtime: 'openplanr' };
  const approved = await approveExactOwnerReviewForFixture(
    client,
    initial.cycle.cycleId,
    ownerActor,
  );
  const action = ((approved.data as RecordValue).actions as RecordValue[])[0];
  return { project, client, cycleId: initial.cycle.cycleId, action };
}

async function approvedFixtureProposal(): Promise<RecordValue> {
  const fixturePath = path.join(
    resolvePipelinePackageRoot(),
    'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
  );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, RecordValue>;
  const proposal = structuredClone(fixture['operating-planning-proposal']);
  proposal.proposalId = `oprop_${'a'.repeat(32)}`;
  proposal.preview = {
    ...(proposal.preview as RecordValue),
    digest: sha256Jcs({
      proposalId: proposal.proposalId,
      correlationId: proposal.correlationId,
      eventHead: proposal.eventHead,
      framing: proposal.framing,
      actorId: (proposal.actor as RecordValue).actorId,
    }),
  };
  const { proposalHash: _fixtureHash, ...proposalBase } = proposal;
  proposal.proposalHash = sha256Jcs(proposalBase);
  return confirmOperatingPlanningProposalV1(proposal as never, {
    actorId: String((proposal.actor as RecordValue).actorId),
    proposalRevision: 1,
    proposalHash: String(proposal.proposalHash),
    eventHead: proposal.eventHead as never,
    previewDigest: String((proposal.preview as RecordValue).digest),
    confirmedAt: '2026-08-11T08:01:00Z',
  }) as unknown as RecordValue;
}

function operatingOriginFixture(): OperatingSpecDraftInput['operatingOrigin'] {
  return {
    correlationId: 'corr-safe-001',
    proposalId: 'oprop_safe_001',
    cycleId: 'cyc_safe_001',
    decision: {
      decisionId: 'dec_safe_001',
      revision: 2,
      title: 'Use one bounded workflow.',
      outcome: 'Create a reviewable SPEC.',
      rationale: 'Accepted evidence supports a bounded Planning handoff.',
    },
    action: {
      actionId: 'act_safe_001',
      revision: 3,
      expectedResult: 'The workflow is ready for explicit PLAN review.',
    },
    perspectives: [
      {
        roleId: 'strategy-finance',
        roleKind: 'advisor',
        stance: 'support',
        summary: 'Proceed within the accepted budget.',
        constraints: ['Keep the change bounded.'],
        uncertainties: ['Adoption remains unobserved.'],
      },
      {
        roleId: 'challenger',
        roleKind: 'challenger',
        stance: 'object',
        summary: 'Do not infer the intended Outcome from delivery.',
        constraints: [],
        uncertainties: ['The verification window remains future.'],
      },
      {
        roleId: 'chair',
        roleKind: 'chair',
        stance: 'synthesis',
        summary: 'Use the reversible Planning route.',
        constraints: ['Preserve explicit review.'],
        uncertainties: [],
      },
    ],
    evidence: [
      {
        evidenceRefId: 'evr_safe_001',
        relation: 'support',
        freshness: 'current',
        confidence: 0.7,
        accessState: 'available',
        summary: 'The access-safe signal supports the priority.',
        limitations: ['One bounded source.'],
      },
    ],
    omissions: [{ count: 1, reason: 'hidden-reasoning-excluded' }],
    verification: {
      metricId: 'met_safe_001',
      baseline: 0.6,
      target: 0.8,
      window: '30d',
      method: 'Compare accepted observations.',
    },
  };
}

describe('real Operate planning bridge lifecycle', () => {
  it('previews and explicitly creates one restart-safe SPEC without auto-running downstream phases', async () => {
    const lifecycle = await approvedLifecycle();
    const preview = await lifecycle.client.dispatch({
      operation: 'operate.planning.preview',
      request: {
        actionId: String(lifecycle.action.actionId),
        actor: { actorId: 'owner-test', kind: 'human' },
      },
    });
    expect(preview, JSON.stringify(preview)).toMatchObject({
      ok: true,
      operation: 'operate.planning.preview',
      data: { state: 'review-required', deliveryRoute: { route: 'planning-work' } },
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const proposal = preview.data as RecordValue;
    expect(JSON.stringify(proposal)).not.toContain('sourceArtifactValue');
    const created = await lifecycle.client.dispatch({
      operation: 'operate.planning.create-spec',
      request: {
        proposalId: String(proposal.proposalId),
        confirmDigest: String((proposal.preview as RecordValue).digest),
        actor: { actorId: 'owner-test', kind: 'human' },
      },
    });
    expect(created).toMatchObject({ ok: true, data: { specId: 'SPEC-001', replayed: false } });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const receipt = created.data as RecordValue;
    const publishedBytes = await readFile(String(receipt.specFile), 'utf8');
    const published = parseMarkdown(publishedBytes);
    expect(published.data.title).toBe('Observe retention by cohort');
    expect(Object.keys(published.data).sort()).toEqual(
      [
        'created',
        'id',
        'po',
        'priority',
        'schemaVersion',
        'slug',
        'status',
        'tech_dependencies',
        'title',
        'ui_files',
        'updated',
      ].sort(),
    );
    expect(published.data.slug).toBe('observe-retention-by-cohort');
    const decision = proposal.decision as RecordValue;
    const action = proposal.action as RecordValue;
    const verification = proposal.verification as RecordValue;
    const perspectives = proposal.acceptedPerspectiveSummaries as RecordValue[];
    const evidence = proposal.evidence as RecordValue[];
    const framing = proposal.framing as RecordValue;
    expect(published.content).toContain('## Operating origin');
    const operatingOriginContent = published.content.slice(
      published.content.indexOf('## Operating origin'),
    );
    expect(published.content).toContain(
      'Machine authority remains in the adjacent `operating-origin.json` sidecar.',
    );
    expect(operatingOriginContent).toContain(`- **Problem:** ${String(framing.problem)}`);
    expect(operatingOriginContent).toContain(
      `- **Constraints:** ${(framing.constraints as string[]).join('; ')}`,
    );
    expect(published.content).toContain(`- **Correlation:** \`${String(proposal.correlationId)}\``);
    expect(published.content).toContain(`- **Proposal:** \`${String(proposal.proposalId)}\``);
    expect(published.content).toContain(
      `- **Decision:** \`${String(decision.decisionId)}\` revision ${String(decision.revision)}`,
    );
    expect(published.content).toContain(`- **Decision rationale:** ${String(decision.rationale)}`);
    expect(published.content).toContain(`- **Intended Outcome:** ${String(decision.outcome)}`);
    expect(published.content).toContain(
      `- **Action:** \`${String(action.actionId)}\` revision ${String(action.revision)}`,
    );
    for (const perspective of perspectives) {
      expect(published.content).toContain(`\`${String(perspective.roleId)}\``);
      expect(published.content).toContain(String(perspective.summary));
    }
    for (const entry of evidence) {
      expect(published.content).toContain(`\`${String(entry.evidenceRefId)}\``);
      if (entry.summary !== null) expect(published.content).toContain(String(entry.summary));
      for (const limitation of entry.limitations as string[]) {
        expect(published.content).toContain(limitation);
      }
    }
    for (const scope of (proposal.framing as RecordValue).scope as string[]) {
      expect(published.content).toContain(scope);
    }
    for (const nonScope of (proposal.framing as RecordValue).nonScope as string[]) {
      expect(published.content).toContain(nonScope);
    }
    for (const risk of (proposal.framing as RecordValue).risks as string[]) {
      expect(published.content).toContain(risk);
    }
    expect(published.content).toContain(`- **Metric:** \`${String(verification.metricId)}\``);
    expect(published.content).toContain(`- **Baseline:** ${String(verification.baseline)}`);
    expect(published.content).toContain(`- **Target:** ${String(verification.target)}`);
    expect(published.content).toContain(`- **Window:** ${String(verification.window)}`);
    expect(published.content).toContain(
      `planr operate dashboard ${String(proposal.cycleId)} --actor <authorizedActorId>`,
    );
    const deepLink = published.content.match(/\]\(#\/operate\/actions\/([^/]+)\/planning\)/u);
    expect(deepLink).not.toBeNull();
    expect(decodeURIComponent(deepLink?.[1] ?? '')).toBe(String(action.actionId));
    const resolvedActionLink = `#/operate/actions/${encodeURIComponent(String(action.actionId))}/planning`;
    expect(resolvedActionLink).toBe(
      `#/operate/actions/${encodeURIComponent(String(action.actionId))}/planning`,
    );
    const { parseDashboardRoute } = await import('../../../../apps/dashboard/src/app/router.js');
    expect(parseDashboardRoute(resolvedActionLink)).toEqual({
      kind: 'operate.action-planning',
      product: 'operate',
      subjectId: String(action.actionId),
    });
    for (const privateArtifactId of [
      String(decision.sourceArtifactId),
      ...perspectives.map((perspective) => String(perspective.artifactId)),
      ...evidence.map((entry) => String(entry.artifactId)),
    ]) {
      expect(published.content).not.toContain(privateArtifactId);
    }
    expect(published.content).not.toContain('sourceArtifactValue');
    const replay = await createOperateClient(lifecycle.project.dir).dispatch({
      operation: 'operate.planning.create-spec',
      request: {
        proposalId: String(proposal.proposalId),
        confirmDigest: String((proposal.preview as RecordValue).digest),
        actor: { actorId: 'owner-test', kind: 'human' },
      },
    });
    expect(replay).toMatchObject({
      ok: true,
      data: { receiptHash: receipt.receiptHash, replayed: true },
    });
    const specDir = String(receipt.specDir);
    const origin = JSON.parse(
      await readFile(path.join(specDir, 'operating-origin.json'), 'utf8'),
    ) as RecordValue;
    expect(origin.proposalId).toBe(proposal.proposalId);
    const gateway = createOperatePlanningGateway({
      client: createOperateClient(lifecycle.project.dir),
      projectDir: lifecycle.project.dir,
    });
    const traceRequest = {
      specId: 'SPEC-001',
      actor: { actorId: 'owner-test', kind: 'human' as const },
      binding: {
        actorId: 'owner-test',
        scopeId: String(origin.scopeId),
        domainId: String(origin.domainId),
        domainVersion: String(origin.domainVersion),
      },
    };
    await expect(gateway.trace(traceRequest)).resolves.toMatchObject({
      receipt: { specId: 'SPEC-001' },
      origin: { cycleId: origin.cycleId, actor: { actorId: 'owner-test' } },
    });
    for (const hostile of [
      {
        ...traceRequest,
        actor: { actorId: 'foreign-owner', kind: 'human' as const },
        binding: { ...traceRequest.binding, actorId: 'foreign-owner' },
      },
      { ...traceRequest, binding: { ...traceRequest.binding, scopeId: 'foreign-scope' } },
      { ...traceRequest, binding: { ...traceRequest.binding, domainId: 'foreign-domain' } },
      { ...traceRequest, binding: { ...traceRequest.binding, domainVersion: '9.9.9' } },
    ]) {
      await expect(gateway.trace(hostile)).rejects.toMatchObject({
        code: 'E_OPERATE_PLANNING_ACCESS',
        status: 403,
        message: expect.not.stringContaining(String(proposal.proposalId)),
      });
    }
    await expect(readFile(path.join(specDir, '.pipeline-shipped'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(
      await import('node:fs/promises').then(({ readdir }) =>
        readdir(path.join(specDir, 'stories')),
      ),
    ).toEqual([]);
    expect(
      await import('node:fs/promises').then(({ readdir }) => readdir(path.join(specDir, 'tasks'))),
    ).toEqual([]);
  });

  it('rejects unauthorized access and wrong confirmation before any SPEC write', async () => {
    const lifecycle = await approvedLifecycle();
    for (const actor of [
      undefined,
      { actorId: 'foreign-owner', kind: 'human' },
      { actorId: 'owner-test', kind: 'agent' },
    ]) {
      expect(
        await lifecycle.client.dispatch({
          operation: 'operate.planning.preview',
          request: {
            actionId: String(lifecycle.action.actionId),
            ...(actor ? { actor } : {}),
          },
        } as never),
      ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_ACCESS' } });
    }
    const preview = await lifecycle.client.dispatch({
      operation: 'operate.planning.preview',
      request: {
        actionId: String(lifecycle.action.actionId),
        actor: { actorId: 'owner-test', kind: 'human' },
      },
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const proposal = preview.data as RecordValue;
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.create-spec',
        request: {
          proposalId: String(proposal.proposalId),
          confirmDigest: String((proposal.preview as RecordValue).digest),
          actor: { actorId: 'foreign-owner', kind: 'human' },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_ACCESS' } });
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.create-spec',
        request: {
          proposalId: String(proposal.proposalId),
          confirmDigest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          actor: { actorId: 'owner-test', kind: 'human' },
        },
      }),
    ).toMatchObject({ ok: false });
    await expect(stat(path.join(lifecycle.project.dir, '.planr/specs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects the observe-only delivery route before any SPEC write', async () => {
    const observed = await approvedLifecycle('observe-only');
    expect(
      await observed.client.dispatch({
        operation: 'operate.planning.preview',
        request: {
          actionId: String(observed.action.actionId),
          actor: { actorId: 'owner-test', kind: 'human' },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_ROUTE' } });
    await expect(stat(path.join(observed.project.dir, '.planr/specs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns certified delivery as evidence and original verification work without an Outcome', async () => {
    const lifecycle = await approvedLifecycle();
    const preview = await lifecycle.client.dispatch({
      operation: 'operate.planning.preview',
      request: {
        actionId: String(lifecycle.action.actionId),
        actor: { actorId: 'owner-test', kind: 'human' },
      },
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const proposal = preview.data as RecordValue;
    const created = await lifecycle.client.dispatch({
      operation: 'operate.planning.create-spec',
      request: {
        proposalId: String(proposal.proposalId),
        confirmDigest: String((proposal.preview as RecordValue).digest),
        actor: { actorId: 'owner-test', kind: 'human' },
      },
    });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const receipt = created.data as RecordValue;
    const specDir = String(receipt.specDir);
    const origin = JSON.parse(
      await readFile(path.join(specDir, 'operating-origin.json'), 'utf8'),
    ) as RecordValue;
    const transaction = origin.transaction as RecordValue;
    const operatingOrigin = {
      correlation_id: origin.correlationId,
      proposal_id: origin.proposalId,
      proposal_hash: origin.proposalHash,
      transaction_id: transaction.transactionId,
      receipt_hash: transaction.receiptHash,
    };
    const manifest = `${JSON.stringify({
      stage: 'ship.task:T-001',
      agent: 'backend-agent',
      started_at: '2026-08-12T10:00:00.000Z',
      ended_at: '2026-08-12T10:01:00.000Z',
      files_written: ['src/retention.ts'],
      files_modified: [],
      exit_status: 'success',
      error_summary: null,
      operating_origin: operatingOrigin,
    })}\n`;
    const qa = '# QA report\n\nResult: PASS\n';
    const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
    const manifestHash = hash(manifest);
    const markerFor = (
      runId: string,
      acceptedManifestHash: string,
      qaStatus: string,
      options: {
        startLine?: number;
        endLine?: number;
        taskCount?: number;
        failureCount?: number;
      } = {},
    ) =>
      `shipped_at: "2026-08-12T10:02:00.000Z"\npipeline_version: "0.42.0"\nruntime: "codex"\nmode: "spec-driven"\nfeature: "retention-workflow"\nrun_id: "${runId}"\nmanifest_hash: "${acceptedManifestHash}"\nmanifest_start_line: ${options.startLine ?? 1}\nmanifest_end_line: ${options.endLine ?? 1}\ntasks_executed: ${options.taskCount ?? 1}\ntasks_failed: ${options.failureCount ?? 0}\nqa_gate_status: "${qaStatus}"\ndelivery_status: "${options.failureCount ? 'blocked' : qaStatus === 'failed' ? 'failed' : 'succeeded'}"\nduration_seconds: 60\nagents_invoked:\n  - "backend-agent"\n  - "qa-agent"\ndevops_status: "skipped"\ndocs_status: "skipped"\nsnapshot_status: "skipped"\nerror_reports: []\noperating_origin:\n  correlation_id: "${String(operatingOrigin.correlation_id)}"\n  proposal_id: "${String(operatingOrigin.proposal_id)}"\n  proposal_hash: "${String(operatingOrigin.proposal_hash)}"\n  transaction_id: "${String(operatingOrigin.transaction_id)}"\n  receipt_hash: "${String(operatingOrigin.receipt_hash)}"\n`;
    const marker = markerFor('ship-run-001', manifestHash, 'passed');
    await writeFile(path.join(specDir, '.run-manifest.jsonl'), manifest);
    await writeFile(path.join(specDir, 'qa-report.md'), qa);
    await writeFile(path.join(specDir, '.pipeline-shipped'), marker);
    const provenancePath = path.join(lifecycle.project.dir, '.planr', 'provenance.jsonl');
    const runProvenance = (
      operation: 'decomposed' | 'shipped',
      runId: string,
      phase: 'po' | 'delivery',
      runEvidence: RecordValue | null = null,
    ) => ({
      schema_version: '1.0.0',
      event_id: `event-${operation}-${runId}`,
      timestamp: '2026-08-12T10:02:00.000Z',
      artifact_id: 'SPEC-001',
      artifact_path: path.relative(lifecycle.project.dir, String(receipt.specFile)),
      operation,
      producer: { product: 'planr-pipeline', version: '0.42.0', runtime: 'codex', phase },
      run_id: runId,
      correlation: operatingOrigin,
      ...(runEvidence === null ? {} : { run_evidence: runEvidence }),
    });
    const planProvenance = runProvenance('decomposed', 'plan-run-001', 'po');
    const shipProvenance = runProvenance('shipped', 'ship-run-001', 'delivery', {
      manifest_hash: manifestHash,
      manifest_start_line: 1,
      manifest_end_line: 1,
      marker_hash: hash(marker),
    });
    await writeFile(
      provenancePath,
      `${await readFile(provenancePath, 'utf8')}${JSON.stringify(planProvenance)}\n${JSON.stringify(shipProvenance)}\n`,
    );
    const evidenceRequest: OperateToolRequestMapV2['operate.planning.ingest-delivery'] = {
      specId: 'SPEC-001',
      planRun: {
        runId: 'plan-run-001',
        runtime: 'codex',
        packageVersion: '0.42.0',
        provenanceEventId: planProvenance.event_id,
        provenanceEventHash: sha256Jcs(planProvenance as never),
        status: 'succeeded',
      },
      shipRun: {
        runId: 'ship-run-001',
        runtime: 'codex',
        packageVersion: '0.42.0',
        manifestHash,
        provenanceEventId: shipProvenance.event_id,
        provenanceEventHash: sha256Jcs(shipProvenance as never),
        status: 'succeeded',
      },
      tasks: [{ taskId: 'T-001', status: 'done', artifactHash: manifestHash }],
      changedSurfaces: ['src/retention.ts'],
      qa: { status: 'passed', reportHash: hash(qa), summary: 'The local QA gate passed.' },
      limitations: ['Business outcome evidence remains unobserved.'],
      artifacts: [
        {
          artifactId: 'run-manifest',
          path: '.run-manifest.jsonl',
          hash: manifestHash,
          classification: 'internal',
        },
        {
          artifactId: 'qa-report',
          path: 'qa-report.md',
          hash: hash(qa),
          classification: 'internal',
        },
        {
          artifactId: 'ship-marker',
          path: '.pipeline-shipped',
          hash: hash(marker),
          classification: 'internal',
        },
      ],
      classification: 'internal' as const,
      summary:
        'Implementation and QA completed locally; business outcome verification remains pending.',
      deliveryStatus: 'succeeded' as const,
      createdAt: '2026-08-12T10:03:00.000Z',
    };
    const acceptedProvenance = await readFile(provenancePath, 'utf8');
    for (const mutateEvent of [
      (event: RecordValue) => {
        (event.producer as RecordValue).product = 'foreign-product';
      },
      (event: RecordValue) => {
        (event.producer as RecordValue).phase = 'po';
      },
      (event: RecordValue) => {
        event.artifact_path = '.planr/specs/SPEC-001-foreign/SPEC-001-foreign.md';
      },
      (event: RecordValue) => {
        event.unknownCustodyField = 'must-not-be-accepted';
      },
    ]) {
      const hostileShipEvent = structuredClone(shipProvenance);
      mutateEvent(hostileShipEvent);
      await writeFile(
        provenancePath,
        `${JSON.stringify(planProvenance)}\n${JSON.stringify(hostileShipEvent)}\n`,
      );
      expect(
        await lifecycle.client.dispatch({
          operation: 'operate.planning.ingest-delivery',
          request: evidenceRequest,
        }),
      ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    }
    await writeFile(provenancePath, acceptedProvenance);
    for (const mutateRequest of [
      (request: typeof evidenceRequest) => {
        request.shipRun.provenanceEventId = 'event-shipped-foreign';
      },
      (request: typeof evidenceRequest) => {
        request.shipRun.provenanceEventHash =
          'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      },
    ]) {
      const hostileRequest = structuredClone(evidenceRequest);
      mutateRequest(hostileRequest);
      expect(
        await lifecycle.client.dispatch({
          operation: 'operate.planning.ingest-delivery',
          request: hostileRequest,
        }),
      ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    }
    const ingested = await lifecycle.client.dispatch({
      operation: 'operate.planning.ingest-delivery',
      request: evidenceRequest,
    });
    if (!ingested.ok) throw new Error(JSON.stringify(ingested));
    expect(ingested).toMatchObject({
      ok: true,
      data: {
        replayed: false,
        deliveryEvidence: { deliveryStatus: 'succeeded', outcomeStatus: 'verification-required' },
        assignment: {
          assignmentKind: 'verification',
          roleId: 'operate-planning-delivery-verifier',
          governedOperationId: null,
        },
      },
    });
    expect(JSON.stringify(ingested)).not.toContain('operating-outcome');
    const postEffectView = await lifecycle.client.dispatch({
      operation: 'operate.experience.get',
      request: {
        cycleId: lifecycle.cycleId,
        actor: { actorId: 'owner-test', kind: 'human', runtime: 'openplanr' },
        surface: 'outcomes',
      },
    });
    if (!postEffectView.ok) throw new Error(JSON.stringify(postEffectView));
    expect(postEffectView).toMatchObject({ ok: true, data: { surface: 'outcomes' } });
    expect(JSON.stringify(postEffectView)).not.toContain(evidenceRequest.summary);
    const replay = await createOperateClient(lifecycle.project.dir).dispatch({
      operation: 'operate.planning.ingest-delivery',
      request: evidenceRequest,
    });
    expect(replay).toMatchObject({ ok: true, data: { replayed: true } });

    const taskRow = JSON.parse(manifest.trim()) as RecordValue;
    const bootstrapRow = {
      ...taskRow,
      stage: 'ship.bootstrap',
      agent: 'backend-agent',
      files_written: [],
      files_modified: [],
    };
    delete bootstrapRow.operating_origin;
    const failedAttempt = {
      ...taskRow,
      started_at: '2026-08-12T10:03:00.000Z',
      ended_at: '2026-08-12T10:03:30.000Z',
      files_written: ['src/retention-draft.ts'],
      exit_status: 'failure',
      error_summary: 'First bounded attempt failed.',
    };
    const finalAttempt = {
      ...taskRow,
      started_at: '2026-08-12T10:03:31.000Z',
      ended_at: '2026-08-12T10:04:00.000Z',
      files_written: ['src/retention.ts'],
      exit_status: 'success',
      error_summary: null,
    };
    const retryManifest = `${JSON.stringify(bootstrapRow)}\n${JSON.stringify(failedAttempt)}\n${JSON.stringify(finalAttempt)}\n`;
    const retryManifestHash = hash(retryManifest);
    const retryMarker = markerFor('ship-run-retry', retryManifestHash, 'passed', {
      endLine: 3,
    });
    await writeFile(path.join(specDir, '.run-manifest.jsonl'), retryManifest);
    await writeFile(path.join(specDir, '.pipeline-shipped'), retryMarker);
    const retryRequest = structuredClone(evidenceRequest);
    retryRequest.shipRun = {
      ...retryRequest.shipRun,
      runId: 'ship-run-retry',
      manifestHash: retryManifestHash,
    };
    retryRequest.tasks[0].artifactHash = retryManifestHash;
    retryRequest.changedSurfaces = ['src/retention-draft.ts', 'src/retention.ts'];
    retryRequest.artifacts = retryRequest.artifacts.map((artifact) =>
      artifact.path === '.run-manifest.jsonl'
        ? { ...artifact, hash: retryManifestHash }
        : artifact.path === '.pipeline-shipped'
          ? { ...artifact, hash: hash(retryMarker) }
          : artifact,
    );
    retryRequest.createdAt = '2026-08-12T10:04:30.000Z';
    const retryProvenance = runProvenance('shipped', 'ship-run-retry', 'delivery', {
      manifest_hash: retryManifestHash,
      manifest_start_line: 1,
      manifest_end_line: 3,
      marker_hash: hash(retryMarker),
    });
    retryRequest.shipRun.provenanceEventId = retryProvenance.event_id;
    retryRequest.shipRun.provenanceEventHash = sha256Jcs(retryProvenance as never);
    await writeFile(
      provenancePath,
      `${await readFile(provenancePath, 'utf8')}${JSON.stringify(retryProvenance)}\n`,
    );
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: retryRequest,
      }),
    ).toMatchObject({ ok: true, data: { replayed: false } });
    for (const mutateRetry of [
      (request: typeof retryRequest) => {
        request.changedSurfaces = ['src/retention.ts'];
      },
      (request: typeof retryRequest) => {
        request.tasks[0].status = 'blocked';
      },
      (request: typeof retryRequest) => {
        request.planRun.status = 'failed';
      },
    ]) {
      const hostileRetry = structuredClone(retryRequest);
      mutateRetry(hostileRetry);
      expect(
        await lifecycle.client.dispatch({
          operation: 'operate.planning.ingest-delivery',
          request: hostileRetry,
        }),
      ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    }

    const oldBootstrap = {
      ...bootstrapRow,
      started_at: '2026-08-12T09:55:00.000Z',
      ended_at: '2026-08-12T09:55:01.000Z',
    };
    const oldFinal = {
      ...finalAttempt,
      started_at: '2026-08-12T09:55:02.000Z',
      ended_at: '2026-08-12T09:56:00.000Z',
    };
    const resumedManifest = `${JSON.stringify(oldBootstrap)}\n${JSON.stringify(oldFinal)}\n${JSON.stringify(bootstrapRow)}\n${JSON.stringify(finalAttempt)}\n`;
    const resumedManifestHash = hash(resumedManifest);
    const resumedMarker = markerFor('ship-run-resumed', resumedManifestHash, 'passed', {
      startLine: 3,
      endLine: 4,
    });
    const resumedRequest = structuredClone(evidenceRequest);
    resumedRequest.shipRun = {
      ...resumedRequest.shipRun,
      runId: 'ship-run-resumed',
      manifestHash: resumedManifestHash,
    };
    resumedRequest.tasks[0].artifactHash = resumedManifestHash;
    resumedRequest.artifacts = resumedRequest.artifacts.map((artifact) =>
      artifact.path === '.run-manifest.jsonl'
        ? { ...artifact, hash: resumedManifestHash }
        : artifact.path === '.pipeline-shipped'
          ? { ...artifact, hash: hash(resumedMarker) }
          : artifact,
    );
    resumedRequest.createdAt = '2026-08-12T10:04:40.000Z';
    const resumedProvenance = runProvenance('shipped', 'ship-run-resumed', 'delivery', {
      manifest_hash: resumedManifestHash,
      manifest_start_line: 3,
      manifest_end_line: 4,
      marker_hash: hash(resumedMarker),
    });
    resumedRequest.shipRun.provenanceEventId = resumedProvenance.event_id;
    resumedRequest.shipRun.provenanceEventHash = sha256Jcs(resumedProvenance as never);
    await writeFile(path.join(specDir, '.run-manifest.jsonl'), resumedManifest);
    await writeFile(path.join(specDir, '.pipeline-shipped'), resumedMarker);
    const beforeResumedProvenance = await readFile(provenancePath, 'utf8');
    const olderInclusiveMarker = markerFor(
      'ship-run-resumed-old-bootstrap',
      resumedManifestHash,
      'passed',
      { startLine: 1, endLine: 4, taskCount: 1 },
    );
    const olderInclusiveEvent = runProvenance(
      'shipped',
      'ship-run-resumed-old-bootstrap',
      'delivery',
      {
        manifest_hash: resumedManifestHash,
        manifest_start_line: 1,
        manifest_end_line: 4,
        marker_hash: hash(olderInclusiveMarker),
      },
    );
    const olderInclusiveRequest = structuredClone(resumedRequest);
    olderInclusiveRequest.shipRun.runId = 'ship-run-resumed-old-bootstrap';
    olderInclusiveRequest.shipRun.provenanceEventId = olderInclusiveEvent.event_id;
    olderInclusiveRequest.shipRun.provenanceEventHash = sha256Jcs(olderInclusiveEvent as never);
    olderInclusiveRequest.artifacts = olderInclusiveRequest.artifacts.map((artifact) =>
      artifact.path === '.pipeline-shipped'
        ? { ...artifact, hash: hash(olderInclusiveMarker) }
        : artifact,
    );
    await writeFile(path.join(specDir, '.pipeline-shipped'), olderInclusiveMarker);
    await writeFile(
      provenancePath,
      `${beforeResumedProvenance}${JSON.stringify(olderInclusiveEvent)}\n`,
    );
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: olderInclusiveRequest,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    await writeFile(path.join(specDir, '.pipeline-shipped'), resumedMarker);
    await writeFile(
      provenancePath,
      `${beforeResumedProvenance}${JSON.stringify(resumedProvenance)}\n`,
    );
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: resumedRequest,
      }),
    ).toMatchObject({ ok: true, data: { replayed: false } });

    const skippedManifest = `${JSON.stringify({
      ...finalAttempt,
      exit_status: 'skipped',
      files_written: [],
    })}\n`;
    const skippedManifestHash = hash(skippedManifest);
    const skippedMarker = markerFor('ship-run-skipped', skippedManifestHash, 'passed', {
      taskCount: 0,
    });
    await writeFile(path.join(specDir, '.run-manifest.jsonl'), skippedManifest);
    await writeFile(path.join(specDir, '.pipeline-shipped'), skippedMarker);
    const skippedRequest = structuredClone(evidenceRequest);
    skippedRequest.shipRun = {
      ...skippedRequest.shipRun,
      runId: 'ship-run-skipped',
      manifestHash: skippedManifestHash,
    };
    skippedRequest.tasks[0] = {
      taskId: 'T-001',
      status: 'skipped',
      artifactHash: skippedManifestHash,
    };
    skippedRequest.changedSurfaces = [];
    skippedRequest.artifacts = skippedRequest.artifacts.map((artifact) =>
      artifact.path === '.run-manifest.jsonl'
        ? { ...artifact, hash: skippedManifestHash }
        : artifact.path === '.pipeline-shipped'
          ? { ...artifact, hash: hash(skippedMarker) }
          : artifact,
    );
    skippedRequest.createdAt = '2026-08-12T10:04:45.000Z';
    const skippedProvenance = runProvenance('shipped', 'ship-run-skipped', 'delivery', {
      manifest_hash: skippedManifestHash,
      manifest_start_line: 1,
      manifest_end_line: 1,
      marker_hash: hash(skippedMarker),
    });
    skippedRequest.shipRun.provenanceEventId = skippedProvenance.event_id;
    skippedRequest.shipRun.provenanceEventHash = sha256Jcs(skippedProvenance as never);
    await writeFile(
      provenancePath,
      `${await readFile(provenancePath, 'utf8')}${JSON.stringify(skippedProvenance)}\n`,
    );
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: skippedRequest,
      }),
    ).toMatchObject({ ok: true, data: { replayed: false } });

    for (const deliveryStatus of ['blocked', 'failed'] as const) {
      const reverse = structuredClone(evidenceRequest);
      const reverseManifest =
        deliveryStatus === 'blocked'
          ? manifest.replace('"exit_status":"success"', '"exit_status":"failure"')
          : manifest;
      const reverseQa = `# QA report\n\nResult: ${deliveryStatus.toUpperCase()}\n`;
      await writeFile(path.join(specDir, '.run-manifest.jsonl'), reverseManifest);
      await writeFile(path.join(specDir, 'qa-report.md'), reverseQa);
      const reverseManifestHash = hash(reverseManifest);
      reverse.shipRun.runId = `ship-run-${deliveryStatus}`;
      reverse.shipRun.status = deliveryStatus;
      reverse.shipRun.manifestHash = reverseManifestHash;
      reverse.tasks[0].status = deliveryStatus === 'blocked' ? 'blocked' : 'done';
      reverse.tasks[0].artifactHash = reverseManifestHash;
      reverse.deliveryStatus = deliveryStatus;
      reverse.qa.status = 'failed';
      reverse.qa.reportHash = hash(reverseQa);
      reverse.qa.summary = `The local QA gate was ${deliveryStatus}.`;
      const reverseMarker = markerFor(
        String(reverse.shipRun.runId),
        reverseManifestHash,
        'failed',
        {
          failureCount: deliveryStatus === 'blocked' ? 1 : 0,
        },
      );
      await writeFile(path.join(specDir, '.pipeline-shipped'), reverseMarker);
      reverse.artifacts = reverse.artifacts.map((artifact) =>
        artifact.path === '.run-manifest.jsonl'
          ? { ...artifact, hash: reverseManifestHash }
          : artifact.path === 'qa-report.md'
            ? { ...artifact, hash: hash(reverseQa) }
            : artifact.path === '.pipeline-shipped'
              ? { ...artifact, hash: hash(reverseMarker) }
              : artifact,
      );
      reverse.summary = `Delivery was ${deliveryStatus}; the governing Decision requires revisit.`;
      reverse.createdAt =
        deliveryStatus === 'blocked' ? '2026-08-12T10:04:00.000Z' : '2026-08-12T10:05:00.000Z';
      const reverseProvenance = runProvenance(
        'shipped',
        String(reverse.shipRun.runId),
        'delivery',
        {
          manifest_hash: reverseManifestHash,
          manifest_start_line: 1,
          manifest_end_line: 1,
          marker_hash: hash(reverseMarker),
        },
      );
      reverse.shipRun.provenanceEventId = reverseProvenance.event_id;
      reverse.shipRun.provenanceEventHash = sha256Jcs(reverseProvenance as never);
      await writeFile(
        provenancePath,
        `${await readFile(provenancePath, 'utf8')}${JSON.stringify(reverseProvenance)}\n`,
      );
      const missingMarker = structuredClone(reverse);
      missingMarker.artifacts = missingMarker.artifacts.filter(
        (artifact) => artifact.path !== '.pipeline-shipped',
      );
      expect(
        await lifecycle.client.dispatch({
          operation: 'operate.planning.ingest-delivery',
          request: missingMarker,
        }),
      ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
      const reverseIngested = await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: reverse,
      });
      if (!reverseIngested.ok) throw new Error(JSON.stringify(reverseIngested));
      expect(reverseIngested).toMatchObject({
        ok: true,
        data: {
          deliveryEvidence: { deliveryStatus, outcomeStatus: 'verification-required' },
          assignment: {
            assignmentKind: 'verification',
            roleId: 'operate-planning-decision-revisit',
            governedOperationId: null,
          },
        },
      });
      expect(JSON.stringify(reverseIngested)).not.toContain('operating-outcome');
    }

    await writeFile(path.join(specDir, '.run-manifest.jsonl'), manifest);
    await writeFile(path.join(specDir, 'qa-report.md'), qa);
    await writeFile(path.join(specDir, '.pipeline-shipped'), marker);
    for (const mutate of [
      (request: typeof evidenceRequest) => {
        request.shipRun.runId = 'invented-ship-run';
      },
      (request: typeof evidenceRequest) => {
        request.shipRun.runtime = 'foreign-runtime';
      },
      (request: typeof evidenceRequest) => {
        request.shipRun.packageVersion = '9.9.9';
      },
      (request: typeof evidenceRequest) => {
        request.shipRun.status = 'blocked';
      },
      (request: typeof evidenceRequest) => {
        request.tasks = [];
      },
      (request: typeof evidenceRequest) => {
        request.tasks.push(structuredClone(request.tasks[0]));
      },
      (request: typeof evidenceRequest) => {
        request.qa.status = 'failed';
      },
      (request: typeof evidenceRequest) => {
        request.classification = 'public';
        request.artifacts[0].classification = 'restricted';
      },
      (request: typeof evidenceRequest) => {
        request.artifacts.push({
          artifactId: 'qa-report-alias',
          path: './qa-report.md',
          hash: request.artifacts.find((artifact) => artifact.path === 'qa-report.md')?.hash ?? '',
          classification: 'internal',
        });
      },
    ]) {
      const hostile = structuredClone(evidenceRequest);
      mutate(hostile);
      expect(
        await lifecycle.client.dispatch({
          operation: 'operate.planning.ingest-delivery',
          request: hostile,
        }),
      ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    }
    await mkdir(path.join(specDir, 'evidence-real'));
    const linkedEvidence = 'Bound through a symbolic parent.\n';
    await writeFile(path.join(specDir, 'evidence-real', 'note.md'), linkedEvidence);
    await symlink('evidence-real', path.join(specDir, 'evidence-link'));
    const symbolicArtifact = structuredClone(evidenceRequest);
    symbolicArtifact.artifacts.push({
      artifactId: 'symbolic-parent-artifact',
      path: 'evidence-link/note.md',
      hash: hash(linkedEvidence),
      classification: 'internal',
    });
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: symbolicArtifact,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_PATH' } });

    const rollbackPlan = `${JSON.stringify({
      rollbackPlanId: 'rbp_delivery_001',
      originalShipRunId: 'ship-run-001',
      rollbackRunId: 'rollback-run-001',
      expectedTargetHash: hash('applied-target'),
      baselineHash: hash('baseline-target'),
    })}\n`;
    const rollbackResult = `${JSON.stringify({
      rollbackResultId: 'rbres_delivery_001',
      rollbackPlanId: 'rbp_delivery_001',
      originalShipRunId: 'ship-run-001',
      rollbackRunId: 'rollback-run-001',
      targetBeforeHash: hash('applied-target'),
      targetAfterHash: hash('baseline-target'),
      status: 'succeeded',
      completedAt: '2026-08-12T10:06:00.000Z',
    })}\n`;
    const rollbackResultHash = hash(rollbackResult);
    const rollbackProvenance = {
      schema_version: '1.0.0',
      event_id: 'event-rolled-back-rollback-run-001',
      timestamp: '2026-08-12T10:06:00.000Z',
      artifact_id: 'SPEC-001',
      artifact_path: path.relative(lifecycle.project.dir, String(receipt.specFile)),
      operation: 'rolled-back',
      producer: {
        product: 'planr-pipeline',
        version: '0.42.0',
        runtime: 'codex',
        phase: 'delivery',
      },
      run_id: 'rollback-run-001',
      correlation: operatingOrigin,
      rollback_evidence: {
        original_ship_run_id: 'ship-run-001',
        rollback_plan_artifact_id: 'rollback-plan-artifact',
        rollback_plan_hash: hash(rollbackPlan),
        rollback_result_artifact_id: 'rollback-result-artifact',
        rollback_result_hash: rollbackResultHash,
        rollback_receipt_artifact_id: 'rollback-receipt-artifact',
        target_before_hash: hash('applied-target'),
        target_after_hash: hash('baseline-target'),
        completed_at: '2026-08-12T10:06:00.000Z',
      },
    };
    const rollbackReceipt = `${JSON.stringify({
      rollbackReceiptId: 'rollback-receipt-001',
      rollbackPlanId: 'rbp_delivery_001',
      rollbackResultId: 'rbres_delivery_001',
      rollbackRunId: 'rollback-run-001',
      rollbackResultHash,
      rollbackProvenanceEventId: rollbackProvenance.event_id,
      provenanceEventHash: sha256Jcs(rollbackProvenance as never),
      status: 'succeeded',
    })}\n`;
    await writeFile(path.join(specDir, 'rollback-plan.json'), rollbackPlan);
    await writeFile(path.join(specDir, 'rollback-result.json'), rollbackResult);
    await writeFile(path.join(specDir, 'rollback-receipt.json'), rollbackReceipt);
    const rolledBack = structuredClone(evidenceRequest);
    rolledBack.deliveryStatus = 'rolled-back';
    rolledBack.summary = 'Certified delivery was rolled back; the Decision requires revisit.';
    rolledBack.createdAt = '2026-08-12T10:07:00.000Z';
    rolledBack.artifacts.push(
      {
        artifactId: 'rollback-plan-artifact',
        path: 'rollback-plan.json',
        hash: hash(rollbackPlan),
        classification: 'internal',
      },
      {
        artifactId: 'rollback-result-artifact',
        path: 'rollback-result.json',
        hash: rollbackResultHash,
        classification: 'internal',
      },
      {
        artifactId: 'rollback-receipt-artifact',
        path: 'rollback-receipt.json',
        hash: hash(rollbackReceipt),
        classification: 'internal',
      },
    );
    rolledBack.rollback = {
      rollbackPlanId: 'rbp_delivery_001',
      rollbackPlanArtifactId: 'rollback-plan-artifact',
      rollbackPlanHash: hash(rollbackPlan),
      rollbackResultId: 'rbres_delivery_001',
      rollbackResultArtifactId: 'rollback-result-artifact',
      rollbackResultHash,
      rollbackReceiptId: 'rollback-receipt-001',
      rollbackReceiptArtifactId: 'rollback-receipt-artifact',
      rollbackReceiptHash: hash(rollbackReceipt),
      rollbackProvenanceEventId: rollbackProvenance.event_id,
      originalShipRunId: 'ship-run-001',
      rollbackRunId: 'rollback-run-001',
      targetBeforeHash: hash('applied-target'),
      targetAfterHash: hash('baseline-target'),
      status: 'succeeded',
      completedAt: '2026-08-12T10:06:00.000Z',
    };
    const uncertifiedRollback = structuredClone(rolledBack);
    delete uncertifiedRollback.rollback;
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: uncertifiedRollback,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: rolledBack,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    const foreignRollbackProvenance = {
      ...rollbackProvenance,
      run_id: 'rollback-run-foreign',
    };
    const beforeRollbackProvenance = await readFile(provenancePath, 'utf8');
    await writeFile(
      provenancePath,
      `${await readFile(provenancePath, 'utf8')}${JSON.stringify(foreignRollbackProvenance)}\n`,
    );
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: rolledBack,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    const forkedRollbackProvenance = await readFile(provenancePath, 'utf8');
    await writeFile(
      provenancePath,
      `${JSON.stringify(rollbackProvenance)}\n${forkedRollbackProvenance}`,
    );
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: rolledBack,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    await writeFile(provenancePath, beforeRollbackProvenance);
    const pipeline = (await import('planr-pipeline')) as {
      appendProvenanceEvent: (projectRoot: string, event: RecordValue) => string;
    };
    pipeline.appendProvenanceEvent(lifecycle.project.dir, rollbackProvenance);
    const substitutedRollback = structuredClone(rolledBack);
    (substitutedRollback.rollback as RecordValue).targetAfterHash = hash('foreign-baseline');
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: substitutedRollback,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
    const rolledIngested = await lifecycle.client.dispatch({
      operation: 'operate.planning.ingest-delivery',
      request: rolledBack,
    });
    expect(rolledIngested).toMatchObject({
      ok: true,
      data: {
        deliveryEvidence: { deliveryStatus: 'rolled-back', outcomeStatus: 'verification-required' },
        assignment: { roleId: 'operate-planning-decision-revisit', governedOperationId: null },
      },
    });
    expect(JSON.stringify(rolledIngested)).not.toContain('operating-outcome');
    await appendFile(provenancePath, `${JSON.stringify(rollbackProvenance)}\n`);
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: rolledBack,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });

    const tampered = structuredClone(evidenceRequest);
    tampered.artifacts[0].hash =
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    expect(
      await lifecycle.client.dispatch({
        operation: 'operate.planning.ingest-delivery',
        request: tampered,
      }),
    ).toMatchObject({ ok: false, error: { code: 'E_OPERATE_PLANNING_CUSTODY' } });
  }, 90_000);
});

describe('Operate Planning SPEC/origin/provenance transaction', () => {
  it('serializes every caller-derived frontmatter scalar without YAML injection', async () => {
    const project = await createTestProject('origin-yaml-safe');
    projects.push(project);
    const titles = [
      'Canonical title"\nslug: "foreign-workflow',
      'Line one\nline two',
      'Quoted "title" and apostrophe\'s edge',
      'Colon: value # not a comment',
      'Unicode — ölçüm 🚀',
    ];
    for (const [index, title] of titles.entries()) {
      const draft = await prepareOperatingSpecDraft(project.dir, project.config, {
        title,
        slug: `safe-title-${index}`,
        actorId: `owner:"yaml-${index}#`,
        framing: {
          problem: 'A bounded problem.',
          objective: 'A bounded objective.',
          users: ['Owner'],
          scope: ['One safe change'],
          nonScope: [],
          risks: [],
          constraints: [],
          requirements: ['Preserve exact YAML identity.'],
          acceptanceOutcomes: ['The SPEC parses canonically.'],
        },
        operatingOrigin: operatingOriginFixture(),
        createdAt: '2026-08-11T08:01:00Z',
      });
      const parsed = parseMarkdown(draft.content);
      expect(parsed.data.title).toBe(title);
      expect(parsed.data.po).toBe(`owner:"yaml-${index}#`);
      expect(parsed.data.slug).toBe(`safe-title-${index}`);
      expect(Object.keys(parsed.data).sort()).toEqual(
        [
          'created',
          'id',
          'po',
          'priority',
          'schemaVersion',
          'slug',
          'status',
          'tech_dependencies',
          'title',
          'ui_files',
          'updated',
        ].sort(),
      );
    }
  });

  it('reconciles lost acknowledgement and serializes concurrent exact retries without duplicate custody', async () => {
    const project = await createTestProject('origin-reconcile');
    projects.push(project);
    const proposal = await approvedFixtureProposal();
    const actor = {
      actorId: String((proposal.actor as RecordValue).actorId),
      kind: 'human' as const,
    };
    await expect(
      createSpecFromOperatingProposal({
        projectDir: project.dir,
        config: project.config,
        proposal,
        actor,
        hooks: {
          afterSpecPublish: () => {
            throw new Error('simulated lost acknowledgement');
          },
        },
      }),
    ).rejects.toThrow('simulated lost acknowledgement');
    const recovered = await createSpecFromOperatingProposal({
      projectDir: project.dir,
      config: project.config,
      proposal,
      actor,
    });
    const [left, right] = await Promise.all([
      createSpecFromOperatingProposal({
        projectDir: project.dir,
        config: project.config,
        proposal,
        actor,
      }),
      createSpecFromOperatingProposal({
        projectDir: project.dir,
        config: project.config,
        proposal,
        actor,
      }),
    ]);
    expect(left).toEqual(right);
    expect(left.receiptHash).toBe(recovered.receiptHash);
    expect(left.replayed).toBe(true);
    const provenance = (await readFile(path.join(project.dir, '.planr/provenance.jsonl'), 'utf8'))
      .trim()
      .split('\n');
    expect(provenance).toHaveLength(1);
    expect(JSON.parse(provenance[0])).toMatchObject({
      event_id: recovered.provenanceEventId,
      artifact_id: recovered.specId,
      correlation: { proposal_id: proposal.proposalId, receipt_hash: recovered.receiptHash },
    });
  });

  it('fsyncs provenance and repairs only the exact partial terminal record on restart', async () => {
    const proposal = await approvedFixtureProposal();
    const actor = {
      actorId: String((proposal.actor as RecordValue).actorId),
      kind: 'human' as const,
    };
    for (const crashAt of ['before-write', 'partial-terminal', 'after-sync'] as const) {
      const project = await createTestProject(`origin-crash-${crashAt}`);
      projects.push(project);
      const provenancePath = path.join(project.dir, '.planr', 'provenance.jsonl');
      let priorBytes = '';
      if (crashAt === 'partial-terminal') {
        await appendOpenPlanrProvenance({
          projectDir: project.dir,
          artifactId: 'SPEC-900',
          artifactPath: path.join(project.dir, '.planr/specs/SPEC-900-prior/SPEC-900-prior.md'),
          operation: 'updated',
          productVersion: '0.0.1',
          eventId: 'prior-custody-event',
          timestamp: '2026-08-10T08:00:00Z',
          runId: 'prior-custody-run',
        });
        priorBytes = await readFile(provenancePath, 'utf8');
      }
      const crash = () => {
        throw new Error(`simulated provenance crash ${crashAt}`);
      };
      await expect(
        createSpecFromOperatingProposal({
          projectDir: project.dir,
          config: project.config,
          proposal,
          actor,
          hooks:
            crashAt === 'before-write'
              ? { beforeProvenanceWrite: crash }
              : crashAt === 'partial-terminal'
                ? { afterProvenancePartialWrite: crash }
                : { afterProvenanceSyncBeforeReturn: crash },
        }),
      ).rejects.toMatchObject({ name: 'E_PROVENANCE_WRITE' });
      const crashedBytes = await readFile(provenancePath, 'utf8');
      expect(crashedBytes.startsWith(priorBytes)).toBe(true);
      if (crashAt === 'before-write') expect(crashedBytes).toBe(priorBytes);
      if (crashAt === 'partial-terminal') expect(crashedBytes.endsWith('\n')).toBe(false);
      if (crashAt === 'after-sync') expect(crashedBytes.endsWith('\n')).toBe(true);

      const recovered = await createSpecFromOperatingProposal({
        projectDir: project.dir,
        config: project.config,
        proposal,
        actor,
      });
      expect(recovered.replayed).toBe(true);
      const recoveredBytes = await readFile(provenancePath, 'utf8');
      expect(recoveredBytes.startsWith(priorBytes)).toBe(true);
      const records = recoveredBytes
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as RecordValue);
      expect(
        records.filter((record) => record.event_id === recovered.provenanceEventId),
      ).toHaveLength(1);
      const replayed = await createSpecFromOperatingProposal({
        projectDir: project.dir,
        config: project.config,
        proposal,
        actor,
      });
      expect(replayed.receiptHash).toBe(recovered.receiptHash);
      expect(await readFile(provenancePath, 'utf8')).toBe(recoveredBytes);
    }
  });

  it('fails closed without rewriting malformed interior or divergent duplicate provenance', async () => {
    const proposal = await approvedFixtureProposal();
    const actor = {
      actorId: String((proposal.actor as RecordValue).actorId),
      kind: 'human' as const,
    };
    const malformedProject = await createTestProject('origin-malformed-interior');
    projects.push(malformedProject);
    await expect(
      createSpecFromOperatingProposal({
        projectDir: malformedProject.dir,
        config: malformedProject.config,
        proposal,
        actor,
        hooks: { beforeProvenanceWrite: () => Promise.reject(new Error('before write')) },
      }),
    ).rejects.toMatchObject({ name: 'E_PROVENANCE_WRITE' });
    const malformedPath = path.join(malformedProject.dir, '.planr', 'provenance.jsonl');
    const prior = createOpenPlanrProvenanceEvent({
      projectDir: malformedProject.dir,
      artifactId: 'SPEC-900',
      artifactPath: path.join(
        malformedProject.dir,
        '.planr/specs/SPEC-900-prior/SPEC-900-prior.md',
      ),
      operation: 'updated',
      productVersion: '0.0.1',
      eventId: 'prior-valid-event',
      timestamp: '2026-08-10T08:00:00Z',
      runId: 'prior-valid-run',
    });
    const later = { ...prior, event_id: 'later-valid-event', run_id: 'later-valid-run' };
    const malformedBytes = `${JSON.stringify(prior)}\n{not-json}\n${JSON.stringify(later)}\n`;
    await writeFile(malformedPath, malformedBytes);
    await expect(
      createSpecFromOperatingProposal({
        projectDir: malformedProject.dir,
        config: malformedProject.config,
        proposal,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'E_PROVENANCE_CONFLICT' });
    expect(await readFile(malformedPath, 'utf8')).toBe(malformedBytes);

    const schemaInvalid = {
      ...prior,
      event_id: 'schema-invalid-interior',
      run_id: 'schema-invalid-run',
      producer: {},
    };
    const schemaInvalidBytes = `${JSON.stringify(prior)}\n${JSON.stringify(schemaInvalid)}\n${JSON.stringify(later)}\n`;
    await writeFile(malformedPath, schemaInvalidBytes);
    await expect(
      createSpecFromOperatingProposal({
        projectDir: malformedProject.dir,
        config: malformedProject.config,
        proposal,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'E_PROVENANCE_CONFLICT' });
    expect(await readFile(malformedPath, 'utf8')).toBe(schemaInvalidBytes);

    const duplicateProject = await createTestProject('origin-divergent-duplicate');
    projects.push(duplicateProject);
    const created = await createSpecFromOperatingProposal({
      projectDir: duplicateProject.dir,
      config: duplicateProject.config,
      proposal,
      actor,
    });
    const duplicatePath = path.join(duplicateProject.dir, '.planr', 'provenance.jsonl');
    const validBytes = await readFile(duplicatePath, 'utf8');
    const validEvent = JSON.parse(validBytes.trim()) as RecordValue;
    const divergentEvent = { ...validEvent, operation: 'updated' };
    const divergentBytes = `${validBytes}${JSON.stringify(divergentEvent)}\n`;
    await writeFile(duplicatePath, divergentBytes);
    await expect(
      createSpecFromOperatingProposal({
        projectDir: duplicateProject.dir,
        config: duplicateProject.config,
        proposal,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'E_PROVENANCE_CONFLICT' });
    expect(await readFile(duplicatePath, 'utf8')).toBe(divergentBytes);
    expect(validEvent.event_id).toBe(created.provenanceEventId);
  });

  it('rejects directory, frontmatter, content, and symlink origin substitution', async () => {
    const project = await createTestProject('origin-hardening');
    projects.push(project);
    const proposal = await approvedFixtureProposal();
    const receipt = await createSpecFromOperatingProposal({
      projectDir: project.dir,
      config: project.config,
      proposal,
      actor: {
        actorId: String((proposal.actor as RecordValue).actorId),
        kind: 'human',
      },
    });
    const original = await readFile(receipt.specFile, 'utf8');
    await writeFile(receipt.specFile, original.replace('slug:', 'slug: "substituted"\nignored:'));
    await expect(readSpecOperatingOrigin(receipt.specDir)).rejects.toMatchObject({
      code: 'E_OPERATE_ORIGIN_INVALID',
    });
    await writeFile(receipt.specFile, original);
    const prefixCollision = `${receipt.specDir}-evil`;
    await rename(receipt.specDir, prefixCollision);
    await expect(readSpecOperatingOrigin(prefixCollision)).rejects.toMatchObject({
      code: 'E_OPERATE_ORIGIN_INVALID',
    });
    await rename(prefixCollision, receipt.specDir);
    const originBody = await readFile(receipt.originPath, 'utf8');
    await rename(receipt.originPath, `${receipt.originPath}.real`);
    await symlink(`${receipt.originPath}.real`, receipt.originPath);
    await expect(readSpecOperatingOrigin(receipt.specDir)).rejects.toMatchObject({
      code: 'E_OPERATE_ORIGIN_INVALID',
    });
    expect(originBody).not.toContain('sourceArtifactValue');
  });
});
