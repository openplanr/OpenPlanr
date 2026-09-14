import { defineConnectorAdapterV2 } from '../connector-registry.js';

export const githubLiveEvidenceAdapterV2 = defineConnectorAdapterV2({
  adapterId: 'openplanr-github-live-evidence',
  adapterVersion: '1.0.0',
  provider: { id: 'github-delivery', version: '1.0.0' },
  category: 'delivery',
  operations: [
    {
      operation: 'checks',
      collection: 'checks',
      sourceContracts: ['ci-test-evidence'],
    },
    {
      operation: 'pull-requests',
      collection: 'pullRequests',
      sourceContracts: ['repository-architecture'],
    },
    {
      operation: 'workflow-runs',
      collection: 'workflowRuns',
      sourceContracts: ['ci-test-evidence'],
    },
  ],
  supportedDomains: ['software'],
  scopes: ['actions:read', 'checks:read', 'contents:read', 'pull-requests:read'],
  allowedMethods: ['GET'],
  transport: 'https-or-loopback',
  healthMaxAgeSeconds: 300,
  unavailableBehavior: 'typed-absence',
});
