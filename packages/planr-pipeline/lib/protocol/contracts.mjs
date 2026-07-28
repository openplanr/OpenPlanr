import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import { PipelineError } from '../pipeline/errors.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const paths = {
  'pipeline-shipped': { '1.0.0': 'schemas/v1.0.0/pipeline-shipped.schema.json' },
  'run-manifest': { '1.0.0': 'schemas/v1.0.0/run-manifest.schema.json' },
  'runtime-lock': { '1.1.0': 'schemas/v1.1.0/runtime-lock.schema.json' },
  'provenance-event': { '1.1.0': 'schemas/v1.1.0/provenance-event.schema.json' },
  'adapter-registry': {
    '1.1.0': 'schemas/v1.1.0/adapter-registry.schema.json',
    '1.2.0': 'schemas/v1.2.0/adapter-registry.schema.json',
  },
  'ecosystem-manifest': { '1.1.0': 'schemas/v1.1.0/ecosystem-manifest.schema.json' },
  'artifact-envelope': { '1.1.0': 'schemas/v1.1.0/artifact-envelope.schema.json' },
  'artifact-review': { '1.1.0': 'schemas/v1.1.0/artifact-review.schema.json' },
  'artifact-paste': { '1.1.0': 'schemas/v1.1.0/artifact-paste.schema.json' },
  'artifact-room-event': { '1.1.0': 'schemas/v1.1.0/artifact-room-event.schema.json' },
  'operating-role-registry': { '1.2.0': 'schemas/v1.2.0/operating-role-registry.schema.json' },
  'operating-provider-registry': { '1.2.0': 'schemas/v1.2.0/operating-provider-registry.schema.json' },
  'operating-config': { '1.2.0': 'schemas/v1.2.0/operating-config.schema.json' },
  'operating-cycle-manifest': { '1.2.0': 'schemas/v1.2.0/operating-cycle-manifest.schema.json' },
  'operating-state': { '1.2.0': 'schemas/v1.2.0/operating-state.schema.json' },
  'operating-evidence': { '1.2.0': 'schemas/v1.2.0/operating-evidence.schema.json' },
  'operating-role-result': { '1.2.0': 'schemas/v1.2.0/operating-role-result.schema.json' },
  'operating-finding': { '1.2.0': 'schemas/v1.2.0/operating-finding.schema.json' },
  'operating-decision': { '1.2.0': 'schemas/v1.2.0/operating-decision.schema.json' },
  'operating-data-gap': { '1.2.0': 'schemas/v1.2.0/operating-data-gap.schema.json' },
  'operating-route-plan': { '1.2.0': 'schemas/v1.2.0/operating-route-plan.schema.json' },
  'operating-event': { '1.2.0': 'schemas/v1.2.0/operating-event.schema.json' },
  'operating-outcome': { '1.2.0': 'schemas/v1.2.0/operating-outcome.schema.json' },
  'operating-spec-link': { '1.2.0': 'schemas/v1.2.0/operating-spec-link.schema.json' },
  'operating-checkpoint': { '1.2.0': 'schemas/v1.2.0/operating-checkpoint.schema.json' },
  'operating-workspace-manifest': { '1.2.0': 'schemas/v1.2.0/operating-workspace-manifest.schema.json' },
  'operating-record': { '1.2.0': 'schemas/v1.2.0/operating-record.schema.json' },
  'operating-transaction-journal': { '1.2.0': 'schemas/v1.2.0/operating-transaction-journal.schema.json' },
  'operating-artifact-session': { '1.2.0': 'schemas/v1.2.0/operating-artifact-session.schema.json' },
  'operating-provider-manifest': { '1.2.0': 'schemas/v1.2.0/operating-provider-manifest.schema.json' },
  'operating-evidence-readiness': { '1.2.0': 'schemas/v1.2.0/operating-evidence-readiness.schema.json' },
  'operating-outcome-observation': { '1.2.0': 'schemas/v1.2.0/operating-outcome-observation.schema.json' },
  'operating-migration-record': { '1.2.0': 'schemas/v1.2.0/operating-migration-record.schema.json' },
  'operating-recovery-record': { '1.2.0': 'schemas/v1.2.0/operating-recovery-record.schema.json' },
  'ecosystem-saga': { '1.2.0': 'schemas/v1.2.0/ecosystem-saga.schema.json' },
  'ecosystem-release-operation': { '1.2.0': 'schemas/v1.2.0/ecosystem-release-operation.schema.json' },
};

export const PROTOCOL_SCHEMA_REGISTRY = Object.freeze(Object.fromEntries(
  Object.entries(paths).map(([kind, versions]) => [kind, Object.freeze({ ...versions })]),
));

const schemaCache = new Map();
const canonicalSchemaPrefix = 'https://openplanr.dev/';

function loadSchema(path) {
  if (!schemaCache.has(path)) {
    schemaCache.set(path, JSON.parse(readFileSync(join(packageRoot, path), 'utf8')));
  }
  return schemaCache.get(path);
}

function referencedSchemaPath(basePath, reference) {
  const referenceWithoutFragment = reference.split('#', 1)[0];
  const requested = referenceWithoutFragment.startsWith(canonicalSchemaPrefix)
    ? referenceWithoutFragment.slice(canonicalSchemaPrefix.length)
    : join(dirname(basePath), referenceWithoutFragment);
  const absolute = resolve(packageRoot, requested);
  // `relative` yields platform separators, so normalize to POSIX before any
  // containment check. On Windows the raw value is `schemas\v1.2.0\...`, which
  // both fails the `schemas/` prefix test and hides `\..\` from the traversal
  // guard — the check has to be separator-independent to be either correct or
  // safe.
  const packageRelative = relative(packageRoot, absolute).split(sep).join('/');
  if (
    packageRelative.startsWith('..')
    || packageRelative.includes('/../')
    || !packageRelative.startsWith('schemas/')
  ) {
    throw new PipelineError(
      'E_SCHEMA_REFERENCE_UNSAFE',
      `Schema reference "${reference}" escapes the packaged schema directory.`,
    );
  }
  return packageRelative;
}

function inferredVersion(kind, value, explicitVersion) {
  if (explicitVersion) return explicitVersion;
  if (typeof value?.protocolVersion === 'string') return value.protocolVersion;
  const versions = Object.keys(PROTOCOL_SCHEMA_REGISTRY[kind] ?? {});
  if (versions.length === 1) return versions[0];
  throw new PipelineError(
    'E_SCHEMA_VERSION_REQUIRED',
    `Protocol artifact "${kind}" supports multiple versions; pass protocolVersion explicitly.`,
  );
}

export function listProtocolSchemas() {
  return Object.entries(PROTOCOL_SCHEMA_REGISTRY).flatMap(([kind, versions]) => (
    Object.entries(versions).map(([protocolVersion, path]) => ({ kind, protocolVersion, path }))
  ));
}

export function resolveProtocolSchema(kind, { protocolVersion } = {}) {
  const versions = PROTOCOL_SCHEMA_REGISTRY[kind];
  if (!versions) throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown protocol artifact kind: ${kind}`);
  const path = versions[protocolVersion];
  if (!path) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      `Protocol artifact "${kind}" does not support version ${protocolVersion}.`,
      `Supported versions: ${Object.keys(versions).join(', ')}.`,
    );
  }
  return { kind, protocolVersion, path, schema: structuredClone(loadSchema(path)) };
}

export function validateProtocolArtifact(kind, value, { protocolVersion } = {}) {
  const version = inferredVersion(kind, value, protocolVersion);
  const resolved = resolveProtocolSchema(kind, { protocolVersion: version });
  return validateJson(value, resolved.schema, {
    base: resolved.path,
    resolveRef(reference, { base } = {}) {
      const path = referencedSchemaPath(
        typeof base === 'string' && !base.startsWith('https://') ? base : resolved.path,
        reference,
      );
      const schema = structuredClone(loadSchema(path));
      return { schema, rootSchema: schema, base: path };
    },
  });
}

export function assertProtocolArtifact(kind, value, options) {
  const errors = validateProtocolArtifact(kind, value, options);
  if (errors.length) {
    throw new PipelineError(
      'E_PROTOCOL_ARTIFACT_INVALID',
      `${kind}: ${errors[0].path} ${errors[0].detail}`,
    );
  }
  return value;
}

function readRegistry(name) {
  return JSON.parse(readFileSync(join(packageRoot, 'registry', name), 'utf8'));
}

function assertUniqueIds(kind, records) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new PipelineError(
        'E_REGISTRY_DUPLICATE_ID',
        `${kind} contains duplicate ID "${record.id}".`,
      );
    }
    seen.add(record.id);
  }
}

export function listOperatingRoles() {
  const registry = readRegistry('operating-roles.json');
  assertProtocolArtifact('operating-role-registry', registry);
  assertUniqueIds('Operating role registry', registry.roles);
  return structuredClone(registry.roles);
}

export function listOperatingProviders() {
  const registry = readRegistry('operating-providers.json');
  assertProtocolArtifact('operating-provider-registry', registry);
  assertUniqueIds('Operating provider registry', registry.providers);
  return structuredClone(registry.providers);
}
