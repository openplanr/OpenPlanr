import { SkillRuntimeError } from '../errors.mjs';
import { HOST_SUBSTITUTIONS } from './render-primitives.mjs';

export const HOST_OVERLAY_POLICY = Object.freeze({
  version: '1.0.0',
  mode: 'typed-presentation-v1',
  allowedVariation: Object.freeze(['wording', 'tool-invocation']),
  protectedSemantics: Object.freeze(['workflow', 'outputs', 'capabilities', 'effects']),
});

/**
 * Host-specific prose is not composable behavior. Keep semantic modules shared
 * and express host wording or invocation syntax through compiler-owned tokens.
 */
function sameSet(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function sameAuthority(left, right) {
  return (
    left?.repositoryAccess === right?.repositoryAccess &&
    left?.externalDataAccess === right?.externalDataAccess &&
    [
      'allowedCapabilities',
      'allowedTools',
      'allowedOperations',
      'allowedOutputClasses',
      'forbiddenEffects',
    ].every((field) => sameSet(left?.[field], right?.[field]))
  );
}

function unsafe(hostProfile, overlay, reason) {
  const identity = overlay ? `${overlay.ref.moduleId}@${overlay.ref.moduleVersion}` : null;
  throw new SkillRuntimeError(
    'E_SKILL_HOST_OVERLAY_SEMANTICS_UNSAFE',
    `Host overlay ${identity ?? '<unknown>'} is not a typed presentation-only overlay.`,
    {
      hostProfileId: hostProfile?.hostProfileId ?? null,
      hostProfileVersion: hostProfile?.hostProfileVersion ?? null,
      overlay: identity,
      owner: overlay
        ? { kind: 'module', id: overlay.ref.moduleId, version: overlay.ref.moduleVersion }
        : undefined,
      path: overlay?.entry?.source?.path ?? 'host-profiles.json',
      reason,
      policy: HOST_OVERLAY_POLICY,
      repair:
        'Use a closed skill-host-presentation JSON document containing only compiler-owned host tokens and their exact values.',
    },
  );
}

function validateManifest(hostProfile, overlay, bytes) {
  let manifest;
  try {
    manifest = JSON.parse(bytes);
  } catch {
    unsafe(hostProfile, overlay, 'overlay-source-not-json');
  }
  const keys = Object.keys(manifest ?? {}).sort();
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    keys.join(',') !== 'host,kind,substitutions,version' ||
    manifest.kind !== 'skill-host-presentation' ||
    manifest.version !== '1.0.0' ||
    manifest.host !== hostProfile.host ||
    !manifest.substitutions ||
    typeof manifest.substitutions !== 'object' ||
    Array.isArray(manifest.substitutions)
  )
    unsafe(hostProfile, overlay, 'overlay-document-shape');

  const substitutions = Object.entries(manifest.substitutions);
  const allowed = HOST_SUBSTITUTIONS[hostProfile.host];
  if (
    substitutions.length === 0 ||
    substitutions.some(([token, value]) => {
      if (!Object.hasOwn(allowed, token) || typeof value !== 'string') return true;
      const variants =
        token === 'AGENTS_ROOT' ? [allowed[token], `\`${allowed[token]}\``] : [allowed[token]];
      return !variants.includes(value);
    })
  )
    unsafe(hostProfile, overlay, 'overlay-substitution-not-compiler-owned');
  return manifest;
}

export function assertHostOverlayIsPresentational(hostProfile, overlayModules = [], readSource) {
  if (!Array.isArray(overlayModules)) unsafe(hostProfile, null, 'overlay-selection-not-array');
  const substitutions = {};
  const sources = {};
  for (const overlay of overlayModules) {
    const entry = overlay?.entry;
    if (
      !entry ||
      entry.moduleKind !== 'shared' ||
      !entry.source?.path?.endsWith('.json') ||
      (entry.dependsOn?.length ?? 0) !== 0 ||
      (entry.references?.length ?? 0) !== 0 ||
      !sameAuthority(entry.authorityCeiling, hostProfile.authorityCeiling)
    )
      unsafe(hostProfile, overlay, 'overlay-module-can-carry-semantics');
    if (readSource) {
      const manifest = validateManifest(hostProfile, overlay, readSource(overlay));
      for (const [token, value] of Object.entries(manifest.substitutions)) {
        if (Object.hasOwn(substitutions, token))
          unsafe(hostProfile, overlay, 'overlay-substitution-duplicate');
        substitutions[token] = value;
        sources[token] = Object.freeze({
          path: entry.source.path,
          version: overlay.ref.moduleVersion,
          digest: entry.source.digest,
        });
      }
    }
  }
  return Object.freeze({
    policy: HOST_OVERLAY_POLICY,
    substitutions: Object.freeze(substitutions),
    sources: Object.freeze(sources),
  });
}
