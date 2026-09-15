import { defineConnectorAdapterV2 } from '../connector-registry.js';

export const sentryLiveEvidenceAdapterV2 = defineConnectorAdapterV2({
  adapterId: 'openplanr-sentry-live-evidence',
  adapterVersion: '1.0.0',
  provider: { id: 'sentry-error', version: '1.0.0' },
  category: 'error',
  operations: [
    {
      operation: 'errors',
      collection: 'errors',
      sourceContracts: ['incident-history', 'support-incidents'],
    },
    {
      operation: 'issues',
      collection: 'issues',
      sourceContracts: ['incident-history', 'support-incidents'],
    },
    {
      operation: 'releases',
      collection: 'releases',
      sourceContracts: ['incident-history', 'support-incidents'],
    },
  ],
  supportedDomains: ['software'],
  scopes: ['issues:read', 'org:read', 'project:read', 'releases:read'],
  allowedMethods: ['GET'],
  transport: 'https-or-loopback',
  healthMaxAgeSeconds: 300,
  unavailableBehavior: 'typed-absence',
});
