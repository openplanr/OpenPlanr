import { ProtocolError } from './errors.mjs';
import { CANONICAL_REGISTRIES, resolveTaskKind } from './registries.mjs';

const diagnostic = (code, path, message) => ({ code, path, message });
const pathKey = ({ repositoryKey, path }) => `${repositoryKey}:${path}`;

export function validateTaskManifestSemantics(
  value,
  {
    roles = CANONICAL_REGISTRIES['roles.json'],
    taskKinds = CANONICAL_REGISTRIES['task-kinds.json'],
  } = {},
) {
  const diagnostics = [];
  const binding = taskKinds.bindings.find(({ taskKind }) => taskKind === value?.routing?.taskKind);
  if (!binding || binding.roleId !== value?.routing?.roleId) {
    diagnostics.push(
      diagnostic(
        'E_TASK_KIND_ROLE_MISMATCH',
        '$.routing',
        'taskKind and roleId must match one canonical task-kind binding.',
      ),
    );
  }
  if (
    value?.routing?.taskKindRegistryDigest !== taskKinds.documentDigest ||
    value?.routing?.roleRegistryDigest !== roles.documentDigest
  ) {
    diagnostics.push(
      diagnostic(
        'E_TASK_REGISTRY_BINDING_MISMATCH',
        '$.routing',
        'routing must bind the exact canonical task-kind and role registry digests.',
      ),
    );
  }
  const role = roles.roles.find(({ roleId }) => roleId === value?.routing?.roleId);
  if (!role || role.roleVersion !== value?.routing?.roleVersion) {
    diagnostics.push(
      diagnostic(
        'E_TASK_ROLE_VERSION_MISMATCH',
        '$.routing.roleVersion',
        'role version is not present in the bound registry.',
      ),
    );
  }
  const scopeSets = new Map();
  for (const scope of ['create', 'modify', 'preserve']) {
    for (const entry of value?.scope?.[scope] ?? []) {
      const key = pathKey(entry);
      const previous = scopeSets.get(key);
      if (previous)
        diagnostics.push(
          diagnostic(
            'E_TASK_SCOPE_OVERLAP',
            `$.scope.${scope}`,
            `${key} is already declared in ${previous}.`,
          ),
        );
      scopeSets.set(key, scope);
    }
  }
  if (
    !value?.reviewBinding?.planDigest ||
    !value?.reviewBinding?.planningReviewReceiptDigest ||
    !value?.reviewBinding?.ownerDecisionDigest
  ) {
    diagnostics.push(
      diagnostic(
        'E_TASK_REVIEW_BINDING_REQUIRED',
        '$.reviewBinding',
        'DEV task issuance requires plan, review-receipt, and owner-decision digests.',
      ),
    );
  }
  return diagnostics;
}

export function assertTaskManifestSemantics(value, options) {
  const diagnostics = validateTaskManifestSemantics(value, options);
  if (diagnostics.length)
    throw new ProtocolError(diagnostics[0].code, diagnostics[0].message, '', { diagnostics });
  return value;
}

export function validateTaskGraph(values) {
  const diagnostics = [];
  const byId = new Map(values.map((value) => [value?.task?.taskId, value]));
  if (byId.size !== values.length || byId.has(undefined))
    diagnostics.push(
      diagnostic('E_TASK_GRAPH_DUPLICATE', '$', 'Task graph IDs must be present and unique.'),
    );
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      diagnostics.push(
        diagnostic('E_TASK_GRAPH_CYCLE', '$.dependencies', `Task dependency cycle includes ${id}.`),
      );
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (!byId.has(dependency.taskId))
        diagnostics.push(
          diagnostic(
            'E_TASK_DEPENDENCY_MISSING',
            '$.dependencies',
            `Unknown dependency ${dependency.taskId}.`,
          ),
        );
      else visit(dependency.taskId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) if (id !== undefined) visit(id);
  return diagnostics;
}

export function countR2Tasks(values) {
  return values.reduce((count, value) => {
    try {
      return count + (resolveTaskKind(value.routing.taskKind).countsTowardR2 ? 1 : 0);
    } catch {
      return count;
    }
  }, 0);
}

export function validateTaskOutputSemantics(value, { taskManifest } = {}) {
  const diagnostics = [];
  if (taskManifest) {
    if (
      value?.taskBinding?.taskManifestId !== taskManifest.taskManifestId ||
      value?.taskBinding?.taskManifestDigest !== taskManifest.documentDigest
    ) {
      diagnostics.push(
        diagnostic(
          'E_TASK_OUTPUT_BINDING_MISMATCH',
          '$.taskBinding',
          'Task output must bind the exact issued task manifest.',
        ),
      );
    }
    if (
      value?.roleBinding?.roleId !== taskManifest.routing.roleId ||
      value?.roleBinding?.roleVersion !== taskManifest.routing.roleVersion ||
      value?.roleBinding?.registryDigest !== taskManifest.routing.roleRegistryDigest
    ) {
      diagnostics.push(
        diagnostic(
          'E_TASK_OUTPUT_ROLE_MISMATCH',
          '$.roleBinding',
          'Task output role binding must equal issued routing.',
        ),
      );
    }
    const allowed = new Set(
      [...taskManifest.scope.create, ...taskManifest.scope.modify].map(pathKey),
    );
    const preserved = new Map(taskManifest.scope.preserve.map((entry) => [pathKey(entry), entry]));
    for (const change of value?.changes ?? []) {
      const key = pathKey(change);
      if (!allowed.has(key))
        diagnostics.push(
          diagnostic('E_TASK_OUTPUT_SCOPE_ESCAPE', '$.changes', `${key} is outside Create/Modify.`),
        );
      if (preserved.has(key))
        diagnostics.push(
          diagnostic('E_TASK_OUTPUT_PRESERVE_CHANGED', '$.changes', `${key} intersects Preserve.`),
        );
    }
    const verification = new Map(
      (value?.preserveVerification ?? []).map((entry) => [pathKey(entry), entry]),
    );
    if (
      verification.size !== preserved.size ||
      [...preserved.keys()].some((key) => !verification.has(key))
    ) {
      diagnostics.push(
        diagnostic(
          'E_TASK_OUTPUT_PRESERVE_COVERAGE',
          '$.preserveVerification',
          'Preserve verification must bijectively cover the issued Preserve set.',
        ),
      );
    }
    for (const [key, entry] of verification) {
      if (
        !preserved.has(key) ||
        entry.beforeDigest !== entry.afterDigest ||
        entry.unchanged !== true
      ) {
        diagnostics.push(
          diagnostic(
            'E_TASK_OUTPUT_PRESERVE_CHANGED',
            '$.preserveVerification',
            `${key} is not digest-equal.`,
          ),
        );
      }
    }
  }
  if (value?.roleBinding?.roleId === 'planr-qa' && (value?.changes?.length ?? 0) > 0) {
    diagnostics.push(
      diagnostic(
        'E_TASK_OUTPUT_QA_WRITE',
        '$.changes',
        'QA is read-only and cannot report changed files.',
      ),
    );
  }
  if ((value?.externalEffects?.length ?? 0) > 0) {
    diagnostics.push(
      diagnostic(
        'E_TASK_OUTPUT_EXTERNAL_EFFECT',
        '$.externalEffects',
        'Protocol 1.5 task outputs permit no external effects.',
      ),
    );
  }
  const failedCommand = (value?.commandEvidence ?? []).some(({ status }) => status === 'failed');
  const failedAcceptance = (value?.acceptanceEvidence ?? []).some(
    ({ result }) => result !== 'passed',
  );
  const errorDiagnostic = (value?.diagnostics ?? []).some(({ severity }) => severity === 'error');
  if (
    value?.outcome === 'completed' &&
    (value.errorHandoff !== null || failedCommand || failedAcceptance || errorDiagnostic)
  ) {
    diagnostics.push(
      diagnostic(
        'E_TASK_OUTPUT_COMPLETED_INVALID',
        '$.outcome',
        'Completed output cannot retain failed evidence, error diagnostics, or an error handoff.',
      ),
    );
  }
  if (value?.outcome === 'blocked' && (!value.errorHandoff || !errorDiagnostic)) {
    diagnostics.push(
      diagnostic(
        'E_TASK_OUTPUT_BLOCKED_HANDOFF_REQUIRED',
        '$.errorHandoff',
        'Blocked output requires an error diagnostic and bound error handoff.',
      ),
    );
  }
  return diagnostics;
}

export function assertTaskOutputSemantics(value, options) {
  const diagnostics = validateTaskOutputSemantics(value, options);
  if (diagnostics.length)
    throw new ProtocolError(diagnostics[0].code, diagnostics[0].message, '', { diagnostics });
  return value;
}
