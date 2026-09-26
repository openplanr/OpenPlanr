import { createHash } from 'node:crypto';

import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertOperatingValidatedDependencyProofV2,
  deriveOperatingIntelligenceAssignmentIdV2,
} from './scheduler-v2.mjs';
import { readOperatingArtifactRawBytesV2 } from './evidence-materialization-v2.mjs';
import { decodeOperatingIntelligenceArtifactBodyV2 } from './intelligence-ledger-v2.mjs';
import { validateOperatingIntelligenceResultV2 } from './intelligence-result-validator-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const INTELLIGENCE_RESULT_KIND_BY_OUTPUT_SCHEMA = Object.freeze({
  'operating-advisor-result': 'operating-advisor-result',
  'operating-challenger-review': 'operating-challenger-review',
  'operating-decision-ledger': 'operating-decision-ledger',
});

const clone = (value) => structuredClone(value);

function exactStringArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && sha256Jcs(left) === sha256Jcs(right);
}

/**
 * Private Assignment authority and result-contract service. The runtime facade
 * supplies its stable error constructor; this module owns request decoding,
 * exact claimant comparison, and advertised-output validation.
 */
export function createOperatingAssignmentContractServiceV2({ runtimeError }) {
  if (typeof runtimeError !== 'function') {
    throw new TypeError('runtimeError must be a function.');
  }

  function validateSubmitRequestShape(request) {
    try {
      assertProtocolArtifact(
        'operate-tool-call',
        {
          kind: 'operate-tool-call',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          direction: 'request',
          operation: 'operate.assignment.submit',
          request: clone(request),
        },
        { protocolVersion: PROTOCOL_VERSION },
      );
      return true;
    } catch {
      return false;
    }
  }

  function decodedBase64Size(contentBase64) {
    const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0;
    return (contentBase64.length / 4) * 3 - padding;
  }

  function rawHashForBytes(bytes) {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  }

  function decodeSubmissionBytes(request) {
    if (!validateSubmitRequestShape(request)) {
      throw runtimeError('RESULT_CONTRACT_INVALID', 'The submission request is malformed.');
    }
    return Buffer.from(request.contentBase64, 'base64');
  }

  function parseSubmissionJson(bytes) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw runtimeError(
          'RESULT_CONTRACT_INVALID',
          'Intelligence submission must be a JSON object.',
        );
      }
      return parsed;
    } catch (error) {
      if (error?.code) throw error;
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'The submission is not valid UTF-8 JSON for its declared contract.',
      );
    }
  }

  function assertIntelligenceAssignmentSubmissionBody(assignment, parsed) {
    const expectedKind =
      INTELLIGENCE_RESULT_KIND_BY_OUTPUT_SCHEMA[assignment.outputContract?.schemaId];
    if (!expectedKind) return;
    if (Object.keys(parsed).length === 0) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Intelligence submission cannot be an empty object.',
      );
    }
    if (
      parsed.kind !== expectedKind ||
      parsed.schemaVersion !== '1.0.0' ||
      parsed.protocolVersion !== PROTOCOL_VERSION
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Intelligence submission must declare the exact result envelope for its Assignment contract.',
        {
          assignmentId: assignment.assignmentId,
          assignmentKind: assignment.assignmentKind,
          schemaId: assignment.outputContract.schemaId,
        },
      );
    }
  }

  function assertAdvertisedJsonOutputContract(assignment, parsed) {
    if (assignment.outputContract.schemaVersion !== PROTOCOL_VERSION) return;
    try {
      assertProtocolArtifact(assignment.outputContract.schemaId, parsed, {
        protocolVersion: PROTOCOL_VERSION,
      });
    } catch (cause) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Submission does not satisfy its advertised output schema.',
        {
          assignmentId: assignment.assignmentId,
          schemaId: assignment.outputContract.schemaId,
          cause: cause?.code ?? null,
        },
      );
    }
  }

  function intelligencePlanForAssignment(index, assignment) {
    const matches = [...index.intelligencePlans.values()].filter((plan) =>
      plan.selectedRoles.some(
        ({ roleId, roleVersion }) =>
          deriveOperatingIntelligenceAssignmentIdV2(plan.planId, roleId, roleVersion) ===
          assignment.assignmentId,
      ),
    );
    if (matches.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Intelligence submission requires one exact persisted plan.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    return matches[0];
  }

  function validatedRoleArtifactIds(index, plan, roleKind) {
    return plan.selectedRoles
      .filter((role) => role.roleKind === roleKind)
      .map((role) =>
        index.assignments.get(
          deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion),
        ),
      )
      .filter((candidate) => candidate?.state === 'validated')
      .map(
        (candidate) =>
          [...index.artifacts.values()].find(
            ({ assignmentId }) => assignmentId === candidate.assignmentId,
          )?.artifactId,
      )
      .filter(Boolean);
  }

  function trustedAcceptedRoleOutput(index, artifactId, artifactStore, expectedSchemaId) {
    const artifact = index.artifacts.get(artifactId);
    const assignment = artifact ? index.assignments.get(artifact.assignmentId) : null;
    const submission = artifact
      ? [...index.submissions.values()].find(
          (candidate) =>
            candidate.assignmentId === artifact.assignmentId &&
            candidate.artifactId === artifact.artifactId &&
            candidate.state === 'accepted',
        )
      : null;
    const replay = submission ? index.replay.get(submission.submissionId) : null;
    if (
      !artifact ||
      !assignment ||
      assignment.state !== 'validated' ||
      artifact.schemaId !== expectedSchemaId ||
      artifact.artifactSchemaVersion !== PROTOCOL_VERSION
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Intelligence submission predecessor custody is incomplete.',
        {
          artifactId,
        },
      );
    }
    try {
      assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay });
      const output = decodeOperatingIntelligenceArtifactBodyV2({
        artifact,
        rawBytes: readOperatingArtifactRawBytesV2(artifactStore, {
          artifactId: artifact.artifactId,
          rawHash: artifact.rawHash,
        }),
        subject: 'Intelligence predecessor result',
      });
      assertProtocolArtifact(expectedSchemaId, output, { protocolVersion: PROTOCOL_VERSION });
      return { artifact, assignment, output };
    } catch (cause) {
      throw runtimeError(
        cause?.code ?? 'RESULT_CONTRACT_INVALID',
        cause?.message ?? 'Intelligence predecessor bytes are invalid.',
        {
          artifactId,
        },
      );
    }
  }

  function validateIntelligenceSemanticReferences(
    parsed,
    assignment,
    index,
    { artifactStore } = {},
  ) {
    const enforcedOutputSchemaIds = new Set([
      'operating-advisor-result',
      'operating-challenger-review',
      'operating-decision-ledger',
    ]);
    if (!enforcedOutputSchemaIds.has(assignment.outputContract.schemaId)) return;
    const plan = intelligencePlanForAssignment(index, assignment);
    const snapshot = index.operatingSnapshots.get(plan.snapshotId);
    const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
    const cycle = index.cycles.get(assignment.cycleId);
    const context = assignment.intelligenceContext;
    const bundleArtifact = index.artifacts.get(context?.inputBundle?.bundleArtifactId);
    if (
      !snapshot ||
      !operatingState ||
      !cycle ||
      !context ||
      !bundleArtifact ||
      context.intelligencePlanId !== plan.planId ||
      context.snapshotId !== plan.snapshotId ||
      context.scopeId !== cycle.scopeId ||
      context.domainId !== cycle.domainId ||
      context.domainVersion !== cycle.domainVersion ||
      context.sourceArtifactId !== plan.sourceArtifactId ||
      context.decisionOwnerActorId !== plan.decisionOwnerActorId ||
      !exactStringArray(context.sourceArtifactIds, [...snapshot.sourceArtifactIds].sort()) ||
      !exactStringArray(context.evidenceRefIds, [...snapshot.evidenceRefIds].sort()) ||
      !assignment.inputArtifactIds.includes(bundleArtifact.artifactId) ||
      bundleArtifact.rawHash !== context.inputBundle.bundleRawHash ||
      bundleArtifact.canonicalHash !== context.inputBundle.bundleCanonicalHash
    ) {
      throw runtimeError(
        'OPERATING_SCOPE_INVALID',
        'Intelligence result lost its exact plan, bundle, snapshot, Cycle, or scope custody.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    const inputBundle = trustedAcceptedRoleOutput(
      index,
      bundleArtifact.artifactId,
      artifactStore,
      'operating-intelligence-input-bundle',
    ).output;
    const expectedBundleInputs = [
      ...new Set([
        ...inputBundle.sourceArtifactIds,
        ...inputBundle.assignmentBinding.issuedEvidence.map(
          ({ evidenceArtifactId }) => evidenceArtifactId,
        ),
      ]),
    ].sort();
    if (!exactStringArray(bundleArtifact.inputArtifactIds, expectedBundleInputs)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Intelligence bundle Artifact lost its exact source and authorized Evidence custody.',
        {
          assignmentId: assignment.assignmentId,
          bundleArtifactId: bundleArtifact.artifactId,
        },
      );
    }
    const advisorArtifactIds =
      assignment.assignmentKind === 'advisor'
        ? []
        : validatedRoleArtifactIds(index, plan, 'advisor');
    const advisorOutputs = advisorArtifactIds.map((artifactId) => ({
      artifactId,
      output: trustedAcceptedRoleOutput(
        index,
        artifactId,
        artifactStore,
        'operating-advisor-result',
      ).output,
    }));
    const challengerArtifactIds =
      assignment.assignmentKind === 'chair'
        ? validatedRoleArtifactIds(index, plan, 'challenger')
        : [];
    const challengerOutput =
      challengerArtifactIds.length === 1
        ? {
            artifactId: challengerArtifactIds[0],
            output: trustedAcceptedRoleOutput(
              index,
              challengerArtifactIds[0],
              artifactStore,
              'operating-challenger-review',
            ).output,
          }
        : null;
    try {
      validateOperatingIntelligenceResultV2({
        value: parsed,
        assignment,
        plan,
        snapshot,
        operatingState,
        inputBundle,
        advisorOutputs: assignment.assignmentKind === 'advisor' ? [] : advisorOutputs,
        challengerOutput: assignment.assignmentKind === 'chair' ? challengerOutput : null,
      });
    } catch (cause) {
      throw runtimeError(
        cause?.code ?? 'RESULT_CONTRACT_INVALID',
        cause?.message ?? 'Intelligence result semantic validation failed.',
        {
          assignmentId: assignment.assignmentId,
          ...(cause?.details?.context ?? {}),
        },
      );
    }
  }

  function validateSubmissionBodyForAssignment(bytes, assignment, index = null, options = {}) {
    if (
      assignment.outputContract.mediaType !== 'application/json' ||
      assignment.outputContract.encoding !== 'utf-8'
    ) {
      return;
    }
    const parsed = parseSubmissionJson(bytes);
    assertIntelligenceAssignmentSubmissionBody(assignment, parsed);
    assertAdvertisedJsonOutputContract(assignment, parsed);
    if (index) validateIntelligenceSemanticReferences(parsed, assignment, index, options);
  }

  function canonicalHashForSubmissionBytes(bytes, outputContract) {
    if (outputContract.mediaType !== 'application/json') return null;
    if (outputContract.encoding !== 'utf-8') {
      throw runtimeError('RESULT_CONTRACT_INVALID', 'A JSON submission must use UTF-8 encoding.');
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return sha256Jcs(JSON.parse(text));
    } catch {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'The submission is not valid UTF-8 JSON for its declared contract.',
      );
    }
  }

  function validateArtifactGetRequestShape(request) {
    try {
      assertProtocolArtifact(
        'operate-tool-call',
        {
          kind: 'operate-tool-call',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          direction: 'request',
          operation: 'operate.artifact.get',
          request: clone(request),
        },
        { protocolVersion: PROTOCOL_VERSION },
      );
      return true;
    } catch {
      return false;
    }
  }

  function artifactArguments(context) {
    const request = context.artifactRequest;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    return clone(request);
  }

  function actorMatchesClaim(actor, claim) {
    return (
      actor &&
      claim &&
      actor.actorId === claim.actorId &&
      actor.kind === claim.actorKind &&
      actor.runtime === claim.runtime
    );
  }

  function validateExactAcceptedSubmissionReplay({
    request,
    assignment,
    submission,
    artifact,
    replay,
    requestedInputArtifactIds = artifact?.inputArtifactIds,
  }) {
    if (!validateSubmitRequestShape(request)) {
      throw runtimeError('RESULT_CONTRACT_INVALID', 'The submission replay request is malformed.');
    }
    if (!assignment || !submission || !artifact || !replay) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The retained accepted submission replay proof is incomplete.',
        {
          assignmentId: assignment?.assignmentId ?? request.assignmentId,
          submissionId: submission?.submissionId ?? request.submissionId,
        },
      );
    }
    if (!actorMatchesClaim(request.actor, assignment.claim)) {
      throw runtimeError(
        'CAPABILITY_DENIED',
        'Only the exact retained Assignment claimant may replay its accepted result.',
        {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    if (
      request.assignmentId !== assignment.assignmentId ||
      request.submissionId !== submission.submissionId ||
      submission.assignmentId !== assignment.assignmentId ||
      submission.cycleId !== assignment.cycleId
    ) {
      throw runtimeError(
        'SUBMISSION_ID_CONFLICT',
        'Submission replay identity differs from the retained accepted result.',
        {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    if (assignment.state !== 'validated' || submission.state !== 'accepted') {
      throw runtimeError(
        'ASSIGNMENT_ALREADY_SUBMITTED',
        'Only the exact retained accepted submission may be replayed.',
        {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    if (
      request.mediaType !== artifact.mediaType ||
      request.encoding !== artifact.encoding ||
      request.mediaType !== assignment.outputContract.mediaType ||
      request.encoding !== assignment.outputContract.encoding
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Submission replay media type or encoding differs from the accepted result.',
        {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    if (
      sha256Jcs(requestedInputArtifactIds) !== sha256Jcs(artifact.inputArtifactIds) ||
      sha256Jcs(artifact.inputArtifactIds) !== sha256Jcs(assignment.inputArtifactIds)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Submission replay custody differs from the complete ordered Assignment inputs.',
        {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    try {
      assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay });
    } catch (cause) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        cause.message,
        cause.details ?? {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    const bytes = decodeSubmissionBytes(request);
    const rawHash = rawHashForBytes(bytes);
    const canonicalHash = canonicalHashForSubmissionBytes(bytes, assignment.outputContract);
    if (
      rawHash !== artifact.rawHash ||
      rawHash !== submission.rawHash ||
      rawHash !== replay.rawHash ||
      bytes.byteLength !== artifact.sizeBytes ||
      bytes.byteLength !== submission.sizeBytes ||
      bytes.byteLength !== replay.sizeBytes ||
      canonicalHash !== artifact.canonicalHash ||
      canonicalHash !== submission.canonicalHash ||
      canonicalHash !== replay.canonicalHash
    ) {
      throw runtimeError(
        'SUBMISSION_ID_CONFLICT',
        'Submission replay bytes differ from the exact retained accepted result.',
        {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
    return Buffer.from(bytes);
  }

  function issuedAssignmentCapabilities(assignment) {
    const mandateCapabilities = assignment.mandate?.allowedCapabilities;
    if (Array.isArray(mandateCapabilities) && mandateCapabilities.length > 0) {
      return [...mandateCapabilities].sort();
    }
    if (assignment.assignmentKind === 'context-capture') {
      return ['artifact.submit'];
    }
    return [];
  }

  return Object.freeze({
    actorMatchesClaim,
    artifactArguments,
    canonicalHashForSubmissionBytes,
    decodeSubmissionBytes,
    decodedBase64Size,
    issuedAssignmentCapabilities,
    rawHashForBytes,
    validateExactAcceptedSubmissionReplay,
    validateArtifactGetRequestShape,
    validateSubmissionBodyForAssignment,
    validateSubmitRequestShape,
  });
}
