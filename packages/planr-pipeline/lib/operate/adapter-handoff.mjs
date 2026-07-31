import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact, listOperatingRoles } from '../protocol/contracts.mjs';
import { listRuntimeAdapters, normalizeRuntime } from '../pipeline/runtime.mjs';
import { createMissionToolGrant } from './mission-packet.mjs';

const ADVISOR_RESPONSE_SCHEMA =
  'https://openplanr.dev/schemas/v1.2.0/operating-advisor-response.schema.json';
const ADVISOR_RESPONSE_SCHEMA_V13 =
  'https://openplanr.dev/schemas/v1.3.0/operating-advisor-response.schema.json';

function fail(detail) {
  throw new PipelineError(
    'E_PROTOCOL_ARTIFACT_INVALID',
    `operating-adapter-handoff: ${detail}`,
  );
}

function adapterEnforcesBoundedReadOnly(runtime) {
  const id = normalizeRuntime(runtime);
  const adapter = listRuntimeAdapters().find((entry) => entry.id === id);
  // Only a runtime that natively enforces tool isolation can guarantee the
  // bounded read-only boundary (FR2). Every other runtime must fail closed to
  // the structured provider path. The existing `enforced` capability already
  // distinguishes the native-read-only adapter from the advisory ones, so the
  // classification is derived from the published registry rather than a new
  // field the v1.2/v1.3 registry schemas cannot carry.
  return adapter?.capabilities?.toolIsolation === 'enforced';
}

function roleDispatchMode(roleId) {
  // dispatchMode is a v1.3 role-registry field (FR10). While the registry is
  // still published at v1.2 it is absent, so a mission-model v1.3 handoff
  // defaults to 'mission'; a role explicitly marked 'pack' fails closed.
  const role = listOperatingRoles().find((entry) => entry.id === roleId);
  return role?.dispatchMode ?? 'mission';
}

function missionDispatch(binding, roleId) {
  const bounded = roleDispatchMode(roleId) === 'mission'
    && adapterEnforcesBoundedReadOnly(binding.runtime);
  return {
    source: 'adapter.prepare-result',
    missionPacketPointer: `/data/missionPackets/${roleId}`,
    // The concrete read roots are bound in the referenced mission packet; the
    // dispatch declares the canonical read-only tool policy and defers roots to
    // that packet, so an empty grant here confines to nothing rather than
    // widening access.
    declaredRoots: [],
    toolGrant: createMissionToolGrant([]),
    isolation: bounded ? 'enforced-read-only-bounded' : 'fail-closed-structured-provider',
  };
}

function lifecycleArgv(binding, action, role) {
  return [
    'planr',
    'operate',
    'adapter',
    action,
    ...(role ? ['--role', role] : []),
    '--cycle-id',
    binding.cycleId,
    '--evidence-digest',
    binding.evidenceDigest,
    ...(binding.lease ? ['--lease', binding.lease] : []),
    '--idempotency-key',
    binding.idempotencyKey,
    ...(action === 'record' ? ['--stdin'] : []),
    '--json',
  ];
}

function prepareAction(binding, roles) {
  return {
    id: 'adapter.prepare',
    action: 'adapter.prepare',
    effect: 'machine-local-write',
    argv: [
      'planr',
      'operate',
      'adapter',
      'prepare',
      '--cycle-id',
      binding.cycleId,
      '--evidence-digest',
      binding.evidenceDigest,
      '--idempotency-key',
      binding.idempotencyKey,
      '--role',
      roles.map(({ roleId }) => roleId).join(','),
      '--json',
    ],
  };
}

function recordAction(binding, roleId, protocolVersion) {
  if (protocolVersion === '1.3.0') {
    return {
      id: `adapter.record.${roleId}`,
      action: 'adapter.record',
      effect: 'machine-local-write',
      role: roleId,
      argv: lifecycleArgv(binding, 'record', roleId),
      dispatch: missionDispatch(binding, roleId),
      stdin: {
        kind: 'stdin-json',
        mediaType: 'application/json',
        encoding: 'utf-8',
        maxBytes: 32768,
        schema: ADVISOR_RESPONSE_SCHEMA_V13,
        schemaSource: 'adapter.prepare-result',
        schemaPointer: `/data/missionPackets/${roleId}/role/output/schema`,
      },
    };
  }
  return {
    id: `adapter.record.${roleId}`,
    action: 'adapter.record',
    effect: 'machine-local-write',
    role: roleId,
    argv: lifecycleArgv(binding, 'record', roleId),
    dispatch: {
      source: 'adapter.prepare-result',
      rolePackPointer: `/data/rolePacks/${roleId}`,
      isolation: 'enforced-empty-tools',
    },
    stdin: {
      kind: 'stdin-json',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 32768,
      schema: ADVISOR_RESPONSE_SCHEMA,
      schemaSource: 'adapter.prepare-result',
      schemaPointer: `/data/rolePacks/${roleId}/roleBrief/output/jsonSchema`,
    },
  };
}

function boundAction(binding, action, effect) {
  return {
    id: `adapter.${action}`,
    action: `adapter.${action}`,
    effect,
    argv: lifecycleArgv(binding, action),
  };
}

function continueAction(binding) {
  return {
    id: 'run.continue',
    action: 'run.continue',
    effect: 'project-write',
    argv: [
      'planr',
      'operate',
      'run',
      '--cycle-id',
      binding.cycleId,
      '--runtime',
      binding.runtime,
      '--json',
    ],
  };
}

function expectedActions(value) {
  const pending = value.roles.filter(({ status }) => status === 'pending');
  switch (value.state) {
    case 'prepare-required':
      return {
        next: [prepareAction(value.binding, value.roles)],
        recovery: [],
      };
    case 'record-required':
      return {
        // Role inference may be parallel, but adapter.record mutates one shared,
        // lease-bound session. Authorize one pending role at a time so runtimes
        // cannot race session snapshots or lose an already recorded role.
        next: pending.length > 0
          ? [recordAction(value.binding, pending[0].roleId, value.protocolVersion)]
          : [],
        recovery: [
          boundAction(value.binding, 'resume', 'read-only'),
          boundAction(value.binding, 'cancel', 'machine-local-write'),
        ],
      };
    case 'finalize-required':
      return {
        next: [boundAction(value.binding, 'finalize', 'project-write')],
        recovery: [
          boundAction(value.binding, 'resume', 'read-only'),
          boundAction(value.binding, 'cancel', 'machine-local-write'),
        ],
      };
    case 'continue-required':
      return {
        next: [continueAction(value.binding)],
        recovery: [],
      };
    case 'cancelled':
      return { next: [], recovery: [] };
    default:
      fail(`unknown state ${String(value.state)}`);
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Enforce the state/action and exact-binding semantics that JSON Schema cannot
 * express. The artifact is transient, but every command is capability-bearing
 * and must remain byte-for-byte bound to its root lifecycle fields.
 */
export function validateOperatingAdapterHandoffBindings(value) {
  assertProtocolArtifact('operating-adapter-handoff', value);
  const roleIds = value.roles.map(({ roleId }) => roleId);
  if (new Set(roleIds).size !== roleIds.length) fail('roles must be unique');
  if (value.phase === 'chair' && (roleIds.length !== 1 || roleIds[0] !== 'chair')) {
    fail('the chair phase must contain only the chair role');
  }
  if (value.phase === 'advisors' && roleIds.includes('chair')) {
    fail('the advisors phase cannot contain the chair role');
  }

  const statuses = value.roles.map(({ status }) => status);
  const hasLease = typeof value.binding.lease === 'string';
  const hasExpiry = typeof value.binding.expiresAt === 'string';
  if (value.state === 'prepare-required') {
    if (hasLease || hasExpiry || statuses.some((status) => status !== 'awaiting-prepare')) {
      fail('prepare-required must have null lease/expiry and only awaiting-prepare roles');
    }
    if (value.roles.some(({ inputDigest }) => inputDigest !== null)) {
      fail('prepare-required roles cannot expose input digests');
    }
  } else {
    if (!hasLease || !hasExpiry) fail(`${value.state} requires a lease and expiry`);
    if (statuses.includes('awaiting-prepare')) {
      fail(`${value.state} cannot contain awaiting-prepare roles`);
    }
  }
  if (value.state === 'record-required' && !statuses.includes('pending')) {
    fail('record-required needs at least one pending role');
  }
  if (
    ['finalize-required', 'continue-required'].includes(value.state) &&
    statuses.some((status) => status !== 'recorded')
  ) {
    fail(`${value.state} requires every role to be recorded`);
  }
  if (
    value.state !== 'prepare-required' &&
    value.roles.some(({ inputDigest }) => inputDigest === null)
  ) {
    fail(`${value.state} requires every role input digest`);
  }

  const expected = expectedActions(value);
  if (!same(value.next, expected.next)) fail('next actions do not match the root binding and state');
  if (!same(value.recovery, expected.recovery)) {
    fail('recovery actions do not match the root binding and state');
  }
  return value;
}

/**
 * The sole canonical producer for the runtime-neutral adapter lifecycle handoff.
 */
export function createOperatingAdapterHandoff(input) {
  const value = {
    kind: 'operating-adapter-handoff',
    schemaVersion: '1.0.0',
    protocolVersion: input.protocolVersion ?? '1.2.0',
    phase: input.phase,
    state: input.state,
    binding: {
      cycleId: input.cycleId,
      evidenceDigest: input.evidenceDigest,
      runtime: input.runtime,
      idempotencyKey: input.idempotencyKey,
      lease: input.lease ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    roles: input.roles.map((role) => ({
      roleId: role.roleId,
      status: role.status,
      inputDigest: role.inputDigest ?? null,
    })),
    next: [],
    recovery: [],
  };
  const actions = expectedActions(value);
  value.next = actions.next;
  value.recovery = actions.recovery;
  return validateOperatingAdapterHandoffBindings(value);
}
