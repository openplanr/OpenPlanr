import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

const MATERIALIZABLE = new Set(['quick-task', 'spec', 'epic', 'decision', 'agent-artifact']);

export function qualifyOperatingDraftCandidates(actions, options = {}) {
  const existing = new Set(options.existingDigests ?? []);
  let capacity = Number.isInteger(options.capacity) ? Math.max(0, options.capacity) : 12;
  const eligible = [];
  const rejected = [];
  for (const action of actions ?? []) {
    const digest = sha256Jcs({
      title: action.title,
      summary: action.summary,
      lane: action.lane,
      routeKind: action.routeKind,
      citations: action.citations,
    });
    let reason = null;
    if (!MATERIALIZABLE.has(action.routeKind)) reason = 'route-not-materializable';
    else if (action.confidence < 3) reason = 'confidence-below-threshold';
    else if (!Array.isArray(action.citations) || action.citations.length === 0) reason = 'citations-required';
    else if (options.conflictedActionKeys?.includes(action.actionKey)) reason = 'unresolved-critical-conflict';
    else if (existing.has(digest)) reason = 'duplicate';
    else if (capacity === 0) reason = 'profile-capacity-exhausted';
    if (reason) rejected.push({ action, digest, reason });
    else {
      eligible.push({ action, digest });
      existing.add(digest);
      capacity -= 1;
    }
  }
  return { eligible, rejected };
}

export function createOperatingMaterializedDraft(input) {
  const record = {
    kind: 'operating-materialized-draft',
    schemaVersion: '1.0.0',
    protocolVersion: '1.4.0',
    draftId: input.draftId,
    cycleId: input.cycleId,
    actionKey: input.actionKey,
    artifactKind: input.artifactKind,
    path: input.path,
    status: input.status ?? 'proposed',
    artifactDigest: input.artifactDigest,
    causality: {
      findingIds: [...new Set(input.findingIds ?? [])].sort(),
      citationDigests: [...new Set(input.citationDigests ?? [])].sort(),
    },
    reversible: true,
    ...(typeof input.userEdited === 'boolean' ? { userEdited: input.userEdited } : {}),
  };
  return assertProtocolArtifact('operating-materialized-draft', record, {
    protocolVersion: '1.4.0',
  });
}

export function assertOperatingDraftApproved(draft) {
  assertProtocolArtifact('operating-materialized-draft', draft, { protocolVersion: '1.4.0' });
  if (draft.status !== 'approved') {
    throw new PipelineError(
      'E_OPERATE_DRAFT_UNAPPROVED',
      `Draft ${draft.draftId} is ${draft.status} and cannot enter PLAN or SHIP.`,
      `Run: planr operate drafts approve ${draft.draftId}`,
    );
  }
  return draft;
}
