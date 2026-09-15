import { defineConnectorAdapterV2 } from '../connector-registry.js';

export const posthogLiveEvidenceAdapterV2 = defineConnectorAdapterV2({
  adapterId: 'openplanr-posthog-live-evidence',
  adapterVersion: '1.0.0',
  provider: { id: 'posthog-product', version: '1.0.0' },
  category: 'product',
  operations: [
    {
      operation: 'events',
      collection: 'events',
      sourceContracts: ['product-activation'],
    },
    {
      operation: 'funnels',
      collection: 'funnels',
      sourceContracts: ['product-activation'],
    },
    {
      operation: 'retention',
      collection: 'retention',
      sourceContracts: ['retention-discovery'],
    },
  ],
  supportedDomains: ['business', 'product'],
  scopes: ['events:read', 'insights:read'],
  allowedMethods: ['GET'],
  transport: 'https-or-loopback',
  healthMaxAgeSeconds: 300,
  unavailableBehavior: 'typed-absence',
});
