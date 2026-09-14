const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/**
 * Historical Operate Markdown contract.
 *
 * This remains available only so notes written by released 1.x guidance can be
 * identified and read. Canonical skills must use the current v2 contract below.
 */
export const OPERATE_REVIEW_NOTE_PROFILES_V1 = deepFreeze({
  advisor: {
    maxBytes: 16 * 1024,
    sections: [
      'Findings',
      'Recommended next move',
      'Decision-changing gaps',
      'Evidence index',
      'Review coverage',
      'Audit note',
    ],
    summaryFields: ['Signal', 'Bottom line'],
    summaryValues: {
      Signal: ['action', 'watch', 'insufficient evidence'],
    },
    item: {
      section: 'Findings',
      idPrefix: 'F',
      maxItems: 5,
      emptyText: 'No decision-relevant finding was established.',
      fields: [
        'Priority',
        'Status',
        'Why it matters',
        'Evidence',
        'Confidence',
        'Decision implication',
      ],
      fieldValues: {
        Priority: ['P0', 'P1', 'P2', 'unranked'],
        Status: ['observed', 'inferred'],
      },
    },
    sectionFields: {
      'Recommended next move': [
        'Recommendation',
        'Proposed owner',
        'First step',
        'Expected result',
        'Verification',
        'Reversible / revisit when',
        'Evidence',
      ],
      'Review coverage': [
        'Questions answered',
        'Questions not established',
        'Evidence boundary',
      ],
    },
    sectionEmptyStates: {
      'Recommended next move': 'No recommendation from current evidence.',
    },
    sectionItemLimits: {
      'Decision-changing gaps': 3,
    },
  },
  challenger: {
    maxBytes: 12 * 1024,
    sections: [
      'Material exceptions',
      'Decisions that still hold',
      'Material dissent',
      'Decision-changing gaps',
      'Audit note',
    ],
    summaryFields: ['Verdict', 'Bottom line'],
    summaryValues: {
      Verdict: ['holds', 'holds with exceptions', 'not decision-ready'],
    },
    item: {
      section: 'Material exceptions',
      idPrefix: 'X',
      maxItems: 5,
      emptyText: 'No material exception found.',
      fields: ['Target', 'Type', 'Decision impact', 'Challenge', 'Evidence', 'Resolution'],
      fieldValues: {
        Type: [
          'unsupported',
          'contradicted',
          'correlated reasoning',
          'missing alternative',
          'unpriced downside',
          'overconfident',
        ],
      },
    },
    sectionFields: {
      'Material dissent': ['Dissent', 'Resolution condition'],
    },
    sectionItemLimits: {
      'Decision-changing gaps': 3,
    },
  },
  chair: {
    maxBytes: 24 * 1024,
    sections: [
      'Decision queue',
      'Action plan',
      'Material risks and dissent',
      'Decision-changing gaps',
      'Review trail',
      'Evidence index',
      'Human gate',
    ],
    summaryFields: ['Overall signal', 'Executive call'],
    summaryValues: {
      'Overall signal': ['act now', 'decide next', 'watch', 'insufficient evidence'],
    },
    item: {
      section: 'Decision queue',
      idPrefix: 'D',
      maxItems: 5,
      emptyText: 'No decision-ready proposal was established.',
      headingSuffixPattern: /^\[(?:P0|P1|P2|unranked)\]\s+\S/u,
      fields: [
        'Recommendation',
        'Why now',
        'Owner',
        'Confidence',
        'Alternative',
        'First step',
        'Expected result',
        'Verification',
        'Dependencies',
        'Reversible / revisit when',
        'Evidence',
        'Dissent',
      ],
    },
    sectionFields: {},
    sectionItemLimits: {
      'Decision-changing gaps': 5,
    },
  },
  'board-report': {
    maxBytes: 24 * 1024,
    sections: [
      'Scope and custody',
      'Executive call',
      'Decision queue',
      'Action plan',
      'Material risks and dissent',
      'Decision-changing gaps',
      'Review trail',
      'Human gate',
    ],
    summaryFields: [],
    item: {
      section: 'Decision queue',
      idPrefix: 'D',
      maxItems: 5,
      emptyText: 'No decision-ready proposal was established.',
      headingSuffixPattern: /^\[(?:P0|P1|P2|unranked)\]\s+\S/u,
      fields: [
        'Recommendation',
        'Why now',
        'Owner',
        'Confidence',
        'Alternative',
        'First step',
        'Expected result',
        'Verification',
        'Dependencies',
        'Reversible / revisit when',
        'Evidence',
        'Dissent',
      ],
    },
    sectionFields: {
      'Scope and custody': ['Subject', 'Evidence window', 'Pending decision', 'Cycle owner', 'Custody'],
    },
    sectionItemLimits: {
      'Decision-changing gaps': 5,
    },
  },
});

export const OPERATE_REVIEW_NOTE_PROFILES = deepFreeze({
  advisor: {
    maxBytes: 16 * 1024,
    sections: [
      'Findings',
      'Recommended next move',
      'Decision-changing gaps',
      'Sources consulted',
    ],
    summaryFields: ['Signal', 'Bottom line'],
    summaryValues: {
      Signal: ['action', 'watch', 'insufficient context'],
    },
    item: {
      section: 'Findings',
      idPrefix: 'F',
      maxItems: 5,
      emptyText: 'No decision-relevant finding was established.',
      fields: [
        'Priority',
        'Status',
        'Why it matters',
        'Sources',
        'Confidence',
        'Decision impact',
      ],
      fieldValues: {
        Priority: ['P0', 'P1', 'P2', 'unranked'],
        Status: ['observed', 'inferred'],
      },
    },
    sectionFields: {
      'Recommended next move': [
        'Recommendation',
        'Suggested owner',
        'First step',
        'Expected result',
        'Check',
        'Revisit when',
      ],
    },
    sectionEmptyStates: {
      'Recommended next move': 'No recommendation from current context.',
    },
    sectionItemLimits: {
      'Decision-changing gaps': 3,
    },
  },
  challenger: {
    maxBytes: 12 * 1024,
    sections: [
      'Material exceptions',
      'Decisions that still hold',
      'Risks and dissent',
      'Decision-changing gaps',
    ],
    summaryFields: ['Verdict', 'Bottom line'],
    summaryValues: {
      Verdict: ['holds', 'holds with exceptions', 'not decision-ready'],
    },
    item: {
      section: 'Material exceptions',
      idPrefix: 'X',
      maxItems: 5,
      emptyText: 'No material exception found.',
      fields: ['Target', 'Type', 'Decision impact', 'Challenge', 'Sources', 'Resolution'],
      fieldValues: {
        Type: [
          'unsupported',
          'contradicted',
          'correlated reasoning',
          'missing alternative',
          'unpriced downside',
          'overconfident',
        ],
      },
    },
    sectionFields: {
      'Risks and dissent': ['Dissent', 'Resolution condition'],
    },
    sectionItemLimits: {
      'Decision-changing gaps': 3,
    },
  },
  chair: {
    maxBytes: 24 * 1024,
    sections: [
      'Decision queue',
      'Action plan',
      'Risks and dissent',
      'Decision-changing gaps',
      'Review coverage',
    ],
    summaryFields: ['Overall signal', 'Executive call'],
    summaryValues: {
      'Overall signal': ['act now', 'decide next', 'watch', 'insufficient context'],
    },
    item: {
      section: 'Decision queue',
      idPrefix: 'D',
      maxItems: 5,
      emptyText: 'No decision-ready proposal was established.',
      headingSuffixPattern: /^\[(?:P0|P1|P2|unranked)\]\s+\S/u,
      fields: [
        'Recommendation',
        'Why now',
        'Suggested owner',
        'Confidence',
        'Alternative',
        'First step',
        'Expected result',
        'Check',
        'Dependencies',
        'Revisit when',
        'Sources',
        'Dissent',
      ],
    },
    sectionFields: {},
    sectionItemLimits: {
      'Decision-changing gaps': 5,
    },
  },
  'board-report': {
    maxBytes: 24 * 1024,
    sections: [
      'Scope',
      'Executive summary',
      'Decision queue',
      'Action plan',
      'Risks and dissent',
      'Decision-changing gaps',
      'Review coverage',
      'Issues',
    ],
    summaryFields: [],
    item: {
      section: 'Decision queue',
      idPrefix: 'D',
      maxItems: 5,
      emptyText: 'No decision-ready proposal was established.',
      headingSuffixPattern: /^\[(?:P0|P1|P2|unranked)\]\s+\S/u,
      fields: [
        'Recommendation',
        'Why now',
        'Suggested owner',
        'Confidence',
        'Alternative',
        'First step',
        'Expected result',
        'Check',
        'Dependencies',
        'Revisit when',
        'Sources',
        'Dissent',
      ],
    },
    sectionFields: {
      Scope: ['Subject', 'Window', 'Requested decision', 'Custody'],
    },
    sectionItemLimits: {
      'Decision-changing gaps': 5,
    },
  },
});

export const OPERATE_REVIEW_NOTE_PROFILES_V2 = OPERATE_REVIEW_NOTE_PROFILES;
export const OPERATE_REVIEW_CONTRACT_VERSION = '2.0.0';
export const OPERATE_REVIEW_CONTRACT_VERSIONS = Object.freeze(['1.0.0', '2.0.0']);

/**
 * Additive human-note rubric overlay for Operate's five executive advisors.
 *
 * The closed Operate 2.0 machine registry remains the runtime contract. These
 * questions govern concise Markdown projections produced by canonical skills.
 */
export const OPERATE_ADVISOR_REVIEW_RUBRICS = deepFreeze({
  'strategy-finance': {
    skillId: 'planr-ceo-review',
    requiredQuestions: [
      'What current evidence changes or constrains company direction?',
      'Which objectives appear mis-resourced relative to evidenced expected value?',
      'What runway, margin, or cost consequence is established, and what remains unknown?',
      'Which decisions carry an evidenced cost of delay, and which remain unranked?',
    ],
  },
  'technology-risk': {
    skillId: 'planr-cto-review',
    requiredQuestions: [
      'Which technical constraints now block a stated objective?',
      'Which technical risks are decision-relevant, and which remain unranked?',
      'Which architectural decision, if any, is being made implicitly by in-flight work?',
      'How reversible are the evidenced high-impact changes?',
    ],
  },
  'product-activation': {
    skillId: 'planr-cpo-review',
    requiredQuestions: [
      'Where does current evidence show users failing to reach value?',
      'Which product bets remain unvalidated, and what bounded next test is supported?',
      'Is committed scope ordered by evidenced value and risk?',
      'Which committed scope, if any, should be cut to protect the activation path?',
      'Are acceptance criteria testable and tied to a customer or product outcome?',
    ],
  },
  'growth-market': {
    skillId: 'planr-cmo-review',
    requiredQuestions: [
      'What current evidence changes or constrains demand and positioning?',
      'Which acquisition-channel evidence is strong, weak, or absent?',
      'Which explicit market or positioning claim, if any, is unsupported?',
      'Which growth loop is evidenced as repeatable rather than merely proposed?',
    ],
  },
  'operations-customer': {
    skillId: 'planr-coo-review',
    requiredQuestions: [
      'Can the organization deliver current commitments at evidenced capacity?',
      'Where, if anywhere, is customer health degrading, and what operational cause is evidenced?',
      'Which process, if any, is a single point of failure or single-person dependency?',
      'Which operational commitment, if any, should be renegotiated before it is missed?',
    ],
  },
});

export const OPERATE_REVIEW_CONTRACT_V1 = deepFreeze({
  kind: 'operate-human-review-contract',
  schemaVersion: '1.0.0',
  protocolBaseline: { id: 'operate', version: '2.0.0' },
  profiles: OPERATE_REVIEW_NOTE_PROFILES_V1,
  advisorRubrics: OPERATE_ADVISOR_REVIEW_RUBRICS,
});

export const OPERATE_REVIEW_CONTRACT_V2 = deepFreeze({
  kind: 'operate-review-quality-contract',
  schemaVersion: '2.0.0',
  protocolBaseline: { id: 'operate', version: '2.0.0' },
  profiles: OPERATE_REVIEW_NOTE_PROFILES,
  advisorRubrics: OPERATE_ADVISOR_REVIEW_RUBRICS,
});

export const OPERATE_REVIEW_CONTRACTS = deepFreeze({
  '1.0.0': OPERATE_REVIEW_CONTRACT_V1,
  '2.0.0': OPERATE_REVIEW_CONTRACT_V2,
});

export const OPERATE_REVIEW_CONTRACT = OPERATE_REVIEW_CONTRACT_V2;
