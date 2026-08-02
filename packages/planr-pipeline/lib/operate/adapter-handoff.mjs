import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { listRuntimeAdapters, normalizeRuntime } from '../pipeline/runtime.mjs';
import { createMissionToolGrant } from './mission-packet.mjs';

const ADVISOR_RESPONSE_SCHEMA =
  'https://openplanr.dev/schemas/v1.2.0/operating-advisor-response.schema.json';
const ADVISOR_RESPONSE_SCHEMA_V13 =
  'https://openplanr.dev/schemas/v1.3.0/operating-advisor-response.schema.json';
const ADVISOR_RESPONSE_SCHEMA_V14 =
  'https://openplanr.dev/schemas/v1.4.0/operating-advisor-response.schema.json';

function fail(detail) {
  throw new PipelineError(
    'E_PROTOCOL_ARTIFACT_INVALID',
    `operating-adapter-handoff: ${detail}`,
  );
}

function adapterEnforcesBoundedReadOnly(runtime) {
  const id = normalizeRuntime(runtime);
  const adapter = listRuntimeAdapters().find((entry) => entry.id === id);
  // Protocol v1.3 compatibility only: that contract encoded enforced isolation
  // as its dispatch gate. Protocol v1.4 uses runtime-governed native execution
  // and records this value as assurance metadata rather than support policy.
  return adapter?.capabilities?.toolIsolation === 'enforced';
}

function runtimeAdapter(runtime) {
  const id = normalizeRuntime(runtime);
  const adapter = listRuntimeAdapters().find((entry) => entry.id === id);
  if (!adapter?.capabilities?.operatingBoard) {
    throw new PipelineError(
      'E_RUNTIME_UNSUPPORTED',
      `Runtime ${String(runtime)} does not provide an Operating Board adapter.`,
    );
  }
  return adapter;
}

function mandateDispatch(binding, roleId, protocolVersion) {
  if (protocolVersion === '1.4.0') {
    return {
      source: 'harness.prepare-result',
      agent: `operating-${roleId}`,
      mandatePointer: `/data/mandates/${roleId}`,
      procedurePointer: `/data/mandates/${roleId}/procedure`,
      runtime: binding.runtime,
      executionMode: binding.executionMode,
      assurance: binding.assurance,
      toolIsolation: binding.toolIsolation,
      permissionAuthority: 'runtime-session',
    };
  }
  return {
    source: 'adapter.prepare-result',
    // Name the generated lens agent (`agents/operating/<roleId>.md`) a runtime
    // must dispatch for this mandate record action, and point at the role's
    // operating mandate. The mandate carries the lens question, the read
    // boundaries, and the citation requirement — no evidence body, no evidence
    // index. Evidence becomes an output resolved from the returned citations.
    agent: `operating-${roleId}`,
    mandatePointer: `/data/mandates/${roleId}`,
    // The concrete read roots are declared in the referenced mandate's
    // boundaries; the dispatch declares the canonical read-only tool policy and
    // defers roots to that mandate, so an empty grant here confines to nothing
    // rather than widening access.
    declaredRoots: [],
    toolGrant: createMissionToolGrant([]),
    // Frozen Protocol v1.3 behavior. New v1.4 handoffs use the branch above and
    // support advisory runtimes through output verification.
    isolation: adapterEnforcesBoundedReadOnly(binding.runtime)
      ? 'enforced-read-only-bounded'
      : 'unsupported',
  };
}

function lifecycleArgv(binding, action, role, protocolVersion) {
  const namespace = protocolVersion === '1.4.0' ? 'harness' : 'adapter';
  return [
    'planr',
    'operate',
    namespace,
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

function prepareAction(binding, roles, protocolVersion) {
  const namespace = protocolVersion === '1.4.0' ? 'harness' : 'adapter';
  return {
    id: `${namespace}.prepare`,
    action: `${namespace}.prepare`,
    effect: 'machine-local-write',
    argv: [
      'planr',
      'operate',
      namespace,
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
  if (protocolVersion === '1.4.0') {
    return {
      id: `harness.record.${roleId}`,
      action: 'harness.record',
      effect: 'machine-local-write',
      role: roleId,
      argv: lifecycleArgv(binding, 'record', roleId, protocolVersion),
      dispatch: mandateDispatch(binding, roleId, protocolVersion),
      stdin: {
        kind: 'stdin-json',
        mediaType: 'application/json',
        encoding: 'utf-8',
        maxBytes: 262144,
        schema: ADVISOR_RESPONSE_SCHEMA_V14,
        schemaSource: 'harness.prepare-result',
        schemaPointer: `/data/mandates/${roleId}/responseSchema`,
      },
    };
  }
  if (protocolVersion === '1.3.0') {
    return {
      id: `adapter.record.${roleId}`,
      action: 'adapter.record',
      effect: 'machine-local-write',
      role: roleId,
      argv: lifecycleArgv(binding, 'record', roleId, protocolVersion),
      dispatch: mandateDispatch(binding, roleId, protocolVersion),
      stdin: {
        kind: 'stdin-json',
        mediaType: 'application/json',
        encoding: 'utf-8',
        maxBytes: 32768,
        schema: ADVISOR_RESPONSE_SCHEMA_V13,
        schemaSource: 'adapter.prepare-result',
        schemaPointer: `/data/mandates/${roleId}/role/output/schema`,
      },
    };
  }
  return {
    id: `adapter.record.${roleId}`,
    action: 'adapter.record',
    effect: 'machine-local-write',
    role: roleId,
    argv: lifecycleArgv(binding, 'record', roleId, protocolVersion),
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

function boundAction(binding, action, effect, protocolVersion) {
  const namespace = protocolVersion === '1.4.0' ? 'harness' : 'adapter';
  return {
    id: `${namespace}.${action}`,
    action: `${namespace}.${action}`,
    effect,
    argv: lifecycleArgv(binding, action, undefined, protocolVersion),
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
        next: [prepareAction(value.binding, value.roles, value.protocolVersion)],
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
          boundAction(value.binding, 'resume', 'read-only', value.protocolVersion),
          boundAction(value.binding, 'cancel', 'machine-local-write', value.protocolVersion),
        ],
      };
    case 'finalize-required':
      return {
        next: [boundAction(value.binding, 'finalize', 'project-write', value.protocolVersion)],
        recovery: [
          boundAction(value.binding, 'resume', 'read-only', value.protocolVersion),
          boundAction(value.binding, 'cancel', 'machine-local-write', value.protocolVersion),
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
  if (value.phase === 'bootstrap' && (roleIds.length !== 1 || roleIds[0] !== 'bootstrap')) {
    fail('the bootstrap phase must contain only the bootstrap role');
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
  const protocolVersion = input.protocolVersion ?? '1.2.0';
  const adapter = protocolVersion === '1.4.0' ? runtimeAdapter(input.runtime) : null;
  const value = {
    kind: 'operating-adapter-handoff',
    schemaVersion: protocolVersion === '1.4.0' ? '1.1.0' : '1.0.0',
    protocolVersion,
    phase: input.phase,
    state: input.state,
    binding: {
      cycleId: input.cycleId,
      evidenceDigest: input.evidenceDigest,
      runtime: protocolVersion === '1.4.0' ? adapter.id : input.runtime,
      ...(protocolVersion === '1.4.0' ? {
        runtimeBinding: 'required',
        crossRuntimeFallback: false,
        executionMode: input.executionMode
          ?? (adapter.capabilities.operatingAdvisorDispatch === 'sequential-native'
            ? 'sequential-native'
            : 'native-agent'),
        assurance: 'runtime-governed',
        toolIsolation: adapter.capabilities.toolIsolation,
      } : {}),
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
