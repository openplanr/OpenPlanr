import { resolveLocalOperateArtifactEvidenceV2 } from './evidence-artifact-v2.mjs';
import { resolveLocalFilesystemEvidenceV2 } from './evidence-filesystem-v2.mjs';
import { resolveLocalGitEvidenceV2 } from './evidence-git-v2.mjs';
import { resolveLocalPlanrEvidenceV2 } from './evidence-planr-v2.mjs';
import {
  createOperateEvidenceRegistryV2,
  findOperateEvidenceProviderRegistrationV2,
  findOperateEvidenceResolverRegistrationV2,
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  OperatingEvidenceRegistryErrorV2,
  prepareOperateEvidenceDispatchV2,
} from './evidence-registry-v2.mjs';

const unavailable = (selection) =>
  Object.freeze({
    status: 'unavailable',
    provider: selection.provider,
    resolver: selection.resolver,
    error: Object.freeze({
      code: 'EVIDENCE_RESOLVER_UNAVAILABLE',
      retryable: true,
      context: Object.freeze({
        evidenceKind: selection.resolver.supportedEvidenceKinds[0],
        resolverId: selection.resolver.resolverId,
      }),
    }),
  });

/**
 * This is a deliberately closed dispatch table. It contains no registration
 * callbacks, dynamic imports, external implementations, or connected source
 * fallback. Only explicit local read-only implementations are executable.
 */
const BUILT_IN_EVIDENCE_RESOLVER_DISPATCH_V2 = Object.freeze(
  Object.fromEntries(
    OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.map((registration) => [
      registration.implementation.id,
      {
        'operate-evidence-filesystem-resolver-v2': resolveLocalFilesystemEvidenceV2,
        'operate-evidence-git-resolver-v2': resolveLocalGitEvidenceV2,
        'operate-evidence-planr-resolver-v2': resolveLocalPlanrEvidenceV2,
        'operate-evidence-artifact-resolver-v2': resolveLocalOperateArtifactEvidenceV2,
      }[registration.implementation.id] ?? unavailable,
    ]),
  ),
);

function hasStaticSourceConfiguration(resolver, context) {
  if (resolver.implementation.id === 'operate-evidence-git-resolver-v2') {
    return Object.hasOwn(context, 'gitRepositories') || context.sources?.git !== undefined;
  }
  if (resolver.implementation.id === 'operate-evidence-filesystem-resolver-v2') {
    return Object.hasOwn(context, 'filesystemRoots') || context.sources?.filesystem !== undefined;
  }
  if (resolver.implementation.id === 'operate-evidence-planr-resolver-v2') {
    return Object.hasOwn(context, 'planrProjects') || context.sources?.planr !== undefined;
  }
  if (resolver.implementation.id === 'operate-evidence-artifact-resolver-v2') {
    return (
      Object.hasOwn(context, 'operateArtifacts') ||
      context.sources?.['operate-artifact'] !== undefined
    );
  }
  return true;
}

/**
 * Dispatches only a registry-selected built-in resolver. Resolver output is a
 * local immutable byte capture or a safe rejection. Dispatch itself creates no
 * EvidenceRef, Artifact, Event, graph edge, projection, or replay state.
 */
export function dispatchOperateEvidenceResolverV2(registry, candidate, context = {}) {
  const selection = prepareOperateEvidenceDispatchV2(registry, candidate, context);
  if (selection.status === 'rejected') return selection;
  const resolver = BUILT_IN_EVIDENCE_RESOLVER_DISPATCH_V2[selection.resolver.implementation.id];
  if (typeof resolver !== 'function') {
    return Object.freeze({
      status: 'unavailable',
      provider: selection.provider,
      resolver: selection.resolver,
      error: Object.freeze({
        code: 'EVIDENCE_RESOLVER_UNAVAILABLE',
        retryable: true,
        context: Object.freeze({
          evidenceKind: candidate.evidenceKind,
          resolverId: selection.resolver.resolverId,
        }),
      }),
    });
  }
  if (!hasStaticSourceConfiguration(selection.resolver, context)) return unavailable(selection);
  return resolver(candidate, {
    ...context,
    provider: selection.provider,
    resolver: selection.resolver,
  });
}

export {
  createOperateEvidenceRegistryV2,
  findOperateEvidenceProviderRegistrationV2,
  findOperateEvidenceResolverRegistrationV2,
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  OperatingEvidenceRegistryErrorV2,
  prepareOperateEvidenceDispatchV2,
  resolveLocalFilesystemEvidenceV2,
  resolveLocalGitEvidenceV2,
  resolveLocalOperateArtifactEvidenceV2,
  resolveLocalPlanrEvidenceV2,
};
