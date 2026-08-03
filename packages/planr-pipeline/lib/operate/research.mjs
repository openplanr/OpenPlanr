import { PipelineError } from '../pipeline/errors.mjs';
import { listRuntimeAdapters, normalizeRuntime } from '../pipeline/runtime.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

const FORBIDDEN_EFFECTS = Object.freeze([
  'write-workspace',
  'network-without-consent',
  'deploy',
  'publish',
  'spend',
  'customer-contact',
  'credential-change',
  'destructive-data',
  'plan',
  'ship',
]);

function adapterFor(runtime) {
  const id = normalizeRuntime(runtime);
  const adapter = listRuntimeAdapters().find((entry) => entry.id === id);
  if (!adapter?.capabilities?.operatingBoard) {
    throw new PipelineError(
      'E_RUNTIME_UNSUPPORTED',
      `Runtime ${String(runtime)} does not provide an Operating Board workflow.`,
    );
  }
  return adapter;
}

export function createOperatingRuntimeBinding(runtime, { executionMode } = {}) {
  const adapter = adapterFor(runtime);
  const binding = {
    runtime: adapter.id,
    runtimeBinding: 'required',
    crossRuntimeFallback: false,
    executionMode: executionMode
      ?? (adapter.capabilities.operatingAdvisorDispatch === 'sequential-native'
        ? 'sequential-native'
        : 'native-agent'),
    assurance: 'runtime-governed',
    toolIsolation: adapter.capabilities.toolIsolation,
  };
  return assertProtocolArtifact('operating-runtime-binding', binding, {
    protocolVersion: '1.4.0',
  });
}

export function assertOperatingRuntimeMatch(binding, runtime) {
  assertProtocolArtifact('operating-runtime-binding', binding, {
    protocolVersion: '1.4.0',
  });
  const selected = adapterFor(runtime).id;
  if (binding.runtime !== selected) {
    throw new PipelineError(
      'E_OPERATE_RUNTIME_MISMATCH',
      `Cycle is bound to ${binding.runtime}; ${selected} cannot continue it.`,
      'Create a new cycle or use the explicit runtime migration action.',
    );
  }
  return binding;
}

export function createOperatingResearchMandate(input) {
  const unsigned = {
    kind: 'operating-research-mandate',
    schemaVersion: '1.0.0',
    protocolVersion: '1.4.0',
    cycleId: input.cycleId,
    runtimeBinding: createOperatingRuntimeBinding(input.runtime, {
      executionMode: input.executionMode,
    }),
    researchMode: input.researchMode ?? 'local',
    connectedResearchConsentDigest: input.connectedResearchConsentDigest ?? null,
    focus: [...new Set(input.focus?.length ? input.focus : ['all'])].sort(),
    roots: [...new Set(input.roots?.length ? input.roots : ['.'])].sort(),
    forbiddenEffects: [...FORBIDDEN_EFFECTS],
    outputSchema: 'operating-context-claim@1.4.0',
  };
  if (unsigned.researchMode === 'connected' && !unsigned.connectedResearchConsentDigest) {
    throw new PipelineError(
      'E_OPERATE_CONNECTED_RESEARCH_CONSENT_REQUIRED',
      'Connected research requires an explicit digest-bound consent preview.',
    );
  }
  const mandate = { ...unsigned, mandateDigest: sha256Jcs(unsigned) };
  return assertProtocolArtifact('operating-research-mandate', mandate, {
    protocolVersion: '1.4.0',
  });
}

export function validateOperatingContextClaims(claims) {
  if (!Array.isArray(claims)) {
    throw new PipelineError('E_OPERATE_CONTEXT_INVALID', 'Operating context claims must be an array.');
  }
  const ids = new Set();
  for (const claim of claims) {
    assertProtocolArtifact('operating-context-claim', claim, { protocolVersion: '1.4.0' });
    if (ids.has(claim.id)) {
      throw new PipelineError('E_OPERATE_CONTEXT_INVALID', `Duplicate context claim ${claim.id}.`);
    }
    ids.add(claim.id);
    if (claim.epistemicStatus !== 'unknown' && claim.citations.length === 0) {
      throw new PipelineError(
        'E_OPERATE_CONTEXT_CITATION_REQUIRED',
        `Context claim ${claim.id} must cite its research or be marked unknown.`,
      );
    }
  }
  return claims;
}

export function validateAgentNativeAdvisorResponse(response) {
  return assertProtocolArtifact('operating-advisor-response', response, {
    protocolVersion: '1.4.0',
  });
}
