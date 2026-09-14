// Protocol 1.6 grows by additive contract families. Keep each family explicit,
// then expose one aggregate map to schema resolvers and browser consumers.
export const SKILL_SOURCE_V16_CONTRACT_FILES = Object.freeze({
  'generated-asset-manifest': 'generated-asset-manifest.schema.json',
  'skill-catalog': 'skill-catalog.schema.json',
  'skill-completion-receipt': 'skill-completion-receipt.schema.json',
  'skill-consent-record': 'skill-consent-record.schema.json',
  'skill-host-profile-registry': 'skill-host-profile-registry.schema.json',
  'skill-learning-record': 'skill-learning-record.schema.json',
  'skill-module-registry': 'skill-module-registry.schema.json',
  'skill-routing-registry': 'skill-routing-registry.schema.json',
  'skill-session': 'skill-session.schema.json',
  'skill-source': 'skill-source.schema.json',
});

export const DIAGRAM_V16_CONTRACT_FILES = Object.freeze({
  'diagram-consumer-reference': 'diagram-consumer-reference.schema.json',
  'diagram-document': 'diagram-document.schema.json',
  'diagram-fidelity-report': 'diagram-fidelity-report.schema.json',
  'diagram-manifest': 'diagram-manifest.schema.json',
  'diagram-quality-report': 'diagram-quality-report.schema.json',
  'diagram-review-binding': 'diagram-review-binding.schema.json',
  'diagram-semantic-pattern-registry': 'diagram-semantic-pattern-registry.schema.json',
  'diagram-type-registry': 'diagram-type-registry.schema.json',
});

export const PROTOCOL_V16_CONTRACT_FILES = Object.freeze({
  ...SKILL_SOURCE_V16_CONTRACT_FILES,
  ...DIAGRAM_V16_CONTRACT_FILES,
});

export const SKILL_SOURCE_V17_CONTRACT_FILES = SKILL_SOURCE_V16_CONTRACT_FILES;

export const PLANNING_V17_CONTRACT_FILES = Object.freeze({
  'planning-id-sequence': 'planning-id-sequence.schema.json',
  'request-authority': 'request-authority.schema.json',
  spec: 'spec.schema.json',
  story: 'story.schema.json',
  task: 'task.schema.json',
});

export const PROTOCOL_V17_CONTRACT_FILES = Object.freeze({
  ...SKILL_SOURCE_V17_CONTRACT_FILES,
  ...PLANNING_V17_CONTRACT_FILES,
});

export const SKILL_PACKAGE_V18_CONTRACT_FILES = Object.freeze({
  'skill-package': 'skill-package.schema.json',
  'utility-command-catalog': 'utility-command-catalog.schema.json',
});

export const PROTOCOL_V18_CONTRACT_FILES = SKILL_PACKAGE_V18_CONTRACT_FILES;

// Canonical classification for the additive registries stored in the shared
// registries/ directory. Projection, preservation, and ecosystem generators
// derive version custody from this descriptor instead of owning filename lists.
export const SKILL_SOURCE_V16_REGISTRIES = Object.freeze({
  'skill-host-profiles.json': Object.freeze({
    kind: 'skill-host-profile-registry',
    protocolVersion: '1.6.0',
    schemaVersion: '1.1.0',
    documentVersion: '1.1.0',
  }),
  'skill-modules.json': Object.freeze({
    kind: 'skill-module-registry',
    protocolVersion: '1.6.0',
    schemaVersion: '1.0.0',
    documentVersion: '1.0.0',
  }),
  'skill-routing.json': Object.freeze({
    kind: 'skill-routing-registry',
    protocolVersion: '1.6.0',
    schemaVersion: '1.0.0',
    documentVersion: '1.0.0',
  }),
});

export const DIAGRAM_V16_REGISTRIES = Object.freeze({
  'diagram-grammars.json': Object.freeze({
    kind: 'diagram-type-registry',
    protocolVersion: '1.6.0',
    schemaVersion: '1.0.0',
    documentVersion: '1.0.0',
  }),
  'diagram-semantic-patterns.json': Object.freeze({
    kind: 'diagram-semantic-pattern-registry',
    protocolVersion: '1.6.0',
    schemaVersion: '1.0.0',
    documentVersion: '1.0.0',
  }),
});

export const PROTOCOL_V16_REGISTRIES = Object.freeze({
  ...SKILL_SOURCE_V16_REGISTRIES,
  ...DIAGRAM_V16_REGISTRIES,
});

export const SKILL_SOURCE_V17_REGISTRIES = Object.freeze(Object.fromEntries(
  Object.entries(SKILL_SOURCE_V16_REGISTRIES).map(([file, descriptor]) => [file, Object.freeze({
    ...descriptor,
    protocolVersion: '1.7.0',
  })]),
));

export const PROTOCOL_V17_REGISTRIES = SKILL_SOURCE_V17_REGISTRIES;
