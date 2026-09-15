/** Shared mandate and rubric fields for intelligence operating-assignment test fixtures. */

export const INTELLIGENCE_ASSIGNMENT_RUBRIC_V2 = Object.freeze({
  artifactQualityBar: [
    'Every claim carries an evidence ref or is marked as an assumption with confidence.',
    'Names the one highest cost-of-delay decision.',
    'States what evidence would reverse the conclusion.',
  ],
  failureModes: [
    'Restating metrics without a direction claim.',
    'Recommending growth without funding it.',
    'Treating a lagging indicator as a cause.',
    'Conflating revenue with margin.',
    'Silent optimism about runway.',
  ],
  outOfScope: [
    'Implementation design.',
    'Campaign mechanics.',
    'Delivery estimates.',
    'Code-level judgement.',
  ],
  requiredEvidence: [
    'Objective and metric deltas.',
    'Financial metrics in scope.',
    'Prior Decisions and their revisit conditions.',
  ],
  requiredQuestions: [
    'What changed since the last Snapshot that alters company direction?',
    'Which objectives are now mis-resourced relative to expected value?',
    'What is the runway and margin consequence of the current plan?',
    'Which single decision becomes materially more expensive if deferred a quarter?',
  ],
});

export const INTELLIGENCE_ASSIGNMENT_MANDATE_V2 = Object.freeze({
  scope: 'Strategy, company direction, capital allocation, and financial viability.',
  allowedEvidence: [
    'Snapshot',
    'Delta',
    'operating state',
    'bounded market and finance evidence refs in scope',
  ],
  allowedCapabilities: [
    'artifact.read',
    'artifact.submit',
    'git.read',
    'planr.read',
    'repository.read',
  ],
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
  skillId: 'planr-ceo-review',
});

export function intelligenceAssignmentFieldsV2() {
  return {
    roleVersion: '2.0.0',
    inputAbsences: [],
    analysisRubric: structuredClone(INTELLIGENCE_ASSIGNMENT_RUBRIC_V2),
    mandate: structuredClone(INTELLIGENCE_ASSIGNMENT_MANDATE_V2),
    analysisProfile: {
      id: 'test-intelligence-analysis',
      version: '1.0.0',
      questionIds: ['test-intelligence-question'],
    },
    evidenceRequirements: [],
    resultRequirements: [{
      requirementId: 'test-intelligence-analysis-result',
      description: 'The test result retains one bounded analysis profile.',
      target: 'analysis',
      appliesToOutcomes: ['always'],
      minimumItems: 1,
      maximumItems: 16,
    }],
  };
}

export function chairAssignmentFieldsV2() {
  return {
    roleVersion: '2.0.0',
    inputAbsences: [],
    analysisRubric: structuredClone(INTELLIGENCE_ASSIGNMENT_RUBRIC_V2),
    analysisProfile: {
      id: 'test-chair-analysis',
      version: '1.0.0',
      questionIds: ['test-chair-question'],
    },
    evidenceRequirements: [],
    resultRequirements: [{
      requirementId: 'test-chair-decisions',
      description: 'The test Chair accounts for its bounded decisions.',
      target: 'decisions',
      appliesToOutcomes: ['always'],
      minimumItems: 0,
      maximumItems: 16,
    }],
    mandate: structuredClone({
      scope: 'Evidence-bound synthesis. Carry missing, abandoned, and conflicting work as gaps. Propose Decisions and Actions without approval or execution authority.',
      allowedEvidence: [
        'terminal selected advisor Artifacts',
        'Challenger Artifact',
        'typed absences',
      ],
      allowedCapabilities: [
        'artifact.read',
        'artifact.submit',
        'git.read',
        'planr.read',
        'repository.read',
      ],
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
      skillId: 'planr-chair-review',
    }),
  };
}
