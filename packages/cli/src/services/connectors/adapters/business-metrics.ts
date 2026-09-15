import { defineConnectorAdapterV2 } from '../connector-registry.js';

export const businessMetricsLiveEvidenceAdapterV2 = defineConnectorAdapterV2({
  adapterId: 'openplanr-business-metrics-live-evidence',
  adapterVersion: '1.0.0',
  provider: { id: 'business-metrics', version: '1.0.0' },
  category: 'business-metrics',
  operations: [
    {
      operation: 'csv',
      collection: 'csvRecords',
      sourceContracts: [
        'capacity-throughput',
        'channel-economics',
        'demand-market',
        'finance-metrics',
      ],
    },
    {
      operation: 'http',
      collection: 'httpRecords',
      sourceContracts: ['objective-metrics', 'operations-customer-health'],
    },
    {
      operation: 'json',
      collection: 'jsonRecords',
      sourceContracts: [
        'capacity-throughput',
        'channel-economics',
        'demand-market',
        'finance-metrics',
      ],
    },
  ],
  supportedDomains: ['business'],
  scopes: ['metrics:read'],
  allowedMethods: ['GET'],
  transport: 'https-or-loopback',
  healthMaxAgeSeconds: 300,
  unavailableBehavior: 'typed-absence',
});
