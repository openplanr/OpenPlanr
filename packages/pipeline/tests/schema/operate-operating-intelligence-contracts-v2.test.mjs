import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2,
  OPERATE_OPERATING_PROJECTION_IDENTITIES_V2,
  OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  loadOperateOperatingIntelligenceContract,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));

const valid = fixture('all-contracts-valid.json');
const vocabulary = fixture('operating-intelligence-contracts-valid.json');
const invalid = fixture('operating-intelligence-contracts-invalid.json');

test('Phase 5 has the exact public operating-intelligence contract vocabulary', () => {
  assert.deepEqual([...OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2].sort(), [...vocabulary.contractIds].sort());
  assert.deepEqual(OPERATE_OPERATING_PROJECTION_IDENTITIES_V2, vocabulary.projectionIdentities);
  assert.deepEqual([...OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2].sort(),
    [...vocabulary.providerRegistrationContractIds].sort());

  for (const kind of OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2) {
    const contract = loadOperateOperatingIntelligenceContract(kind, { protocolVersion: '2.0.0' });
    assert.equal(contract.kind, kind);
    assert.deepEqual(validateProtocolArtifact(kind, valid[kind], { protocolVersion: '2.0.0' }), [], kind);
  }

  assert.deepEqual(
    loadOperateOperatingIntelligenceContract('business-operating-snapshot-projection', { protocolVersion: '2.0.0' })
      .schema['x-openplanr-contract'],
    { id: 'business-operating-snapshot-projection', version: '1.0.0' },
  );
  assert.deepEqual(
    loadOperateOperatingIntelligenceContract('software-operating-snapshot-projection', { protocolVersion: '2.0.0' })
      .schema['x-openplanr-contract'],
    { id: 'software-operating-snapshot-projection', version: '1.0.0' },
  );
});

test('API domain IDs use an explicit public domain-contract mapping', () => {
  for (const [domainId, domainContract] of Object.entries(vocabulary.apiDomainContracts)) {
    const registration = {
      ...valid['operate-domain-registration'],
      domainId,
      domainContract,
      projectionContracts: [{
        schemaId: `${domainId}-operating-snapshot-projection`,
        schemaVersion: '1.0.0',
      }],
    };
    assert.deepEqual(validateProtocolArtifact('operate-domain-registration', registration, {
      protocolVersion: '2.0.0',
    }), [], domainId);
  }

  const implicit = {
    ...valid['operate-domain-registration'],
    domainId: 'business',
    domainContract: invalid.implicitDomainContract.domainContract,
  };
  assert.ok(validateProtocolArtifact('operate-domain-registration', implicit, { protocolVersion: '2.0.0' }).length > 0);

  const missingChallenger = {
    ...valid['operate-domain-registration'],
    domainId: 'business',
    domainContract: vocabulary.apiDomainContracts.business,
    projectionContracts: [{
      schemaId: 'business-operating-snapshot-projection',
      schemaVersion: '1.0.0',
    }],
  };
  missingChallenger.roles = missingChallenger.roles.filter(({ roleId }) => roleId !== 'challenger');
  assert.ok(validateProtocolArtifact('operate-domain-registration', missingChallenger, {
    protocolVersion: '2.0.0',
  }).length > 0, 'public business registration requires Challenger');
});

test('Phase 5 provider declarations are data-only candidate descriptors', () => {
  const provider = valid['operate-snapshot-provider-registration'];
  assert.ok(validateProtocolArtifact('operate-snapshot-provider-registration', {
    ...provider,
    implementation: invalid.dynamicProvider.implementation,
  }, { protocolVersion: '2.0.0' }).length > 0, 'dynamic executable providers are rejected');
  assert.ok(validateProtocolArtifact('operate-snapshot-provider-registration', {
    ...provider,
    returnSemantics: invalid.effectAuthorizingProvider.returnSemantics,
  }, { protocolVersion: '2.0.0' }).length > 0, 'provider declarations cannot authorize effects');
});

test('operating actions and decisions fail closed when quality and revision fields are absent', () => {
  for (const field of [
    'objectiveId', 'expectedResult', 'metricId', 'baseline', 'target', 'verificationWindow', 'verificationPlanId',
  ]) {
    const action = structuredClone(valid['operating-action']);
    delete action[field];
    assert.ok(validateProtocolArtifact('operating-action', action, { protocolVersion: '2.0.0' }).length > 0, field);
  }

  for (const field of [
    'evidenceRefIds', 'alternatives', 'confidence', 'assumptionIds', 'expectedUpside', 'expectedDownside',
    'dissent', 'reopenConditions', 'revisitConditions', 'revision', 'predecessorDecisionId', 'historyDecisionIds',
  ]) {
    const decision = structuredClone(valid['operating-decision']);
    delete decision[field];
    assert.ok(validateProtocolArtifact('operating-decision', decision, { protocolVersion: '2.0.0' }).length > 0, field);
  }
});

test('advisor claims always carry evidence or an explicit assumption', () => {
  const advisor = structuredClone(valid['operating-advisor-result']);
  const claim = {
    localClaimId: `claim:${advisor.assignmentId}:1`,
    statement: 'This bounded claim records what would change the analysis.',
    epistemicStatus: 'speculative',
    confidence: 0.25,
    supportingEvidenceRefIds: [],
    contradictingEvidenceRefIds: [],
    assumptionIds: [],
    changeCondition: 'Revisit after the stated assumption is tested.',
  };
  advisor.claims = [claim];

  assert.ok(validateProtocolArtifact('operating-advisor-result', advisor, {
    protocolVersion: '2.0.0',
  }).length > 0, 'an ungrounded speculative claim is rejected');

  claim.assumptionIds = ['asm_00000001'];
  assert.deepEqual(validateProtocolArtifact('operating-advisor-result', advisor, {
    protocolVersion: '2.0.0',
  }), [], 'an explicit assumption grounds a speculative claim');

  claim.epistemicStatus = 'known';
  assert.ok(validateProtocolArtifact('operating-advisor-result', advisor, {
    protocolVersion: '2.0.0',
  }).length > 0, 'known claims require evidence rather than assumptions alone');
});

test('Challenger and Chair question coverage is closed and requires an explicit answer disposition', () => {
  for (const kind of ['operating-challenger-review', 'operating-decision-ledger']) {
    const missing = structuredClone(valid[kind]);
    delete missing.questionCoverage;
    assert.ok(validateProtocolArtifact(kind, missing, { protocolVersion: '2.0.0' }).length > 0, `${kind}:missing`);

    const extra = structuredClone(valid[kind]);
    extra.questionCoverage[0].inventedReferenceIds = [];
    assert.ok(validateProtocolArtifact(kind, extra, { protocolVersion: '2.0.0' }).length > 0, `${kind}:closed`);

    const unjustified = structuredClone(valid[kind]);
    unjustified.questionCoverage[0].justification = null;
    assert.ok(validateProtocolArtifact(kind, unjustified, { protocolVersion: '2.0.0' }).length > 0, `${kind}:not-applicable`);

    const unlinked = structuredClone(valid[kind]);
    unlinked.questionCoverage[0] = {
      ...unlinked.questionCoverage[0],
      disposition: 'answered',
      justification: null,
    };
    assert.ok(validateProtocolArtifact(kind, unlinked, { protocolVersion: '2.0.0' }).length > 0, `${kind}:answered`);
  }
});

function multilineText(length, character = 'd') {
  assert.ok(length >= 3);
  return `${character}\n${character.repeat(length - 2)}`;
}

test('Challenger and Chair dissent accept multiline 513–4096 characters and reject multiline 4097', () => {
  const challenger = structuredClone(valid['operating-challenger-review']);
  const findingId = `finding:${challenger.assignmentId}:1`;
  challenger.findings = [{
    localFindingId: findingId,
    title: 'Evidence-bounded challenge',
    statement: 'The challenged claim needs a stronger causal basis.',
    type: 'unsupported',
    severity: 'medium',
    confidence: 0.75,
    targets: [{
      advisorArtifactId: challenger.advisorArtifactIds[0],
      analysisIds: [],
      claimIds: ['claim:asg_advisor_fixture_001:1'],
      measurementIds: [],
      riskIds: [],
      recommendationIds: [],
    }],
    supportingEvidenceRefIds: [],
    contradictingEvidenceRefIds: [],
    rationale: 'The accepted Advisor Artifact does not establish the asserted causal relationship.',
    correctionCondition: 'Provide evidence that independently verifies the causal relationship.',
  }];
  challenger.dissent = [{
    localDissentId: `dissent:${challenger.assignmentId}:1`,
    findingIds: [findingId],
    statement: multilineText(513),
    evidenceRefIds: [],
    resolutionCondition: 'Resolve the linked finding before adopting the recommendation.',
  }];

  assert.deepEqual(validateProtocolArtifact('operating-challenger-review', challenger, {
    protocolVersion: '2.0.0',
  }), [], '513-character Challenger dissent remains valid');
  challenger.dissent[0].statement = multilineText(4096);
  assert.deepEqual(validateProtocolArtifact('operating-challenger-review', challenger, {
    protocolVersion: '2.0.0',
  }), [], '4096-character Challenger dissent remains valid');
  challenger.dissent[0].statement = multilineText(4097);
  assert.ok(validateProtocolArtifact('operating-challenger-review', challenger, {
    protocolVersion: '2.0.0',
  }).length > 0, '4097-character Challenger dissent is rejected');

  const ledger = structuredClone(valid['operating-decision-ledger']);
  ledger.challengerArtifactId = 'art_challenger_fixture_001';
  ledger.dissent = [{
    sourceArtifactId: ledger.challengerArtifactId,
    localDissentId: `dissent:${challenger.assignmentId}:1`,
    findingIds: [findingId],
    statement: multilineText(513),
    evidenceRefIds: [],
    resolutionCondition: 'Resolve the linked finding before adopting the recommendation.',
  }];

  assert.deepEqual(validateProtocolArtifact('operating-decision-ledger', ledger, {
    protocolVersion: '2.0.0',
  }), [], '513-character Chair-preserved dissent remains valid');
  ledger.dissent[0].statement = multilineText(4096);
  assert.deepEqual(validateProtocolArtifact('operating-decision-ledger', ledger, {
    protocolVersion: '2.0.0',
  }), [], '4096-character Chair-preserved dissent remains valid');
  ledger.dissent[0].statement = multilineText(4097);
  assert.ok(validateProtocolArtifact('operating-decision-ledger', ledger, {
    protocolVersion: '2.0.0',
  }).length > 0, '4097-character Chair-preserved dissent is rejected');
});

test('a challenger-required intelligence plan selects the compiler-owned Challenger mandate', () => {
  const absent = structuredClone(valid['operating-intelligence-plan']);
  absent.selectedRoles = absent.selectedRoles.filter(({ roleId }) => roleId !== 'challenger');
  assert.ok(validateProtocolArtifact('operating-intelligence-plan', absent, { protocolVersion: '2.0.0' }).length > 0);

  const malformed = structuredClone(valid['operating-intelligence-plan']);
  malformed.selectedRoles.find(({ roleId }) => roleId === 'challenger').roleVersion = '1.0.0';
  assert.ok(validateProtocolArtifact('operating-intelligence-plan', malformed, { protocolVersion: '2.0.0' }).length > 0);
});

test('a domain owns its role identity and label while the kernel owns only the scheduling kind', () => {
  const registration = valid['operate-domain-registration'];
  const named = structuredClone(registration);
  const advisor = named.roles.find(({ roleKind }) => roleKind === 'advisor');
  advisor.roleId = 'strategy-finance';
  advisor.label = 'CEO';
  assert.deepEqual(validateProtocolArtifact('operate-domain-registration', named, { protocolVersion: '2.0.0' }), []);

  const parallel = structuredClone(named);
  parallel.roles.push({ ...structuredClone(advisor), roleId: 'technology-risk', label: 'CTO' });
  assert.deepEqual(validateProtocolArtifact('operate-domain-registration', parallel, { protocolVersion: '2.0.0' }), [],
    'a domain may seat more than one advisor without touching the kernel');

  for (const field of ['roleKind', 'label']) {
    const partial = structuredClone(named);
    delete partial.roles.find(({ roleId }) => roleId === 'strategy-finance')[field];
    assert.ok(validateProtocolArtifact('operate-domain-registration', partial, { protocolVersion: '2.0.0' }).length > 0, field);
  }

  const foreignKind = structuredClone(named);
  foreignKind.roles.find(({ roleId }) => roleId === 'strategy-finance').roleKind = 'strategy-finance';
  assert.ok(validateProtocolArtifact('operate-domain-registration', foreignKind, { protocolVersion: '2.0.0' }).length > 0,
    'a domain identity cannot stand in for a kernel scheduling kind');

  const business = fixture('business-domain-valid.json');
  assert.deepEqual(validateProtocolArtifact('operate-domain-registration', business, { protocolVersion: '2.0.0' }), []);
  const twoChallengers = structuredClone(business);
  const challenger = twoChallengers.roles.find(({ roleKind }) => roleKind === 'challenger');
  twoChallengers.roles.push({ ...structuredClone(challenger), roleId: 'second-challenge', label: 'Second Challenger' });
  assert.ok(validateProtocolArtifact('operate-domain-registration', twoChallengers, { protocolVersion: '2.0.0' }).length > 0,
    'independent challenge stays a single seat on a public domain');
});

test('domain declarations carry data-only board vocabulary without authority fields', () => {
  const registration = valid['operate-domain-registration'];
  assert.deepEqual(validateProtocolArtifact('operate-domain-registration', registration, {
    protocolVersion: '2.0.0',
  }), []);

  const authority = structuredClone(registration);
  authority.requestedCapabilities[0].granted = true;
  assert.ok(validateProtocolArtifact('operate-domain-registration', authority, { protocolVersion: '2.0.0' }).length > 0);

  const executable = structuredClone(registration);
  executable.projectionContracts[0].module = './projection.mjs';
  assert.ok(validateProtocolArtifact('operate-domain-registration', executable, { protocolVersion: '2.0.0' }).length > 0);
});
