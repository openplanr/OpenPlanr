import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  OperateContractCompileError,
  compileOperateContractRegistry,
} from '../../lib/operate/contracts/compiler.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';
import { createOperateExtensionRegistryV2 } from 'planr-pipeline/operate/extensions-v2';
import { resolvePublicOperatingDomainV2 } from 'planr-pipeline/operate/operating-domains-v2';

const EXECUTIVE_ADVISOR_IDS = [
  'growth-market',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
];
const root = fileURLToPath(new URL('../..', import.meta.url));
const registry = () =>
  JSON.parse(readFileSync(join(root, 'registry/operate-v2-contracts.json'), 'utf8'));
const fixture = (name) => {
  const registration = JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
  registration.policyRequirements = [];
  return registration;
};
const business = () => fixture('business-domain-valid.json');
const software = () => fixture('software-domain-valid.json');
const clone = (value) => structuredClone(value);
const businessDomain = (mutate) => {
  const source = registry();
  const domain = source.extensions.domains.find(({ domainId }) => domainId === 'business');
  mutate(domain);
  return source;
};

test('the unreleased business catalog registers the five executive advisors plus challenge and chair', () => {
  const domain = OPERATE_CONTRACT_CATALOG_V2.extensions.domains.find(
    ({ domainId }) => domainId === 'business',
  );
  const advisors = domain.roles.filter(({ roleKind }) => roleKind === 'advisor');
  assert.deepEqual(advisors.map(({ roleId }) => roleId).sort(), [...EXECUTIVE_ADVISOR_IDS].sort());
  assert.deepEqual(advisors.map(({ label }) => label).sort(), ['CEO', 'CMO', 'COO', 'CPO', 'CTO']);
  assert.equal(
    domain.roles.find(({ roleKind }) => roleKind === 'challenger').roleId,
    'independent-challenge',
  );
  assert.equal(domain.roles.find(({ roleKind }) => roleKind === 'chair').roleId, 'chair');

  const mandate = OPERATE_CONTRACT_CATALOG_V2.roles.find(({ id }) => id === 'advisor');
  for (const seat of advisors) assert.deepEqual(seat.output, mandate.output, seat.roleId);
  for (const seat of domain.roles) {
    assert.equal(seat.roleVersion, '2.0.0', seat.roleId);
    assert.notEqual(seat.roleId, seat.label, seat.roleId);
  }
});

test('the software catalog stays software-native and does not copy business executive identities', () => {
  const domain = OPERATE_CONTRACT_CATALOG_V2.extensions.domains.find(
    ({ domainId }) => domainId === 'software',
  );
  assert.deepEqual(domain.roles.map(({ roleId }) => roleId).sort(), [
    'advisor',
    'chair',
    'challenger',
  ]);
  assert.equal(
    domain.roles.some(({ roleId }) => EXECUTIVE_ADVISOR_IDS.includes(roleId)),
    false,
  );
});

test('the compiler refuses a label or a domain identity standing in for a scheduling kind', () => {
  const cases = [
    [
      'label reused as identity',
      (domain) => {
        const seat = domain.roles.find(({ roleKind }) => roleKind === 'advisor');
        seat.label = seat.roleId;
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
    [
      'domain identity used as a kind',
      (domain) => {
        domain.roles.find(({ roleKind }) => roleKind === 'advisor').roleKind = 'strategy-finance';
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
    [
      'no chair seat',
      (domain) => {
        domain.roles = domain.roles.filter(({ roleKind }) => roleKind !== 'chair');
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
    [
      'a second challenge seat',
      (domain) => {
        domain.roles.push({
          ...clone(domain.roles.find(({ roleKind }) => roleKind === 'challenger')),
          roleId: 'second-challenge',
          label: 'Second Challenger',
        });
      },
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
    ],
    [
      'a repeated seat identity',
      (domain) => {
        domain.roles.push({
          ...clone(domain.roles.find(({ roleKind }) => roleKind === 'advisor')),
          label: 'Second Advisor',
        });
      },
      'E_OPERATE_CONTRACT_DUPLICATE',
    ],
    [
      'a forbidden CFO seat',
      (domain) => {
        domain.roles.push({
          ...clone(domain.roles.find(({ roleKind }) => roleKind === 'advisor')),
          roleId: 'finance-cfo',
          label: 'CFO',
        });
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
    [
      'a forbidden product-owner seat',
      (domain) => {
        domain.roles.push({
          ...clone(domain.roles.find(({ roleKind }) => roleKind === 'advisor')),
          roleId: 'product-owner',
          label: 'Product Owner',
        });
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
  ];

  for (const [label, mutate, code] of cases) {
    assert.throws(
      () => compileOperateContractRegistry(businessDomain(mutate)),
      (error) => error instanceof OperateContractCompileError && error.code === code,
      label,
    );
  }
});

test('the registration boundary seats five advisors and keeps one challenge and one chair', () => {
  const created = createOperateExtensionRegistryV2({ domains: [business(), software()] });
  const resolved = resolvePublicOperatingDomainV2(created, 'business', { domainVersion: '1.0.0' });
  assert.deepEqual(
    resolved.roles
      .filter(({ roleKind }) => roleKind === 'advisor')
      .map(({ roleId }) => roleId)
      .sort(),
    [...EXECUTIVE_ADVISOR_IDS].sort(),
  );
  assert.equal(
    resolved.roles.find(({ roleKind }) => roleKind === 'challenger').roleId,
    'independent-challenge',
  );

  const labelled = business();
  const seat = labelled.roles.find(({ roleKind }) => roleKind === 'advisor');
  seat.label = seat.roleId;
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [labelled, software()] }), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });

  const repeated = business();
  repeated.roles.push({
    ...clone(repeated.roles.find(({ roleKind }) => roleKind === 'advisor')),
    label: 'Second Advisor',
  });
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [repeated, software()] }), {
    code: 'E_EXTENSION_REGISTRATION_CONFLICT',
  });

  const headless = business();
  headless.roles = headless.roles.filter(({ roleKind }) => roleKind !== 'chair');
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [headless, software()] }), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });

  const executiveOnSoftware = software();
  executiveOnSoftware.roles.push({
    ...clone(executiveOnSoftware.roles.find(({ roleKind }) => roleKind === 'advisor')),
    roleId: 'strategy-finance',
    label: 'CEO',
  });
  assert.throws(
    () => createOperateExtensionRegistryV2({ domains: [business(), executiveOnSoftware] }),
    {
      code: 'E_EXTENSION_REGISTRATION_INVALID',
    },
  );
});

test('an advisor seat carries no dependency and the challenge and chair seats always do', () => {
  const created = createOperateExtensionRegistryV2({ domains: [business(), software()] });
  for (const domainId of ['business', 'software']) {
    const resolved = resolvePublicOperatingDomainV2(created, domainId, { domainVersion: '1.0.0' });
    for (const seat of resolved.roles) {
      const expected = seat.roleKind === 'advisor' ? 'none' : 'threshold';
      assert.equal(seat.dependencyPolicy.id, expected, `${domainId}/${seat.roleId}`);
    }
  }

  const dependent = business();
  dependent.roles.find(({ roleKind }) => roleKind === 'advisor').dependencyPolicy = {
    id: 'all-required',
    version: '1.0.0',
  };
  assert.throws(
    () =>
      resolvePublicOperatingDomainV2(
        createOperateExtensionRegistryV2({ domains: [dependent, software()] }),
        'business',
        { domainVersion: '1.0.0' },
      ),
    { code: 'OPERATING_DOMAIN_REGISTRATION_INVALID' },
  );
});

test('roleId uniqueness is per domain', () => {
  const created = createOperateExtensionRegistryV2({ domains: [business(), software()] });
  assert.doesNotThrow(() => {
    resolvePublicOperatingDomainV2(created, 'business', { domainVersion: '1.0.0' });
    resolvePublicOperatingDomainV2(created, 'software', { domainVersion: '1.0.0' });
  });
  assert.equal(
    resolvePublicOperatingDomainV2(created, 'business', { domainVersion: '1.0.0' }).roles.find(
      ({ roleKind }) => roleKind === 'chair',
    ).roleId,
    resolvePublicOperatingDomainV2(created, 'software', { domainVersion: '1.0.0' }).roles.find(
      ({ roleKind }) => roleKind === 'chair',
    ).roleId,
  );
});
