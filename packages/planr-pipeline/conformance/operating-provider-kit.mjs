import { assertProtocolArtifact } from '../lib/protocol/contracts.mjs';
import { canonicalizeJson, sha256Jcs } from '../lib/protocol/jcs.mjs';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function byteLength(value) {
  return Buffer.byteLength(canonicalizeJson(value), 'utf8');
}

function conformanceFailure(check, detail) {
  return { check, ok: false, detail };
}

export function validateOperatingProviderDefinition(definition, providerRegistry) {
  const registered = providerRegistry.providers.find((provider) => provider.id === definition.id);
  if (!registered) return [conformanceFailure('registered', `Provider ${definition.id} is not registered.`)];
  const failures = [];
  if (definition.readOnly !== true) failures.push(conformanceFailure('read-only', 'Provider must declare readOnly: true.'));
  if (definition.version !== registered.version) failures.push(conformanceFailure('version', `Expected ${registered.version}, got ${definition.version}.`));
  if (canonicalizeJson(definition) !== canonicalizeJson(registered)) {
    failures.push(conformanceFailure('definition', 'Provider definition differs from the canonical registry entry.'));
  }
  return failures;
}

/**
 * Provider conformance interface:
 *   definition: one registry-shaped provider definition
 *   collect(context): Promise<Protocol v1.2 operating-evidence>
 *
 * The kit runs the collector twice against a deeply frozen fixture, validates
 * both outputs, requires byte-identical JCS output, and enforces declared item
 * and byte ceilings. I/O isolation itself remains a runtime/fixture obligation;
 * this portable kit never grants a write-capable context or credentials.
 */
export async function runOperatingProviderConformance({
  definition,
  providerRegistry,
  collect,
  fixtureContext,
}) {
  assertProtocolArtifact('operating-provider-registry', providerRegistry);
  const failures = validateOperatingProviderDefinition(definition, providerRegistry);
  if (typeof collect !== 'function') failures.push(conformanceFailure('interface', 'Provider must expose collect(context).'));
  if (failures.length) return { ok: false, providerId: definition.id, failures };

  const context = deepFreeze(structuredClone(fixtureContext));
  let first;
  let second;
  try {
    first = await collect(context);
    second = await collect(context);
  } catch (error) {
    return {
      ok: false,
      providerId: definition.id,
      failures: [conformanceFailure('collect', String(error?.message ?? error))],
    };
  }

  for (const [label, bundle] of [['first', first], ['second', second]]) {
    try {
      assertProtocolArtifact('operating-evidence', bundle);
    } catch (error) {
      failures.push(conformanceFailure(`${label}-schema`, error.message));
      continue;
    }
    if (!bundle.sources.some((source) => source.id === definition.id)) {
      failures.push(conformanceFailure(`${label}-attribution`, `Bundle does not attribute source ${definition.id}.`));
    }
    if (bundle.items.length > definition.limits.maxItems) {
      failures.push(conformanceFailure(`${label}-items`, `Bundle has ${bundle.items.length} items; limit is ${definition.limits.maxItems}.`));
    }
    const bytes = byteLength(bundle);
    if (bytes > definition.limits.maxBytes) {
      failures.push(conformanceFailure(`${label}-bytes`, `Bundle is ${bytes} bytes; limit is ${definition.limits.maxBytes}.`));
    }
  }
  if (failures.length === 0 && canonicalizeJson(first) !== canonicalizeJson(second)) {
    failures.push(conformanceFailure('determinism', 'Repeated collection produced different canonical output.'));
  }

  return {
    ok: failures.length === 0,
    providerId: definition.id,
    outputDigest: failures.length === 0 ? sha256Jcs(first) : null,
    failures,
  };
}
