import { sha256CanonicalJson } from '../../canonical-json.js';
import { defineConnectorAdapterV2 } from '../connector-registry.js';

export const deploymentHealthLiveEvidenceAdapterV2 = defineConnectorAdapterV2({
  adapterId: 'openplanr-deployment-health-live-evidence',
  adapterVersion: '1.0.0',
  provider: { id: 'deployment-health', version: '1.0.0' },
  category: 'deployment',
  operations: [
    {
      operation: 'canary',
      collection: 'canary',
      sourceContracts: ['ci-test-evidence', 'operations-customer-health'],
    },
    {
      operation: 'health',
      collection: 'health',
      sourceContracts: ['ci-test-evidence', 'operations-customer-health'],
    },
  ],
  supportedDomains: ['business', 'software'],
  scopes: ['deployments:read', 'health:read'],
  allowedMethods: ['GET'],
  transport: 'https-or-loopback',
  healthMaxAgeSeconds: 120,
  unavailableBehavior: 'typed-absence',
});

export type DeploymentCommandDescriptorV2 = Readonly<{
  kind: 'openplanr-deployment-command-descriptor';
  schemaVersion: '1.0.0';
  descriptorId: string;
  targetIdentityHash: `sha256:${string}`;
  operation: 'deploy' | 'rollback';
  commandDigest: `sha256:${string}`;
  effect: 'descriptor-only';
  previewOnly: true;
  descriptorHash: `sha256:${string}`;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

/** Validates a non-authoritative command descriptor. It never executes or resolves command bytes. */
export function assertDeploymentCommandDescriptorV2(value: unknown): DeploymentCommandDescriptorV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Deployment descriptor must be one closed object.');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expected = [
    'commandDigest',
    'descriptorHash',
    'descriptorId',
    'effect',
    'kind',
    'operation',
    'previewOnly',
    'schemaVersion',
    'targetIdentityHash',
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new TypeError('Deployment descriptor has missing or unsupported fields.');
  }
  if (
    input.kind !== 'openplanr-deployment-command-descriptor' ||
    input.schemaVersion !== '1.0.0' ||
    typeof input.descriptorId !== 'string' ||
    !ID.test(input.descriptorId) ||
    !HASH.test(String(input.targetIdentityHash)) ||
    !['deploy', 'rollback'].includes(String(input.operation)) ||
    !HASH.test(String(input.commandDigest)) ||
    input.effect !== 'descriptor-only' ||
    input.previewOnly !== true
  ) {
    throw new TypeError('Deployment descriptor violates the descriptor-only contract.');
  }
  const { descriptorHash, ...body } = input;
  if (descriptorHash !== sha256CanonicalJson(body)) {
    throw new TypeError('Deployment descriptor digest does not match its exact bytes.');
  }
  return Object.freeze(structuredClone(input)) as DeploymentCommandDescriptorV2;
}
