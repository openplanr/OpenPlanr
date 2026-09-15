import { defineConnectorAdapterV2 } from '../connector-registry.js';

export const linearJiraLiveEvidenceAdapterV2 = defineConnectorAdapterV2({
  adapterId: 'openplanr-linear-jira-live-evidence',
  adapterVersion: '1.0.0',
  provider: { id: 'linear-jira-work', version: '1.0.0' },
  category: 'work',
  operations: [
    {
      operation: 'jira-issues',
      collection: 'jiraIssues',
      sourceContracts: ['planning-acceptance', 'prior-decisions'],
    },
    {
      operation: 'linear-issues',
      collection: 'linearIssues',
      sourceContracts: ['planning-acceptance', 'prior-decisions'],
    },
  ],
  supportedDomains: ['business', 'software'],
  scopes: ['issues:read', 'projects:read'],
  allowedMethods: ['GET'],
  transport: 'https-or-loopback',
  healthMaxAgeSeconds: 300,
  unavailableBehavior: 'typed-absence',
});
