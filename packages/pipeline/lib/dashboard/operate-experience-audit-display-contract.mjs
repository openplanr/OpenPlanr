import { validateJson } from '../protocol/json-schema.mjs';
import {
  contentHash,
  deepFreeze,
  exactEventHead,
  exactJson,
  hasOwn,
  safeDataClone,
  withoutContentHash,
} from './closed-json-contract.mjs';
import {
  OPERATE_EXPERIENCE_AUDIT_DISPLAY_SURFACE_SCHEMA as auditDisplaySchema,
  OPERATE_EXPERIENCE_VIEW_SCHEMA as experienceViewSchema,
  OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA as reviewWorkspaceSchema,
  OPERATE_EXPERIENCE_SURFACE_SCHEMA as surfaceSchema,
  OPERATING_TRACE_MATRIX_SCHEMA as traceMatrixSchema,
} from './generated/operate-experience-surface-schema-data.mjs';
import { assertOperateExperienceSurfaceV1 } from './operate-experience-surface-contract.mjs';

const AUDIT_DISPLAY_DOMAIN = 'openplanr:operate-experience-audit-display-surface:1.0.0';
const AUDIT_SURFACES = new Set(['evidence', 'outcomes', 'outcome', 'history', 'search', 'export']);
const schemas = new Map([
  ['operate-experience-audit-display-surface.schema.json', auditDisplaySchema],
  ['operate-experience-surface.schema.json', surfaceSchema],
  ['operate-experience-view.schema.json', experienceViewSchema],
  ['operate-review-display-workspace.schema.json', reviewWorkspaceSchema],
  ['operating-trace-matrix.schema.json', traceMatrixSchema],
]);

function jsonPointer(root, fragment) {
  if (!fragment || fragment === '#') return root;
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

function resolveSchemaRef(reference) {
  const [path, pointer = ''] = reference.split('#');
  const filename = path.split('/').at(-1);
  const rootSchema = schemas.get(filename);
  if (!rootSchema) return null;
  return {
    schema: jsonPointer(rootSchema, pointer ? `#${pointer}` : '#'),
    rootSchema,
    base: filename,
  };
}

function validationFailure() {
  return [
    {
      path: '$',
      rule: 'closedContract',
      detail: 'does not satisfy the closed audit display contract',
    },
  ];
}

function validCanonicalSubjectSegment(segment) {
  try {
    const decoded = decodeURIComponent(segment);
    return (
      decoded.length > 0 &&
      decoded !== '.' &&
      decoded !== '..' &&
      !decoded.includes('/') &&
      !decoded.includes('\\') &&
      encodeURIComponent(decoded) === segment
    );
  } catch {
    return false;
  }
}

function validOwnedLink(value) {
  if (value === null) return true;
  return ownedLinkDestination(value) !== null;
}

function exactOwnedLink(value, surface, subjectId) {
  if (value === null) return true;
  if (typeof subjectId !== 'string') return false;
  if (surface === 'action') {
    return value === `#/operate/actions/${encodeURIComponent(subjectId)}`;
  }
  if (surface === 'cycle') {
    return value === `#/operate/cycles/${encodeURIComponent(subjectId)}`;
  }
  const route = surface === 'evidence' ? 'evidence' : 'outcomes';
  return value === `#/operate/${route}/${encodeURIComponent(subjectId)}`;
}

function ownedLinkDestination(value) {
  if (typeof value !== 'string') return null;
  const match = /^#\/operate\/(evidence|outcomes)\/([^/?#]+)$/u.exec(value);
  if (match !== null && validCanonicalSubjectSegment(match[2])) {
    return {
      surface: match[1] === 'evidence' ? 'evidence' : 'outcome',
      subjectId: decodeURIComponent(match[2]),
    };
  }
  const actionMatch = /^#\/operate\/actions\/([^/?#]+)$/u.exec(value);
  if (actionMatch !== null && validCanonicalSubjectSegment(actionMatch[1])) {
    return {
      surface: 'action',
      subjectId: decodeURIComponent(actionMatch[1]),
    };
  }
  const cycleMatch = /^#\/operate\/cycles\/([^/?#]+)$/u.exec(value);
  if (cycleMatch !== null && validCanonicalSubjectSegment(cycleMatch[1])) {
    return {
      surface: 'cycle',
      subjectId: decodeURIComponent(cycleMatch[1]),
    };
  }
  return null;
}

function validLinkProjection(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((entry) => validLinkProjection(entry, seen));
    for (const [key, child] of Object.entries(value)) {
      if (key === 'deepLink') {
        if (!validOwnedLink(child)) return false;
        continue;
      }
      if (key === 'deepLinks') {
        if (!Array.isArray(child) || !child.every(validOwnedLink)) return false;
        continue;
      }
      if (!validLinkProjection(child, seen)) return false;
    }
    return true;
  } finally {
    seen.delete(value);
  }
}

function restoreLegacyLinks(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) restoreLegacyLinks(entry, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'deepLink' && child === null) {
      value[key] = '#/operate/history/redacted';
      continue;
    }
    restoreLegacyLinks(child, seen);
  }
}

function legacyCompatibleSearchData(data) {
  return {
    ...data,
    results: data.results.map((entry) => {
      if (!['evidence', 'claim', 'outcome'].includes(entry.kind) && hasOwn(entry, 'deepLink')) {
        const { deepLink: _deepLink, ...rest } = entry;
        return rest;
      }
      return entry;
    }),
  };
}

function validLegacyPayload(payload) {
  try {
    const legacy = safeDataClone(payload);
    legacy.mutationEnabled = legacy.status === 'ready';
    if (legacy.surface === 'search') {
      legacy.data = legacyCompatibleSearchData(legacy.data);
    }
    restoreLegacyLinks(legacy.data);
    assertOperateExperienceSurfaceV1(legacy);
    return true;
  } catch {
    return false;
  }
}

function uniqueRows(records, field) {
  const ids = records.map((entry) => entry[field]);
  return ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length;
}

function restrictedEvidenceIsClosed(entry) {
  if (entry.accessState === 'available') return entry.accessReason === null;
  return (
    entry.accessState === 'restricted' &&
    entry.claimStatus === 'restricted' &&
    entry.evidenceKind === null &&
    entry.resolvedAt === null &&
    entry.source === null &&
    entry.producer === null &&
    entry.observedAt === null &&
    entry.provenance === null &&
    entry.confidence === null &&
    entry.accessReason === 'access-denied' &&
    entry.supportClaimIds.length === 0 &&
    entry.contradictClaimIds.length === 0 &&
    entry.gaps.length === 0 &&
    entry.errors.length === 0 &&
    entry.causalLinks.length === 0
  );
}

function restrictedClaimIsClosed(entry) {
  if (entry.accessReason === null) return entry.statement !== null;
  return (
    entry.status === 'restricted' &&
    entry.accessReason === 'access-denied' &&
    entry.statement === null &&
    entry.source === null &&
    entry.producer === null &&
    entry.provenance === null &&
    entry.confidence === null &&
    entry.supportEvidenceRefIds.length === 0 &&
    entry.contradictEvidenceRefIds.length === 0 &&
    entry.gaps.length === 0 &&
    entry.errors.length === 0 &&
    entry.causalLinks.length === 0
  );
}

function validCausalLink(link) {
  return link.kind === 'outcome'
    ? exactOwnedLink(link.deepLink, 'outcome', link.subjectId)
    : link.deepLink === null;
}

function validEvidenceData(data) {
  const evidence = new Map(data.evidence.map((entry) => [entry.evidenceRefId, entry]));
  const claims = new Map(data.claims.map((entry) => [entry.claimId, entry]));
  if (
    !uniqueRows(data.evidence, 'evidenceRefId') ||
    !uniqueRows(data.claims, 'claimId') ||
    !data.evidence.every(
      (entry) =>
        restrictedEvidenceIsClosed(entry) &&
        exactOwnedLink(entry.deepLink, 'evidence', entry.evidenceRefId) &&
        entry.causalLinks.every(validCausalLink),
    ) ||
    !data.claims.every(
      (entry) =>
        restrictedClaimIsClosed(entry) &&
        exactOwnedLink(entry.deepLink, 'evidence', entry.claimId) &&
        entry.causalLinks.every(validCausalLink),
    )
  )
    return false;
  for (const entry of data.evidence) {
    if (
      !entry.supportClaimIds.every((id) =>
        claims.get(id)?.supportEvidenceRefIds.includes(entry.evidenceRefId),
      ) ||
      !entry.contradictClaimIds.every((id) =>
        claims.get(id)?.contradictEvidenceRefIds.includes(entry.evidenceRefId),
      )
    )
      return false;
  }
  return data.claims.every(
    (entry) =>
      entry.supportEvidenceRefIds.every((id) =>
        evidence.get(id)?.supportClaimIds.includes(entry.claimId),
      ) &&
      entry.contradictEvidenceRefIds.every((id) =>
        evidence.get(id)?.contradictClaimIds.includes(entry.claimId),
      ),
  );
}

function visibleAffirmativeOutcome(outcome) {
  return (
    outcome.accessReason === null &&
    outcome.observationIds.length > 0 &&
    outcome.evidenceRefIds.length > 0 &&
    outcome.metric.observed !== null &&
    outcome.metric.freshness === 'current' &&
    outcome.verification.accessReason === null
  );
}

function restrictedOutcome(outcome) {
  return (
    outcome.accessReason === 'access-denied' &&
    outcome.observationIds.length === 0 &&
    outcome.evidenceRefIds.length === 0 &&
    outcome.metric.baseline === null &&
    outcome.metric.target === null &&
    outcome.metric.observed === null &&
    outcome.metric.unit === null &&
    outcome.metric.window === null &&
    outcome.metric.confidence === null &&
    outcome.verification.accessReason === 'access-denied' &&
    outcome.verification.method === null &&
    outcome.verification.evaluationRules.length === 0 &&
    outcome.verification.observationRequest === null &&
    outcome.nextObservation === null &&
    outcome.revisit === null
  );
}

function restrictedAffirmativeOutcome(outcome) {
  return ['succeeded', 'failed'].includes(outcome.status) && restrictedOutcome(outcome);
}

function validOutcomeTuple(outcome) {
  const metric = outcome.metric;
  const verification = outcome.verification;
  if (
    metric === null ||
    verification === null ||
    outcome.verificationPlanId !== verification.verificationPlanId ||
    metric.metricId !== verification.metricId ||
    metric.metricHash !== verification.metricHash ||
    !exactOwnedLink(outcome.deepLink, 'outcome', outcome.outcomeId) ||
    (outcome.decision !== null && outcome.decision.deepLink !== null) ||
    !outcome.execution.every((entry) => entry.deepLink === null) ||
    !outcome.rollback.every((entry) => entry.deepLink === null)
  )
    return false;
  if (
    (outcome.accessReason === 'access-denied' || verification.accessReason === 'access-denied') &&
    !restrictedOutcome(outcome)
  )
    return false;
  if (outcome.status === 'insufficient-evidence') {
    return (
      metric.observed === null &&
      outcome.observationIds.length === 0 &&
      outcome.evidenceRefIds.length === 0 &&
      outcome.snapshot === null &&
      outcome.delta === null
    );
  }
  return (
    !['succeeded', 'failed'].includes(outcome.status) ||
    visibleAffirmativeOutcome(outcome) ||
    restrictedAffirmativeOutcome(outcome)
  );
}

function validOutcomesData(data, detail = false) {
  const outcomes = detail ? [data.outcome] : data.outcomes;
  if (!uniqueRows(outcomes, 'outcomeId') || !outcomes.every(validOutcomeTuple)) return false;
  if (
    !detail &&
    !data.domainMetrics.every((entry) =>
      entry.dueVerification.every((item) => item.deepLink === null),
    )
  )
    return false;
  const outcomeIds = new Set(outcomes.map((entry) => entry.outcomeId));
  return (
    uniqueRows(data.learnings, 'learningId') &&
    data.learnings.every((entry) => outcomeIds.has(entry.outcomeId))
  );
}

function validHistoryData(data, eventHead) {
  return (
    uniqueRows(data.history, 'eventId') &&
    data.history.every((entry) =>
      entry.deepLinks.every((deepLink) => {
        const destination = ownedLinkDestination(deepLink);
        return destination?.surface === 'evidence'
          ? destination.subjectId === entry.entityId ||
              entry.evidenceRefIds.includes(destination.subjectId)
          : destination?.surface === 'outcome' && destination.subjectId === entry.entityId;
      }),
    ) &&
    data.replay.liveAccessUsed === false &&
    exactEventHead(data.replay.finalHead, eventHead) &&
    data.replay.parityProof.finalEventHashMatches === true
  );
}

function validSearchData(data) {
  return data.results.every((entry) => {
    if (!hasOwn(entry, 'deepLink')) return true;
    if (entry.kind === 'evidence' || entry.kind === 'claim')
      return exactOwnedLink(entry.deepLink, 'evidence', entry.subjectId);
    if (entry.kind === 'outcome') return exactOwnedLink(entry.deepLink, 'outcome', entry.subjectId);
    if (entry.kind === 'action') return exactOwnedLink(entry.deepLink, 'action', entry.subjectId);
    if (entry.kind === 'cycle') return exactOwnedLink(entry.deepLink, 'cycle', entry.subjectId);
    if (entry.kind === 'assignment') {
      if (entry.deepLink === null) return true;
      const match = /^#\/operate\/cycles\/([^/?#]+)$/u.exec(entry.deepLink);
      return match !== null && validCanonicalSubjectSegment(match[1]);
    }
    return false;
  });
}

const EXPORT_ROOT_KEYS = [
  'kind',
  'schemaVersion',
  'protocolVersion',
  'scopeId',
  'domainId',
  'domainVersion',
  'generatedAt',
  'eventHead',
  'status',
  'attention',
  'domainMetrics',
  'cycles',
  'inbox',
  'actions',
  'evidence',
  'claims',
  'rationale',
  'outcomes',
  'learnings',
  'history',
  'replay',
  'omissions',
].sort();
const FORBIDDEN_EXPORT_FIELDS = new Set([
  'ownerActorId',
  'actorId',
  'partyId',
  'requiredCapability',
  'source',
  'producer',
  'provenance',
  'authority',
  'actionLocator',
  'rawHash',
  'canonicalHash',
]);

function validExportTree(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((entry) => validExportTree(entry, seen));
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_EXPORT_FIELDS.has(key)) return false;
      if (key === 'errors' && (!Array.isArray(child) || child.length !== 0)) return false;
      if (!validExportTree(child, seen)) return false;
    }
    return true;
  } finally {
    seen.delete(value);
  }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function unescapeHtml(value) {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function validExportValue(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    exactJson(Object.keys(value).sort(), EXPORT_ROOT_KEYS) &&
    validExportTree(value) &&
    validLinkProjection(value)
  );
}

function canonicalizeExportValue(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalizeExportValue(entry));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeExportValue(value[key])]),
  );
}

function validExportData(data) {
  try {
    if (data.format === 'json') {
      if (data.mediaType !== 'application/json') return false;
      const value = JSON.parse(data.content);
      return (
        validExportValue(value) && JSON.stringify(canonicalizeExportValue(value)) === data.content
      );
    }
    if (data.mediaType !== 'text/html; charset=utf-8') return false;
    const prefix =
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenPlanr Operate audit export</title><body><main><h1>Operate audit export</h1><p>';
    const marker = '</p><pre>';
    const suffix = '</pre></main></body></html>';
    if (!data.content.startsWith(prefix) || !data.content.endsWith(suffix)) return false;
    const markerIndex = data.content.indexOf(marker, prefix.length);
    if (markerIndex < 0) return false;
    const escapedJson = data.content.slice(markerIndex + marker.length, -suffix.length);
    const value = JSON.parse(unescapeHtml(escapedJson));
    if (!validExportValue(value)) return false;
    const canonicalValue = canonicalizeExportValue(value);
    const expected = `${prefix}${escapeHtml(`${canonicalValue.domainId} / ${canonicalValue.scopeId}`)}${marker}${escapeHtml(JSON.stringify(canonicalValue, null, 2))}${suffix}`;
    return data.content === expected;
  } catch {
    return false;
  }
}

function validAuditPayloadSemantics(payload) {
  if (payload.surface === 'evidence') return validEvidenceData(payload.data);
  if (payload.surface === 'outcomes') return validOutcomesData(payload.data);
  if (payload.surface === 'outcome') return validOutcomesData(payload.data, true);
  if (payload.surface === 'history') return validHistoryData(payload.data, payload.eventHead);
  if (payload.surface === 'search') return validSearchData(payload.data);
  if (payload.surface === 'export') return validExportData(payload.data);
  return false;
}

function validApplicableBinding(binding, payload) {
  if (
    binding.actorId !== payload.actorId ||
    binding.scopeId !== payload.scopeId ||
    binding.domainId !== payload.domainId ||
    binding.domainVersion !== payload.domainVersion ||
    binding.generatedAt !== payload.generatedAt ||
    binding.viewHash !== payload.viewHash ||
    binding.surface !== payload.surface ||
    !exactEventHead(binding.eventHead, payload.eventHead)
  )
    return false;
  if (binding.surface === 'outcome') {
    return (
      typeof binding.subjectId === 'string' &&
      binding.query === null &&
      binding.format === null &&
      payload.data.outcome?.outcomeId === binding.subjectId
    );
  }
  if (binding.surface === 'evidence') {
    const subjectMatches =
      binding.subjectId === null ||
      payload.data.evidence?.some((item) => item.evidenceRefId === binding.subjectId) ||
      payload.data.claims?.some((item) => item.claimId === binding.subjectId);
    return subjectMatches && binding.query === null && binding.format === null;
  }
  if (binding.surface === 'search') {
    return (
      binding.subjectId === null &&
      typeof binding.query === 'string' &&
      binding.query === payload.data.query &&
      binding.format === null
    );
  }
  if (binding.surface === 'export') {
    return (
      binding.subjectId === null && binding.query === null && binding.format === payload.data.format
    );
  }
  return binding.subjectId === null && binding.query === null && binding.format === null;
}

function validAuditSemantics(value, expected) {
  return (
    AUDIT_SURFACES.has(value.payload.surface) &&
    value.payload.readOnly === true &&
    value.payload.mutationEnabled === false &&
    value.integrity.sourceViewHash === value.payload.viewHash &&
    value.integrity.sourceViewHash === value.requestBinding.viewHash &&
    value.payload.truthSummary.sourceViewHash === value.payload.viewHash &&
    exactEventHead(value.payload.truthSummary.sourceEventHead, value.payload.eventHead) &&
    validApplicableBinding(value.requestBinding, value.payload) &&
    (expected === undefined || exactJson(value.requestBinding, expected)) &&
    validLinkProjection(value.payload.data) &&
    validAuditPayloadSemantics(value.payload) &&
    validLegacyPayload(value.payload)
  );
}

export function validateOperateExperienceAuditDisplaySurfaceV1(value, expected) {
  try {
    const clone = safeDataClone(value);
    const errors = validateJson(clone, auditDisplaySchema, {
      base: 'schemas/v1.2.0/operate-experience-audit-display-surface.schema.json',
      resolveRef: resolveSchemaRef,
    });
    if (errors.length > 0 || !validAuditSemantics(clone, expected))
      return errors.length > 0 ? errors : validationFailure();
    return clone.integrity.contentHash ===
      contentHash(withoutContentHash(clone), clone.integrity.domain)
      ? []
      : validationFailure();
  } catch {
    return validationFailure();
  }
}

export function assertOperateExperienceAuditDisplaySurfaceV1(value, expected) {
  if (validateOperateExperienceAuditDisplaySurfaceV1(value, expected).length > 0) {
    const error = new TypeError(
      'The Operate audit display surface does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_EXPERIENCE_AUDIT_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

export function issueOperateExperienceAuditDisplaySurfaceV1(payload, binding) {
  const selected = safeDataClone(payload);
  selected.readOnly = true;
  selected.mutationEnabled = false;
  const requestBinding = safeDataClone(binding);
  const base = {
    kind: 'operate-experience-audit-display-surface',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    requestBinding,
    payload: selected,
    integrity: {
      algorithm: 'sha-256-jcs',
      domain: AUDIT_DISPLAY_DOMAIN,
      sourceViewHash: selected.viewHash,
    },
  };
  const issued = {
    ...base,
    integrity: {
      ...base.integrity,
      contentHash: contentHash(base, AUDIT_DISPLAY_DOMAIN),
    },
  };
  assertOperateExperienceAuditDisplaySurfaceV1(issued, requestBinding);
  return deepFreeze(issued);
}

export const OPERATE_EXPERIENCE_AUDIT_DISPLAY_SURFACE_SCHEMA_V1 = Object.freeze(
  structuredClone(auditDisplaySchema),
);
