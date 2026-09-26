import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import { assertDesignImplementationHandoff } from '@openplanr/protocol/design-handoff-contracts';
import {
  assertImplementationHandoffProjection,
  composeImplementationHandoff,
  implementationHandoffPaths,
  readImplementationHandoffDraft,
  verifyImplementationHandoffSources,
  writeImplementationHandoffDraft,
} from './implementation-handoff.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const APPROVE_CAPABILITY = 'design:implementation-handoff:approve';
const REVOKE_CAPABILITY = 'design:implementation-handoff:revoke';
const MAX_REASON_BYTES = 16 * 1024;

const clone = (value) => JSON.parse(canonicalizeJson(value));
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const requestKey = (requestId) => createHash('sha256').update(requestId).digest('hex');
const packageKey = (value) => {
  const identity = createHash('sha256').update(value.id).digest('hex').slice(0, 16);
  return `${identity}-v${value.version}-${value.contentDigest.slice(7, 23)}`;
};

function atomicText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function immutableText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (readFileSync(path, 'utf8') !== value)
      throw lifecycleConflict(
        'Immutable implementation handoff history conflicts with this operation.',
      );
  }
}

function lifecycleConflict(message) {
  return Object.assign(new Error(message), {
    code: 'E_IMPLEMENTATION_HANDOFF_CONFLICT',
    statusCode: 409,
  });
}

function lifecycleForbidden(message) {
  return Object.assign(new Error(message), {
    code: 'E_IMPLEMENTATION_HANDOFF_FORBIDDEN',
    statusCode: 403,
  });
}

function normalizeId(value, label) {
  if (typeof value !== 'string' || value.length > 160 || !ID.test(value))
    throw new TypeError(`${label} is invalid.`);
  return value;
}

function normalizeRequestId(value) {
  return normalizeId(value, 'Implementation handoff request identity');
}

function timestamp(clock) {
  const candidate = typeof clock === 'function' ? clock() : new Date();
  const value = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(value.getTime()))
    throw new TypeError('The approval clock returned an invalid timestamp.');
  return value.toISOString();
}

function authorizeActor(actor, capability, at) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor))
    throw lifecycleForbidden('Implementation handoff approval requires an owner identity.');
  const actorId = normalizeId(actor.id, 'Implementation handoff actor identity');
  if (!['owner', 'maintainer'].includes(actor.role))
    throw lifecycleForbidden(
      'Only an owner or maintainer can change implementation handoff approval.',
    );
  if (!Array.isArray(actor.capabilities) || !actor.capabilities.includes(capability))
    throw lifecycleForbidden('The actor lacks the required implementation handoff capability.');
  if (actor.sessionExpiresAt === undefined) {
    if (actorId !== 'local-owner')
      throw lifecycleForbidden(
        'Hosted implementation handoff approval requires a bounded session.',
      );
  } else {
    const expiry = new Date(actor.sessionExpiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= new Date(at).getTime())
      throw lifecycleForbidden('The implementation handoff approval session has expired.');
  }
  return Object.freeze({ actorId, role: actor.role, capability });
}

export function implementationHandoffApprovalPaths(root) {
  const base = implementationHandoffPaths(root);
  return Object.freeze({
    ...base,
    events: join(base.directory, 'events'),
    journal: join(base.directory, 'lifecycle-publication.json'),
  });
}

function archivePaths(root, value) {
  const directory = join(implementationHandoffPaths(root).history, packageKey(value));
  return {
    directory,
    json: join(directory, 'handoff.json'),
    markdown: join(directory, 'handoff.md'),
  };
}

function eventPath(root, requestId) {
  return join(implementationHandoffApprovalPaths(root).events, `${requestKey(requestId)}.json`);
}

function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

function readExistingRequest(root, signature) {
  const existing = readJson(eventPath(root, signature.requestId), null);
  if (!existing) return null;
  if (canonicalizeJson(existing.signature) !== canonicalizeJson(signature))
    throw lifecycleConflict(
      'This implementation handoff request identity was already used for different input.',
    );
  return existing;
}

function pointerFor(value, status, eventId, extra = {}) {
  return {
    kind: 'openplanr-design-implementation-handoff-current',
    schemaVersion: '1.0.0',
    id: value.id,
    version: value.version,
    contentDigest: value.contentDigest,
    status,
    authority: 'prepare-plan',
    eventId,
    ...extra,
  };
}

function writeLifecycleJournal(root, journal) {
  const paths = implementationHandoffApprovalPaths(root);
  if (existsSync(paths.journal)) recoverImplementationHandoffApproval(root);
  atomicText(paths.journal, jsonBytes(journal));
  return recoverImplementationHandoffApproval(root);
}

/** Complete one interrupted immutable-version/event/pointer publication idempotently. */
export function recoverImplementationHandoffApproval(root) {
  const paths = implementationHandoffApprovalPaths(root);
  if (!existsSync(paths.journal)) return false;
  const journal = readJson(paths.journal);
  if (
    journal.kind !== 'openplanr-design-implementation-handoff-lifecycle-publication' ||
    journal.schemaVersion !== '1.0.0'
  )
    throw new TypeError('The implementation handoff lifecycle journal is invalid.');
  if (journal.archive) {
    const value = assertImplementationHandoffProjection(journal.archive);
    if (value.status !== 'approved')
      throw new TypeError('Only approved packages belong in immutable history.');
    const archive = archivePaths(root, value);
    immutableText(archive.json, jsonBytes(value));
    immutableText(archive.markdown, value.markdown);
  }
  immutableText(eventPath(root, journal.event.requestId), jsonBytes(journal.event));
  atomicText(paths.current, jsonBytes(journal.pointer));
  rmSync(paths.journal, { force: true });
  return true;
}

export function readImplementationHandoffVersion(root, identity) {
  recoverImplementationHandoffApproval(root);
  const matches = listImplementationHandoffHistory(root).filter(
    (value) =>
      value.id === identity.id &&
      value.version === identity.version &&
      (identity.contentDigest === undefined || value.contentDigest === identity.contentDigest),
  );
  if (matches.length !== 1)
    throw lifecycleConflict(
      matches.length
        ? 'Implementation handoff version identity is ambiguous.'
        : 'Implementation handoff version was not found.',
    );
  return matches[0];
}

export function listImplementationHandoffHistory(root) {
  recoverImplementationHandoffApproval(root);
  const directory = implementationHandoffPaths(root).history;
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      assertImplementationHandoffProjection(readJson(join(directory, entry.name, 'handoff.json'))),
    )
    .sort((left, right) => left.version - right.version || left.id.localeCompare(right.id));
}

export function readImplementationHandoffLifecycle(root) {
  recoverImplementationHandoffApproval(root);
  const paths = implementationHandoffApprovalPaths(root);
  const current = readJson(paths.current, null);
  const events = existsSync(paths.events)
    ? readdirSync(paths.events)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readJson(join(paths.events, name)))
        .sort(
          (left, right) =>
            left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId),
        )
    : [];
  return Object.freeze({ current, history: listImplementationHandoffHistory(root), events });
}

/** User-facing approval effect plus the opaque optimistic-concurrency request. */
export function previewImplementationHandoffApproval(root) {
  const draft = readImplementationHandoffDraft(root);
  const lifecycle = readImplementationHandoffLifecycle(root);
  if (!draft) return Object.freeze({ available: false, summary: null, approvalRequest: null });
  const alreadyCurrent =
    lifecycle.current?.status === 'approved' &&
    lifecycle.current.id === draft.id &&
    lifecycle.current.version === draft.version &&
    lifecycle.current.contentDigest === draft.contentDigest;
  return Object.freeze({
    available: draft.basis.readiness.status === 'ready' && !alreadyCurrent,
    summary: {
      title: draft.title,
      packageVersion: draft.version,
      selectedVariant: draft.basis.selectedVariant,
      requirementCount: draft.requirements.length,
      unresolvedNonblockingItems: 0,
      effect: 'Prepare Plan',
      description: 'Approve this reviewed design context for a later, separate Plan invocation.',
    },
    approvalRequest: {
      expectedVersion: draft.version,
      expectedContentDigest: draft.contentDigest,
    },
  });
}

function assertExpectedDraft(draft, request, currentBasis) {
  if (
    !Number.isInteger(request.expectedVersion) ||
    request.expectedVersion < 1 ||
    !DIGEST.test(request.expectedContentDigest ?? '')
  )
    throw new TypeError('Approval requires the expected draft version and content identity.');
  if (
    draft.version !== request.expectedVersion ||
    draft.contentDigest !== request.expectedContentDigest
  )
    throw lifecycleConflict(
      'The implementation package changed after it was loaded. Refresh before approving.',
    );
  if (currentBasis && canonicalizeJson(draft.basis) !== canonicalizeJson(currentBasis))
    throw lifecycleConflict(
      'The design basis changed after this implementation package was composed.',
    );
  if (draft.basis.readiness.status !== 'ready')
    throw lifecycleConflict('Only a ready implementation package can be approved.');
}

function assertUniqueVersion(root, value) {
  const existing = listImplementationHandoffHistory(root).find(
    (item) => item.id === value.id && item.version === value.version,
  );
  if (existing && existing.contentDigest !== value.contentDigest)
    throw lifecycleConflict(
      'This implementation handoff version already identifies different content.',
    );
  return existing;
}

export function approveImplementationHandoff(root, request, options = {}) {
  const requestId = normalizeRequestId(request?.requestId);
  const at = timestamp(options.clock);
  const actor = authorizeActor(options.actor, APPROVE_CAPABILITY, at);
  const signature = {
    operation: 'approve',
    requestId,
    expectedVersion: request.expectedVersion,
    expectedContentDigest: request.expectedContentDigest,
    actor,
  };
  const repeated = readExistingRequest(root, signature);
  if (repeated) {
    return {
      package: readImplementationHandoffVersion(root, repeated.package),
      current: readImplementationHandoffLifecycle(root).current,
      event: repeated,
      repeated: true,
    };
  }
  const draft = readImplementationHandoffDraft(root, { allowMissing: false });
  assertExpectedDraft(draft, request, options.currentBasis);
  if (options.resolveSource) verifyImplementationHandoffSources(draft, options.resolveSource);
  const approved = assertImplementationHandoffProjection({
    ...clone(draft),
    status: 'approved',
    approval: {
      actorId: actor.actorId,
      approvedAt: at,
      contentDigest: draft.contentDigest,
      authority: 'prepare-plan',
    },
  });
  const existing = assertUniqueVersion(root, approved);
  if (existing) {
    const lifecycle = readImplementationHandoffLifecycle(root);
    if (
      lifecycle.current?.status === 'approved' &&
      lifecycle.current.id === approved.id &&
      lifecycle.current.version === approved.version &&
      lifecycle.current.contentDigest === approved.contentDigest
    )
      return {
        package: existing,
        current: lifecycle.current,
        event:
          lifecycle.events.find(
            (item) =>
              item.type === 'approved' && item.package.contentDigest === approved.contentDigest,
          ) ?? null,
        repeated: true,
      };
    throw lifecycleConflict(
      'This immutable implementation handoff version already exists outside the current approval.',
    );
  }
  const eventId = `handoff-approved-${requestKey(requestId).slice(0, 24)}`;
  const event = {
    kind: 'openplanr-design-implementation-handoff-event',
    schemaVersion: '1.0.0',
    eventId,
    type: 'approved',
    requestId,
    signature,
    package: { id: approved.id, version: approved.version, contentDigest: approved.contentDigest },
    actor,
    at,
    authority: 'prepare-plan',
  };
  const pointer = pointerFor(approved, 'approved', eventId, { updatedAt: at });
  writeLifecycleJournal(root, {
    kind: 'openplanr-design-implementation-handoff-lifecycle-publication',
    schemaVersion: '1.0.0',
    archive: approved,
    event,
    pointer,
  });
  return { package: approved, current: pointer, event, repeated: false };
}

export function supersedeImplementationHandoff(root, replacement, request, options = {}) {
  const checked = assertImplementationHandoffProjection(clone(replacement));
  if (checked.status !== 'draft')
    throw new TypeError('A superseding package must still be a draft.');
  const requestId = normalizeRequestId(request?.requestId);
  const at = timestamp(options.clock);
  const actor = authorizeActor(options.actor, APPROVE_CAPABILITY, at);
  const lifecycle = readImplementationHandoffLifecycle(root);
  const currentIdentity = lifecycle.current && {
    id: lifecycle.current.id,
    version: lifecycle.current.version,
    contentDigest: lifecycle.current.contentDigest,
  };
  const signature = {
    operation: 'supersede',
    requestId,
    current: currentIdentity,
    replacement: { id: checked.id, version: checked.version, contentDigest: checked.contentDigest },
    actor,
  };
  const repeated = readExistingRequest(root, signature);
  if (repeated)
    return {
      current: readImplementationHandoffLifecycle(root).current,
      event: repeated,
      repeated: true,
    };
  if (!lifecycle.current || lifecycle.current.status !== 'approved') return null;
  if (
    lifecycle.current.id === checked.id &&
    lifecycle.current.version === checked.version &&
    lifecycle.current.contentDigest === checked.contentDigest
  )
    return null;
  if (checked.version <= lifecycle.current.version)
    throw lifecycleConflict('A regenerated implementation package must use a newer version.');
  const eventId = `handoff-superseded-${requestKey(requestId).slice(0, 24)}`;
  const event = {
    kind: 'openplanr-design-implementation-handoff-event',
    schemaVersion: '1.0.0',
    eventId,
    type: 'superseded',
    requestId,
    signature,
    package: signature.current,
    supersededBy: signature.replacement,
    actor,
    at,
    authority: 'prepare-plan',
  };
  const prior = readImplementationHandoffVersion(root, signature.current);
  const pointer = pointerFor(prior, 'superseded', eventId, {
    supersededBy: signature.replacement,
    updatedAt: at,
  });
  writeLifecycleJournal(root, {
    kind: 'openplanr-design-implementation-handoff-lifecycle-publication',
    schemaVersion: '1.0.0',
    event,
    pointer,
  });
  return { current: pointer, event, repeated: false };
}

export function regenerateImplementationHandoffDraft(root, input, request, options = {}) {
  const requestId = normalizeRequestId(request?.requestId);
  const existingEvent = readJson(eventPath(root, requestId), null);
  if (existingEvent) {
    const at = timestamp(options.clock);
    const actor = authorizeActor(options.actor, APPROVE_CAPABILITY, at);
    if (
      existingEvent.type !== 'superseded' ||
      existingEvent.requestId !== requestId ||
      canonicalizeJson(existingEvent.actor) !== canonicalizeJson(actor)
    )
      throw lifecycleConflict(
        'This implementation handoff request identity was already used for a different operation.',
      );
    const candidate = composeImplementationHandoff({
      ...input,
      version: existingEvent.supersededBy.version,
    });
    if (options.resolveSource) verifyImplementationHandoffSources(candidate, options.resolveSource);
    if (
      candidate.id !== existingEvent.supersededBy.id ||
      candidate.contentDigest !== existingEvent.supersededBy.contentDigest
    )
      throw lifecycleConflict(
        'This regeneration request identity was already used for different package content.',
      );
    const draft = readImplementationHandoffDraft(root, { allowMissing: false });
    if (
      draft.id !== candidate.id ||
      draft.version !== candidate.version ||
      draft.contentDigest !== candidate.contentDigest
    )
      throw lifecycleConflict('The regenerated draft no longer matches this completed request.');
    return {
      draft,
      supersession: {
        current: readImplementationHandoffLifecycle(root).current,
        event: existingEvent,
        repeated: true,
      },
    };
  }
  const lifecycle = readImplementationHandoffLifecycle(root);
  const currentDraft = readImplementationHandoffDraft(root);
  const maximum = Math.max(
    0,
    currentDraft?.version ?? 0,
    ...lifecycle.history.map((item) => item.version),
  );
  const draft = writeImplementationHandoffDraft(
    root,
    { ...input, version: maximum + 1 },
    { resolveSource: options.resolveSource },
  );
  const supersession = supersedeImplementationHandoff(root, draft, { requestId }, options);
  return { draft, supersession };
}

export function revokeImplementationHandoff(root, request, options = {}) {
  const requestId = normalizeRequestId(request.requestId);
  const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
  if (!reason || Buffer.byteLength(reason) > MAX_REASON_BYTES)
    throw new TypeError('Revocation requires a concise reason.');
  const at = timestamp(options.clock);
  const actor = authorizeActor(options.actor, REVOKE_CAPABILITY, at);
  const signature = {
    operation: 'revoke',
    requestId,
    expectedVersion: request.expectedVersion,
    expectedContentDigest: request.expectedContentDigest,
    reason,
    actor,
  };
  const repeated = readExistingRequest(root, signature);
  if (repeated)
    return {
      current: readImplementationHandoffLifecycle(root).current,
      event: repeated,
      repeated: true,
    };
  const lifecycle = readImplementationHandoffLifecycle(root);
  if (!lifecycle.current || lifecycle.current.status !== 'approved')
    throw lifecycleConflict('There is no current approved implementation package to revoke.');
  if (
    request?.expectedVersion !== lifecycle.current.version ||
    request?.expectedContentDigest !== lifecycle.current.contentDigest
  )
    throw lifecycleConflict('The current implementation package changed before revocation.');
  const approved = readImplementationHandoffVersion(root, lifecycle.current);
  const eventId = `handoff-revoked-${requestKey(requestId).slice(0, 24)}`;
  const event = {
    kind: 'openplanr-design-implementation-handoff-event',
    schemaVersion: '1.0.0',
    eventId,
    type: 'revoked',
    requestId,
    signature,
    package: { id: approved.id, version: approved.version, contentDigest: approved.contentDigest },
    actor,
    at,
    reason,
    authority: 'prepare-plan',
  };
  const pointer = pointerFor(approved, 'revoked', eventId, {
    revocation: { actorId: actor.actorId, revokedAt: at, reason },
    updatedAt: at,
  });
  writeLifecycleJournal(root, {
    kind: 'openplanr-design-implementation-handoff-lifecycle-publication',
    schemaVersion: '1.0.0',
    event,
    pointer,
  });
  return { current: pointer, event, repeated: false };
}

export function compareImplementationHandoffVersions(root, leftIdentity, rightIdentity) {
  const resolveValue = (identity) =>
    identity === 'draft'
      ? readImplementationHandoffDraft(root, { allowMissing: false })
      : readImplementationHandoffVersion(root, identity);
  const left = resolveValue(leftIdentity);
  const right = resolveValue(rightIdentity);
  const sourceIds = (value) => new Set(value.sources.map((item) => item.id));
  const requirementIds = (value) => new Set(value.requirements.map((item) => item.id));
  const difference = (before, after) => ({
    added: [...after].filter((id) => !before.has(id)).sort(),
    removed: [...before].filter((id) => !after.has(id)).sort(),
  });
  return Object.freeze({
    left: { id: left.id, version: left.version, contentDigest: left.contentDigest },
    right: { id: right.id, version: right.version, contentDigest: right.contentDigest },
    changed: left.contentDigest !== right.contentDigest,
    basisChanged: canonicalizeJson(left.basis) !== canonicalizeJson(right.basis),
    titleChanged: left.title !== right.title,
    sources: difference(sourceIds(left), sourceIds(right)),
    requirements: difference(requirementIds(left), requirementIds(right)),
  });
}

export const IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY = APPROVE_CAPABILITY;
export const IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY = REVOKE_CAPABILITY;
