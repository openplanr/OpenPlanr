// Generated from registry/operate-v2-contracts.json. Do not edit.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const INTELLIGENCE_MANDATE_CEILING_V2 = deepFreeze({
  allowedCapabilities: ['artifact.read', 'artifact.submit'],
  forbiddenEffects: [
    'customer-contact',
    'governed-execution',
    'payment.change',
    'production.deploy',
    'publish',
    'repository.write',
    'ship',
    'spend',
  ],
  capabilityCeiling: 'read-only',
});
export const BUSINESS_DOMAIN_ROLE_MANDATES_V2 = deepFreeze({
  chair: {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: [
      'terminal selected advisor Artifacts',
      'Challenger Artifact',
      'typed absences',
    ],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope:
      'Evidence-bound synthesis. Carry missing, abandoned, and conflicting work as gaps. Propose Decisions and Actions without approval or execution authority.',
    skillId: 'planr-chair-review',
  },
  'growth-market': {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: ['Snapshot', 'Delta', 'market and demand evidence refs in scope'],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope: 'Market, positioning, acquisition, growth loops, and demand evidence.',
    skillId: 'planr-cmo-review',
  },
  'independent-challenge': {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: ['selected advisor Artifacts', 'the same Snapshot and Delta'],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope:
      'Test accepted executive Artifacts for unsupported claims, conflict, missing alternatives, unpriced downside, and unjustified confidence.',
    skillId: 'planr-challenger-review',
  },
  'operations-customer': {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: ['Snapshot', 'Delta', 'operations and customer-health evidence refs in scope'],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope: 'Operations, service delivery, customer health, capacity, and execution readiness.',
    skillId: 'planr-coo-review',
  },
  'product-activation': {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: [
      'Snapshot',
      'Delta',
      'product and activation evidence refs',
      'planning artifacts in scope',
    ],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope:
      'Product value, customer activation, retention, discovery, backlog value ordering, and acceptance-criteria quality.',
    skillId: 'planr-cpo-review',
  },
  'strategy-finance': {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: [
      'Snapshot',
      'Delta',
      'operating state',
      'bounded market and finance evidence refs in scope',
    ],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope: 'Strategy, company direction, capital allocation, and financial viability.',
    skillId: 'planr-ceo-review',
  },
  'technology-risk': {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: [
      'Snapshot',
      'Delta',
      'repository, architecture, CI, and security evidence refs in scope',
    ],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope: 'Technology leverage, architecture, security, delivery risk, and technical constraints.',
    skillId: 'planr-cto-review',
  },
});
export const SOFTWARE_DOMAIN_ROLE_MANDATES_V2 = deepFreeze({
  advisor: {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: ['Snapshot', 'Delta', 'operating state', 'in-scope evidence refs'],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope:
      'Analyze the validated Delta and immutable snapshot within the declared read and output ceilings.',
    skillId: 'operate-advisor',
  },
  chair: {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: ['terminal advisor Artifacts', 'Challenger Artifact', 'typed absences'],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope:
      'Synthesize only validated selected-role results and explicit permitted absences into the declared output contract.',
    skillId: 'planr-chair-review',
  },
  challenger: {
    allowedCapabilities: ['artifact.read', 'artifact.submit'],
    allowedEvidence: ['selected advisor Artifacts', 'the same Snapshot and Delta'],
    capabilityCeiling: 'read-only',
    forbiddenEffects: [
      'customer-contact',
      'governed-execution',
      'payment.change',
      'production.deploy',
      'publish',
      'repository.write',
      'ship',
      'spend',
    ],
    scope:
      'Challenge validated analysis for unsupported assumptions, conflict, missing alternatives, downside, reversibility, and overconfidence.',
    skillId: 'planr-challenger-review',
  },
});
export const DOMAIN_ROLE_MANDATES_V2 = deepFreeze({
  business: BUSINESS_DOMAIN_ROLE_MANDATES_V2,
  software: SOFTWARE_DOMAIN_ROLE_MANDATES_V2,
});
