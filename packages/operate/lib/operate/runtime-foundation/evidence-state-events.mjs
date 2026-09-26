/**
 * Evidence and durable-state Event handlers for the Operate runtime reducer: evidence
 * resolution, planning delivery ingestion, snapshots, operating state and metric observations.
 * runtime-foundation.mjs builds the handler with createEvidenceStateRuntimeEventHandlerV2 and
 * injects the shared runtime helpers.
 */
import { assertOperatingSnapshotV2, deriveOperatingEvidenceEdgeIdV2 } from './evidence-state.mjs';
import { buildOperatingIntelligenceStateTransitionV2 } from './intelligence.mjs';
import { sha256Jcs } from './protocol.mjs';

const EVIDENCE_CLASSIFICATION_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
});

export function createEvidenceStateRuntimeEventHandlerV2({
  acceptedEvidenceSource,
  assertFreshIntelligenceIdentity,
  assertIntelligenceEvidenceRefs,
  assertIntelligenceSourceArtifact,
  assertIntelligenceTimestamp,
  assertOperatingModelStateProvenance,
  assertOperatingSnapshotProvenance,
  buildPlanningDeliveryIngestionV2,
  clone,
  intelligenceEventRecord,
  materializeRuntimeState,
  requireRuntimeIntelligenceActor,
  runtimeError,
  sameEvidenceBinding,
}) {
  function evidenceReplayEntry(event, resolution) {
    return {
      resolutionId: resolution.resolutionId,
      candidateId: resolution.candidateId,
      sourceArtifactId: resolution.sourceArtifactId,
      outcome: resolution.outcome,
      evidenceRefId: resolution.evidenceRefId,
      evidenceArtifactId: resolution.evidenceArtifactId,
      eventId: event.eventId,
      requestHash: event.payload.requestHash,
      outcomeHash: event.payload.outcomeHash,
    };
  }

  function assertEvidenceResolutionFresh(index, event, resolution) {
    if (event.actor.kind !== 'runtime') {
      throw runtimeError(
        'CAPABILITY_DENIED',
        'Only the runtime may materialize an evidence resolution.',
        {
          actorKind: event.actor.kind,
        },
      );
    }
    if (
      index.evidenceResolutions.has(resolution.resolutionId) ||
      index.evidenceReplay.has(resolution.resolutionId) ||
      index.evidenceCandidateIds.has(resolution.candidateId)
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Evidence resolution or candidate identity already exists.',
        {
          resolutionId: resolution.resolutionId,
          candidateId: resolution.candidateId,
        },
      );
    }
    if (resolution.resolvedAt !== event.timestamp || event.cycleId === undefined) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Evidence resolution timestamps and Cycle identity must be Event-owned.',
        {
          resolutionId: resolution.resolutionId,
        },
      );
    }
    return acceptedEvidenceSource(index, resolution.sourceArtifactId, {
      cycleId: event.cycleId,
      scopeId: resolution.scopeId,
      domainId: resolution.domainId,
      domainVersion: resolution.domainVersion,
    });
  }

  function assertSnapshotArtifact(index, artifact, evidenceRef, sourceArtifact, event) {
    const inputIds = artifact.inputArtifactIds;
    if (
      artifact.artifactType !== 'evidence-snapshot' ||
      artifact.schemaId !== 'operating-evidence-snapshot' ||
      artifact.artifactSchemaVersion !== '1.0.0' ||
      artifact.assignmentId !== sourceArtifact.assignmentId ||
      artifact.cycleId !== sourceArtifact.cycleId ||
      !sameEvidenceBinding(artifact, sourceArtifact) ||
      artifact.createdAt !== event.timestamp ||
      artifact.rawHash !== evidenceRef.evidenceArtifactRawHash ||
      artifact.canonicalHash !== evidenceRef.evidenceArtifactCanonicalHash ||
      artifact.artifactId !== evidenceRef.evidenceArtifactId ||
      artifact.sensitivity !== evidenceRef.classification ||
      artifact.producer?.actorId !== 'openplanr' ||
      artifact.producer?.roleId !== 'evidence-resolver' ||
      artifact.producer?.runtime !== 'openplanr' ||
      !Array.isArray(inputIds) ||
      new Set(inputIds).size !== inputIds.length ||
      !inputIds.includes(sourceArtifact.artifactId) ||
      inputIds.some((artifactId) => !index.artifacts.has(artifactId))
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The evidence-snapshot Artifact does not retain immutable source, binding, and hash provenance.',
        {
          artifactId: artifact?.artifactId ?? null,
          sourceArtifactId: sourceArtifact.artifactId,
        },
      );
    }
    if (index.artifacts.has(artifact.artifactId)) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Evidence-snapshot Artifact identity already exists.',
        {
          artifactId: artifact.artifactId,
        },
      );
    }
  }

  function assertEvidenceEdge(index, edge, evidenceRef, sourceArtifact, event, semanticEdges) {
    const semanticKey = `${edge.sourceArtifactId}:${edge.localClaimId}:${edge.relation}:${edge.evidenceRefId}`;
    const expectedId = deriveOperatingEvidenceEdgeIdV2({
      sourceArtifactId: edge.sourceArtifactId,
      localClaimId: edge.localClaimId,
      relation: edge.relation,
      evidenceRefId: edge.evidenceRefId,
    });
    if (
      edge.edgeId !== expectedId ||
      edge.evidenceRefId !== evidenceRef.evidenceRefId ||
      edge.sourceArtifactId !== sourceArtifact.artifactId ||
      !sameEvidenceBinding(edge, evidenceRef) ||
      !sameEvidenceBinding(edge, sourceArtifact) ||
      edge.createdAt !== event.timestamp ||
      edge.createdBy?.kind !== 'runtime' ||
      edge.createdBy?.id !== 'openplanr' ||
      !['supportedBy', 'contradictedBy'].includes(edge.relation) ||
      EVIDENCE_CLASSIFICATION_RANK[edge.classification] === undefined ||
      EVIDENCE_CLASSIFICATION_RANK[edge.classification] <
        EVIDENCE_CLASSIFICATION_RANK[evidenceRef.classification] ||
      EVIDENCE_CLASSIFICATION_RANK[edge.classification] <
        EVIDENCE_CLASSIFICATION_RANK[sourceArtifact.sensitivity] ||
      index.evidenceEdges.has(edge.edgeId) ||
      semanticEdges.has(semanticKey)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Evidence edges must be unique runtime-issued source-Artifact-local support or contradiction links.',
        {
          edgeId: edge?.edgeId ?? null,
          sourceArtifactId: sourceArtifact.artifactId,
        },
      );
    }
    semanticEdges.add(semanticKey);
  }

  function applyEvidenceResolved(index, event) {
    const { resolution, evidenceRef, evidenceArtifact, edges } = event.payload;
    const source = assertEvidenceResolutionFresh(index, event, resolution);
    if (
      event.entityId !== evidenceRef.evidenceRefId ||
      resolution.outcome !== 'resolved' ||
      resolution.evidenceRefId !== evidenceRef.evidenceRefId ||
      resolution.evidenceArtifactId !== evidenceArtifact.artifactId ||
      evidenceRef.candidateId !== resolution.candidateId ||
      evidenceRef.sourceArtifactId !== resolution.sourceArtifactId ||
      evidenceRef.evidenceKind !== resolution.evidenceKind ||
      sha256Jcs(evidenceRef.sourceContract) !== sha256Jcs(resolution.sourceContract) ||
      evidenceRef.resolvedAt !== event.timestamp ||
      !sameEvidenceBinding(evidenceRef, resolution) ||
      !sameEvidenceBinding(evidenceRef, source.artifact) ||
      sha256Jcs(evidenceRef.provider) !== sha256Jcs(resolution.provider) ||
      sha256Jcs(evidenceRef.resolver) !== sha256Jcs(resolution.resolver) ||
      index.evidenceRefs.has(evidenceRef.evidenceRefId)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Resolved evidence Event identity or immutable binding is inconsistent.',
        {
          resolutionId: resolution.resolutionId,
        },
      );
    }
    assertSnapshotArtifact(index, evidenceArtifact, evidenceRef, source.artifact, event);
    const semanticEdges = new Set(
      [...index.evidenceEdges.values()].map(
        (edge) =>
          `${edge.sourceArtifactId}:${edge.localClaimId}:${edge.relation}:${edge.evidenceRefId}`,
      ),
    );
    for (const edge of edges)
      assertEvidenceEdge(index, edge, evidenceRef, source.artifact, event, semanticEdges);
    index.artifacts.set(evidenceArtifact.artifactId, clone(evidenceArtifact));
    index.evidenceRefs.set(evidenceRef.evidenceRefId, clone(evidenceRef));
    index.evidenceResolutions.set(resolution.resolutionId, clone(resolution));
    for (const edge of edges) index.evidenceEdges.set(edge.edgeId, clone(edge));
    const replay = evidenceReplayEntry(event, resolution);
    index.evidenceReplay.set(replay.resolutionId, replay);
    index.evidenceCandidateIds.set(replay.candidateId, replay.resolutionId);
  }

  function applyEvidenceRejected(index, event) {
    const { resolution } = event.payload;
    const source = assertEvidenceResolutionFresh(index, event, resolution);
    if (
      event.entityId !== resolution.resolutionId ||
      resolution.outcome !== 'rejected' ||
      resolution.evidenceRefId !== null ||
      resolution.evidenceArtifactId !== null ||
      resolution.error === null ||
      !sameEvidenceBinding(resolution, source.artifact)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Rejected evidence Event identity or immutable source binding is inconsistent.',
        {
          resolutionId: resolution.resolutionId,
        },
      );
    }
    index.evidenceResolutions.set(resolution.resolutionId, clone(resolution));
    const replay = evidenceReplayEntry(event, resolution);
    index.evidenceReplay.set(replay.resolutionId, replay);
    index.evidenceCandidateIds.set(replay.candidateId, replay.resolutionId);
  }

  function applyPlanningDeliveryIngested(index, event) {
    if (
      event.actor.kind !== 'runtime' ||
      event.actor.id !== 'openplanr' ||
      event.entityId !== event.payload?.deliveryEvidence?.deliveryEvidenceId ||
      event.cycleId !== event.payload?.assignment?.cycleId ||
      event.timestamp !== event.payload?.deliveryEvidence?.createdAt ||
      event.causationId !== event.payload?.verificationPlanEvent?.eventId
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Planning delivery ingestion Event lost its runtime, identity, Cycle, timestamp, or plan causation.',
      );
    }
    const priorState = materializeRuntimeState(index, event.timestamp, {
      sequence: event.sequence - 1,
      hash: event.previousEventHash,
    });
    const built = buildPlanningDeliveryIngestionV2(priorState, {
      origin: event.payload.origin,
      deliveryEvidence: event.payload.deliveryEvidence,
      verificationPlanEvent: event.payload.verificationPlanEvent,
      timestamp: event.timestamp,
    });
    if (
      sha256Jcs(built.artifact) !== sha256Jcs(event.payload.artifact) ||
      sha256Jcs(built.evidenceRef) !== sha256Jcs(event.payload.evidenceRef) ||
      sha256Jcs(built.assignment) !== sha256Jcs(event.payload.assignment) ||
      sha256Jcs({
        ledgerId: built.reconstructed.ledgerId,
        snapshotId: built.reconstructed.snapshotId,
        stateId: built.reconstructed.stateId,
      }) !== sha256Jcs(event.payload.verificationSource) ||
      index.artifacts.has(built.artifact.artifactId) ||
      index.evidenceRefs.has(built.evidenceRef.evidenceRefId) ||
      index.assignments.has(built.assignment.assignmentId)
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Planning delivery ingestion does not equal its canonical evidence and Assignment projection.',
      );
    }
    index.artifacts.set(built.artifact.artifactId, clone(built.artifact));
    index.evidenceRefs.set(built.evidenceRef.evidenceRefId, clone(built.evidenceRef));
    index.assignments.set(built.assignment.assignmentId, clone(built.assignment));
  }

  function previousSnapshotIdForScope(index, snapshot) {
    return (
      [...index.operatingSnapshots.values()]
        .filter(
          (candidate) =>
            candidate.scopeId === snapshot.scopeId &&
            candidate.domainId === snapshot.domainId &&
            candidate.domainVersion === snapshot.domainVersion,
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.snapshotId.localeCompare(right.snapshotId),
        )
        .at(-1)?.snapshotId ?? null
    );
  }

  function applyMetricObservation(index, event) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    if (record.snapshotId !== snapshot.snapshotId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Metric observation record must match its explicit Event snapshot binding.',
        {
          observationId: record.observationId,
        },
      );
    }
    assertFreshIntelligenceIdentity(
      index,
      index.metricObservations,
      record.observationId,
      event,
      record.observationId,
    );
    assertIntelligenceTimestamp(event, record, 'observedAt');
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
    buildOperatingIntelligenceStateTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      existingDecisions: [...index.decisions.values()],
      existingActions: [...index.actions.values()],
      metricObservations: [record],
    });
    assertIntelligenceSourceArtifact(index, event, record, snapshot);
    index.metricObservations.set(record.observationId, clone(record));
  }

  return function applyEvidenceStateRuntimeEvent(index, event) {
    switch (event.type) {
      case 'evidence.resolved':
        applyEvidenceResolved(index, event);
        return;
      case 'planning-delivery.ingested':
        applyPlanningDeliveryIngested(index, event);
        return;
      case 'evidence.rejected':
        applyEvidenceRejected(index, event);
        return;
      case 'snapshot.materialized': {
        const snapshot = event.payload;
        const cycle = index.cycles.get(event.cycleId);
        if (
          event.actor.kind !== 'runtime' ||
          event.actor.id !== 'openplanr' ||
          event.entityId !== snapshot.snapshotId ||
          !cycle ||
          !sameEvidenceBinding(cycle, snapshot) ||
          snapshot.createdAt !== event.timestamp ||
          index.operatingSnapshots.has(snapshot.snapshotId) ||
          index.operatingModelStates.has(snapshot.stateId)
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Operating snapshot materialization requires one new runtime-owned, Cycle-bound snapshot identity.',
            {
              snapshotId: snapshot?.snapshotId ?? null,
              stateId: snapshot?.stateId ?? null,
              cycleId: event.cycleId,
            },
          );
        }
        try {
          assertOperatingSnapshotV2(snapshot, {
            previousSnapshotId: previousSnapshotIdForScope(index, snapshot),
          });
          assertOperatingSnapshotProvenance(index, snapshot);
        } catch (error) {
          throw runtimeError(
            error.code ?? 'STATE_TRANSITION_INVALID',
            error.message,
            error.details?.context ?? {
              snapshotId: snapshot.snapshotId,
            },
          );
        }
        index.operatingSnapshots.set(snapshot.snapshotId, clone(snapshot));
        return;
      }
      case 'operating-state.materialized': {
        const state = event.payload;
        const snapshot = index.operatingSnapshots.get(state.snapshotId);
        const cycle = index.cycles.get(event.cycleId);
        if (
          event.actor.kind !== 'runtime' ||
          event.actor.id !== 'openplanr' ||
          event.entityId !== state.stateId ||
          !snapshot ||
          !cycle ||
          state.generatedAt !== event.timestamp ||
          !sameEvidenceBinding(cycle, state) ||
          index.operatingModelStates.has(state.stateId)
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Operating-model state materialization requires one new runtime-owned state bound to its snapshot and Cycle.',
            {
              stateId: state?.stateId ?? null,
              snapshotId: state?.snapshotId ?? null,
              cycleId: event.cycleId,
            },
          );
        }
        try {
          assertOperatingSnapshotV2(snapshot, { state });
          assertOperatingModelStateProvenance(index, state, { snapshot });
        } catch (error) {
          throw runtimeError(
            error.code ?? 'STATE_TRANSITION_INVALID',
            error.message,
            error.details?.context ?? {
              stateId: state.stateId,
            },
          );
        }
        index.operatingModelStates.set(state.stateId, clone(state));
        return;
      }
      case 'metric.observed':
        applyMetricObservation(index, event);
        return;
      default:
        throw runtimeError(
          'CONTRACT_VERSION_UNSUPPORTED',
          `Unsupported Phase 1 event ${event.type}.`,
        );
    }
  };
}
