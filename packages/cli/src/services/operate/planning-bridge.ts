import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertOperatingPlanningProposalV1,
  buildOperatingPlanningProposalV1,
  confirmOperatingPlanningProposalV1,
  createOperatingDeliveryRouteV1,
} from 'planr-pipeline/operate/planning-bridge-v2';
import { deriveOperatingIntelligenceAssignmentIdV2 } from 'planr-pipeline/operate/scheduler-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { loadConfig } from '../config-service.js';
import { assertPlanningFraming } from './planning-handoff-service.js';
import { createSpecFromOperatingProposal } from './spec-operating-origin-service.js';
import type { OperateStoredRuntime } from './store.js';

type JsonRecord = Record<string, unknown>;

const PROPOSAL_ID = /^oprop_[a-f0-9]{32}$/u;
const PROPOSAL_DIRECTORY = 'planning-bridge/proposals';

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function state(runtime: OperateStoredRuntime): JsonRecord {
  return runtime.state;
}

function list(record: JsonRecord, field: string): JsonRecord[] {
  const value = record[field];
  return Array.isArray(value) ? (value as JsonRecord[]) : [];
}

function exactBy(
  records: JsonRecord[],
  field: string,
  identity: string,
  subject: string,
): JsonRecord {
  const matches = records.filter((record) => record[field] === identity);
  if (matches.length !== 1)
    fail(
      'E_OPERATE_PLANNING_BINDING',
      `${subject} is missing or ambiguous in the current operating scope.`,
    );
  return matches[0];
}

function canonicalArtifactValue(runtime: OperateStoredRuntime, artifactId: string): JsonRecord {
  const artifact = exactBy(
    list(state(runtime), 'artifacts'),
    'artifactId',
    artifactId,
    'Accepted Artifact',
  );
  const bytes = runtime.artifacts.get(artifactId);
  if (!bytes || artifact.mediaType !== 'application/json' || artifact.encoding !== 'utf-8') {
    fail('E_OPERATE_PLANNING_CUSTODY', 'An accepted role Artifact lacks canonical JSON custody.');
  }
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as JsonRecord;
    if (!value || Array.isArray(value) || sha256Jcs(value as never) !== artifact.canonicalHash) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'An accepted role Artifact body does not match its canonical hash.',
      );
    }
    return value;
  } catch (cause) {
    if ((cause as { code?: unknown })?.code === 'E_OPERATE_PLANNING_CUSTODY') throw cause;
    fail('E_OPERATE_PLANNING_CUSTODY', 'An accepted role Artifact is not valid canonical JSON.');
  }
}

function proposalPath(runtimeRoot: string, proposalId: string): string {
  if (!PROPOSAL_ID.test(proposalId))
    fail('E_OPERATE_PLANNING_INVALID', 'The Planning proposal identity is invalid.');
  return path.join(runtimeRoot, PROPOSAL_DIRECTORY, `${proposalId}.json`);
}

function approvedProposalPath(runtimeRoot: string, proposalId: string): string {
  return proposalPath(runtimeRoot, proposalId).replace(/\.json$/u, '.approved.json');
}

async function persistApprovedProposal(
  runtimeRoot: string,
  proposalId: string,
  proposal: JsonRecord,
  confirmDigest: string,
): Promise<JsonRecord> {
  const target = approvedProposalPath(runtimeRoot, proposalId);
  try {
    await writeFile(target, `${JSON.stringify(proposal, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return proposal;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    const existing = JSON.parse(await readFile(target, 'utf8')) as JsonRecord;
    assertOperatingPlanningProposalV1(existing as never);
    const confirmation = existing.confirmation as JsonRecord;
    if (
      existing.state !== 'approved' ||
      existing.predecessorProposalHash !== proposal.predecessorProposalHash ||
      confirmation.previewDigest !== confirmDigest
    ) {
      fail(
        'E_OPERATE_PLANNING_CONFLICT',
        'The Planning confirmation is already bound to different reviewed custody.',
      );
    }
    return existing;
  }
}

async function persistProposal(runtimeRoot: string, proposal: JsonRecord): Promise<JsonRecord> {
  const target = proposalPath(runtimeRoot, String(proposal.proposalId));
  const existing = await readFile(target, 'utf8').catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  });
  if (existing !== null) {
    const parsed = JSON.parse(existing) as JsonRecord;
    assertOperatingPlanningProposalV1(parsed as never);
    const stableProjection = (value: JsonRecord) => ({
      proposalId: value.proposalId,
      correlationId: value.correlationId,
      scopeId: value.scopeId,
      domainId: value.domainId,
      domainVersion: value.domainVersion,
      cycleId: value.cycleId,
      eventHead: value.eventHead,
      decision: value.decision,
      action: value.action,
      deliveryRoute: value.deliveryRoute,
      acceptedPerspectiveSummaries: value.acceptedPerspectiveSummaries,
      evidence: value.evidence,
      omissions: value.omissions,
      framing: value.framing,
      metric: value.metric,
      verification: value.verification,
      actor: value.actor,
    });
    if (
      sha256Jcs(stableProjection(parsed) as never) !==
      sha256Jcs(stableProjection(proposal) as never)
    ) {
      fail(
        'E_OPERATE_PLANNING_CONFLICT',
        'The deterministic proposal identity is already bound to a different reviewed projection.',
      );
    }
    return parsed;
  }
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, `${JSON.stringify(proposal, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    return await persistProposal(runtimeRoot, proposal);
  }
  return proposal;
}

function proposalFraming(decision: JsonRecord, action: JsonRecord): JsonRecord {
  const title = String(action.title);
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  if (!slug)
    fail(
      'E_OPERATE_PLANNING_INVALID',
      'The accepted Action title cannot produce a canonical SPEC slug.',
    );
  const dissent = Array.isArray(decision.dissent) ? (decision.dissent as string[]) : [];
  const reopen = Array.isArray(decision.reopenConditions)
    ? (decision.reopenConditions as string[])
    : [];
  const revisit = Array.isArray(decision.revisitConditions)
    ? (decision.revisitConditions as string[])
    : [];
  return {
    title,
    slug,
    problem: `${String(decision.question)} ${String(decision.outcome)}`,
    objective: String(action.expectedResult),
    users: ['Operators accountable for the accepted Action'],
    scope: [title, String(action.expectedResult)],
    nonScope: ['Automatic decomposition, PLAN, SHIP, deployment, and external effects'],
    risks: [String(decision.expectedDownside), ...dissent].filter((value) => value.length > 0),
    constraints: [...new Set([...reopen, ...revisit])].sort(),
    requirements: [`Implement ${title} as explicit reviewed Planning work.`],
    acceptanceOutcomes: [
      `Delivery evidence remains bound to metric ${String(action.metricId)} and verification plan ${String(action.verificationPlanId)}.`,
      String(action.expectedResult),
    ],
  };
}

export async function previewOperatingPlanningSpec(input: {
  projectDir: string;
  runtimeRoot: string;
  runtime: OperateStoredRuntime;
  actionId: string;
  actor: { actorId: string; kind: 'human' };
  framing?: JsonRecord;
  now?: string;
}): Promise<JsonRecord> {
  const snapshot = state(input.runtime);
  const action = exactBy(list(snapshot, 'actions'), 'actionId', input.actionId, 'Action');
  if (action.state !== 'approved')
    fail('E_OPERATE_PLANNING_STATE', 'Only a current approved Action can enter Planning work.');
  const cycleId = String(action.sourceCycleId);
  if (input.runtime.preferences.cycleDeliveryRoutes[cycleId] !== 'planning-work') {
    fail(
      'E_OPERATE_PLANNING_ROUTE',
      'Only the planning-work delivery route can preview or create a SPEC.',
    );
  }
  const decision = exactBy(
    list(snapshot, 'decisions'),
    'decisionId',
    String(action.sourceDecisionId),
    'Decision',
  );
  if (decision.state !== 'approved' || decision.sourceCycleId !== cycleId) {
    fail(
      'E_OPERATE_PLANNING_BINDING',
      'The Planning Action does not bind one current approved Decision.',
    );
  }
  const cycle = exactBy(list(snapshot, 'cycles'), 'cycleId', cycleId, 'Cycle');
  const actorId = input.actor?.actorId ?? '';
  if (input.actor?.kind !== 'human' || actorId.length === 0 || actorId !== action.ownerActorId) {
    fail(
      'E_OPERATE_PLANNING_ACCESS',
      'Planning preview requires the exact current human Action owner.',
    );
  }
  const membership = input.runtime.preferences.actorMemberships[actorId];
  if (
    membership?.role !== 'owner' ||
    membership.scopeId !== cycle.scopeId ||
    membership.domainId !== cycle.domainId ||
    membership.domainVersion !== cycle.domainVersion
  ) {
    fail(
      'E_OPERATE_PLANNING_ACCESS',
      'The Planning Action owner lacks the exact current scope membership.',
    );
  }
  const planId = input.runtime.preferences.cycleIntelligencePlanIds[cycleId];
  if (!planId)
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted operating board lacks its intelligence plan identity.',
    );
  const intelligencePlan = exactBy(
    list(snapshot, 'intelligencePlans'),
    'planId',
    planId,
    'Intelligence plan',
  );
  const selectedRoles = Array.isArray(intelligencePlan.selectedRoles)
    ? (intelligencePlan.selectedRoles as JsonRecord[])
    : [];
  const acceptedAssignments = selectedRoles.map((selectedRole) => {
    const roleId = String(selectedRole.roleId);
    const roleVersion = String(selectedRole.roleVersion);
    const assignmentId = deriveOperatingIntelligenceAssignmentIdV2(planId, roleId, roleVersion);
    const assignment = exactBy(
      list(snapshot, 'assignments'),
      'assignmentId',
      assignmentId,
      'Selected role Assignment',
    );
    const outputContract = assignment.outputContract as JsonRecord;
    const selectedContract = selectedRole.outputContract as JsonRecord;
    if (
      assignment.cycleId !== cycleId ||
      assignment.state !== 'validated' ||
      assignment.roleId !== roleId ||
      outputContract.schemaId !== selectedContract.schemaId ||
      outputContract.schemaVersion !== selectedContract.schemaVersion
    ) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'A selected intelligence role lost its exact Assignment and output-contract binding.',
      );
    }
    return assignment;
  });
  if (
    acceptedAssignments.filter((assignment) => assignment.assignmentKind === 'advisor').length ===
      0 ||
    acceptedAssignments.filter((assignment) => assignment.assignmentKind === 'challenger')
      .length !== 1 ||
    acceptedAssignments.filter((assignment) => assignment.assignmentKind === 'chair').length !== 1
  ) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted operating board is incomplete or ambiguous.');
  }
  const acceptedOutputs = acceptedAssignments.map((assignment) => {
    const assignmentId = String(assignment.assignmentId);
    const roleKind = String(assignment.assignmentKind) as 'advisor' | 'challenger' | 'chair';
    const acceptedSubmissions = list(snapshot, 'submissions').filter(
      (submission) => submission.assignmentId === assignmentId && submission.state === 'accepted',
    );
    if (acceptedSubmissions.length !== 1) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'A role Assignment does not have one exact accepted Submission.',
      );
    }
    const artifacts = list(snapshot, 'artifacts').filter(
      (artifact) =>
        artifact.assignmentId === assignmentId &&
        artifact.artifactId === acceptedSubmissions[0].artifactId,
    );
    if (artifacts.length !== 1)
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'A role Assignment does not have one exact accepted Artifact.',
      );
    const artifact = artifacts[0];
    const outputContract = assignment.outputContract as JsonRecord;
    if (
      artifact.schemaId !== outputContract.schemaId ||
      artifact.artifactSchemaVersion !== outputContract.schemaVersion ||
      artifact.mediaType !== outputContract.mediaType ||
      artifact.encoding !== outputContract.encoding
    ) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'A selected role Artifact does not equal its exact Assignment output contract.',
      );
    }
    const sourceArtifactValue = canonicalArtifactValue(input.runtime, String(artifact.artifactId));
    const intelligenceContext = assignment.intelligenceContext as JsonRecord;
    const inputBundle = intelligenceContext?.inputBundle as JsonRecord | undefined;
    const bundleArtifactId = inputBundle?.bundleArtifactId;
    if (typeof bundleArtifactId !== 'string' || bundleArtifactId.length === 0) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'A selected role Assignment lacks its exact intelligence input-bundle custody.',
      );
    }
    const inputBundleValue = canonicalArtifactValue(input.runtime, bundleArtifactId);
    return {
      assignmentId,
      artifactId: String(artifact.artifactId),
      roleId: String(assignment.roleId),
      roleKind,
      sourceArtifactValue,
      inputBundleValue,
    };
  });
  const scope = {
    scopeId: String(cycle.scopeId),
    domainId: String(cycle.domainId),
    domainVersion: String(cycle.domainVersion),
  };
  const createdAt = input.now ?? new Date().toISOString();
  const verificationPlanId = String(action.verificationPlanId);
  const verificationPlanEvents = input.runtime.events.filter(
    (event) => event.type === 'verification.plan-recorded' && event.entityId === verificationPlanId,
  );
  if (verificationPlanEvents.length !== 1) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The Action verification plan lacks one exact canonical source Event.',
    );
  }
  const route = createOperatingDeliveryRouteV1({
    state: snapshot as never,
    action: action as never,
    route: 'planning-work',
    rationale: 'The accepted Action requires reviewed repository Planning work.',
    createdAt: String(snapshot.generatedAt),
  }) as unknown as JsonRecord;
  const resolvedFraming = input.framing
    ? assertPlanningFraming(input.framing)
    : proposalFraming(decision, action);
  const proposal = buildOperatingPlanningProposalV1(snapshot as never, {
    scope,
    decision: {
      decisionId: String(decision.decisionId),
      revision: Number(decision.revision),
      decisionHash: sha256Jcs(decision as never),
    },
    action: {
      actionId: String(action.actionId),
      revision: Number(action.revision),
      actionHash: String(action.actionHash),
    },
    deliveryRoute: route as never,
    acceptedOutputs: acceptedOutputs as never,
    sourceVerificationPlanEvent: verificationPlanEvents[0] as never,
    omissions: [],
    framing: resolvedFraming as never,
    actor: { actorId, kind: 'human', accessLevel: 'internal' },
    createdAt,
    previewExpiresAt: new Date(Date.parse(createdAt) + 10 * 60_000).toISOString(),
  }) as unknown as JsonRecord;
  return await persistProposal(input.runtimeRoot, proposal);
}

export async function createSpecForOperatingPlanning(input: {
  projectDir: string;
  runtimeRoot: string;
  runtime: OperateStoredRuntime;
  proposalId: string;
  confirmDigest: string;
  actor: { actorId: string; kind: 'human' };
  now?: string;
}): Promise<JsonRecord> {
  const stored = JSON.parse(
    await readFile(proposalPath(input.runtimeRoot, input.proposalId), 'utf8'),
  ) as JsonRecord;
  assertOperatingPlanningProposalV1(stored as never);
  if (
    input.actor?.kind !== 'human' ||
    !input.actor.actorId ||
    input.actor.actorId !== (stored.actor as JsonRecord).actorId
  ) {
    fail(
      'E_OPERATE_PLANNING_ACCESS',
      'Planning confirmation requires the exact human actor bound by the preview.',
    );
  }
  const head = state(input.runtime).eventHead as JsonRecord;
  const reviewedHead = stored.eventHead as JsonRecord;
  if (head.sequence !== reviewedHead.sequence || head.hash !== reviewedHead.hash) {
    fail(
      'E_OPERATE_PLANNING_STALE',
      'The operating Event head changed after this Planning preview.',
    );
  }
  const existingApproved = await readFile(
    approvedProposalPath(input.runtimeRoot, input.proposalId),
    'utf8',
  )
    .then((value) => JSON.parse(value) as JsonRecord)
    .catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return null;
      throw cause;
    });
  const approved =
    existingApproved ??
    (await persistApprovedProposal(
      input.runtimeRoot,
      input.proposalId,
      confirmOperatingPlanningProposalV1(stored as never, {
        actorId: input.actor.actorId,
        proposalRevision: 1,
        proposalHash: String(stored.proposalHash),
        eventHead: stored.eventHead as never,
        previewDigest: input.confirmDigest,
        confirmedAt: input.now ?? new Date().toISOString(),
      }) as unknown as JsonRecord,
      input.confirmDigest,
    ));
  assertOperatingPlanningProposalV1(approved as never);
  const confirmation = approved.confirmation as JsonRecord;
  if (
    approved.state !== 'approved' ||
    approved.predecessorProposalHash !== stored.proposalHash ||
    confirmation.previewDigest !== input.confirmDigest
  ) {
    fail(
      'E_OPERATE_PLANNING_CONFLICT',
      'The Planning confirmation does not match the reviewed proposal and digest.',
    );
  }
  const config = await loadConfig(input.projectDir);
  return (await createSpecFromOperatingProposal({
    projectDir: input.projectDir,
    config,
    proposal: approved,
    actor: input.actor,
  })) as unknown as JsonRecord;
}
