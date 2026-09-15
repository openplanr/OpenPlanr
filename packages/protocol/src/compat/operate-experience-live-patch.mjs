/**
 * The Operate experience live patch, with no Operate runtime dependency.
 *
 * The dashboard server needs this one builder. Importing it from the projection module put the
 * package root on the Operate runtime, so it lives here instead. The private helpers are copied
 * rather than shared: the projection module has 111 `fail` and 46 `clone` call sites, and these
 * duplicates are meant to die with it.
 */
import { PipelineError } from '../errors.mjs';
import { assertOperateExperienceArtifactV2 } from '../contracts.mjs';
import { sha256Jcs } from '../canonical-json.mjs';

const PROTOCOL_VERSION = '2.0.0';



function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function stableId(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function assertCanonicalView(view) {
  assertOperateExperienceArtifactV2('operate-experience-view', view);
  if (view.viewHash !== sha256Jcs(without(view, 'viewHash'))) fail('E_OPERATE_BINDING_MISMATCH', 'Experience viewHash does not equal its canonical content.');
  return view;
}

function validInstant(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('RESULT_CONTRACT_INVALID', `${field} must be an RFC 3339 instant.`);
  return value;
}

export function buildOperateExperienceLivePatchV2(previous, next, { createdAt = next?.generatedAt } = {}) {
  assertCanonicalView(previous); assertCanonicalView(next);
  for (const field of ['scopeId', 'domainId', 'domainVersion', 'actorId', 'accessLevel']) if (previous[field] !== next[field]) fail('E_OPERATE_BINDING_MISMATCH', `Live patch binding changed at ${field}.`);
  if (next.eventHead.sequence !== previous.eventHead.sequence + 1
    || (previous.eventHead.sequence > 0 && next.eventHead.hash === previous.eventHead.hash)) {
    fail('STATE_TRANSITION_INVALID', 'Live patch requires one exact contiguous, non-forking Event-head advance.');
  }
  validInstant(createdAt, 'createdAt');
  const paths = ['status', 'attention', 'domainMetrics', 'cycles', 'inbox', 'actions', 'evidence', 'claims', 'rationale', 'outcomes', 'learnings', 'history', 'replay', 'allowedActions', 'omissions', 'export'];
  const operations = paths.filter((path) => sha256Jcs(previous[path]) !== sha256Jcs(next[path])).map((path) => ({ op: 'replace', path: `/${path}`, valueHash: sha256Jcs(next[path]), value: clone(next[path]) }));
  const base = { kind: 'operate-experience-live-patch', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION, patchId: stableId('xpatch', { from: previous.viewHash, to: next.viewHash }), scopeId: next.scopeId, domainId: next.domainId, domainVersion: next.domainVersion, actorId: next.actorId, fromEventHead: clone(previous.eventHead), toEventHead: clone(next.eventHead), fromViewHash: previous.viewHash, toViewHash: next.viewHash, operations, createdAt };
  const patch = { ...base, patchHash: sha256Jcs(base) };
  assertOperateExperienceArtifactV2('operate-experience-live-patch', patch);
  return freeze(patch);
}
