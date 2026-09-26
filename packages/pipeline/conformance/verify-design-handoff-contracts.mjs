#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canContinueDesignHandoff,
  compileDesignHandoffReadiness,
} from '../lib/design/handoff-readiness.mjs';
import {
  assertDesignImplementationHandoff,
  assertDesignPlanningLineage,
  designImplementationHandoffDigest,
} from '../lib/protocol/design-handoff-contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (character) => `sha256:${character.repeat(64)}`;
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const name of [
  'design-handoff-readiness',
  'design-implementation-handoff',
  'design-planning-lineage',
]) {
  requireCondition(
    existsSync(join(root, `schemas/v1.11.0/${name}.schema.json`)),
    `Missing projected ${name} contract.`,
  );
}

const revision = digest('a');
const readinessInput = {
  sourceRevision: revision,
  document: {
    kind: 'openplanr-design-document',
    schemaVersion: '1.0.0',
    id: 'fieldwork',
    selectedVariant: 'direction-1',
    variants: [{ id: 'direction-1', status: 'ready' }],
  },
  specification: { path: 'design-spec.md', revision, complete: true },
  verification: { path: '.design/verification/current.json', revision, status: 'verified' },
  review: { path: '.design/review.json', revision, current: true, pins: [] },
  reviewHandoff: {
    path: 'review-handoff.json',
    status: 'approved',
    current: true,
    contentHash: digest('b'),
    approval: { contentHash: digest('b') },
    basis: { designId: 'fieldwork', sourceRevision: revision, selectedVariant: 'direction-1' },
  },
};
const readiness = compileDesignHandoffReadiness(readinessInput);
requireCondition(readiness.status === 'ready', 'Current complete design evidence is not ready.');
requireCondition(canContinueDesignHandoff(readiness), 'A ready design cannot continue to Plan.');
requireCondition(readiness.authority === 'none', 'Readiness granted execution authority.');
requireCondition(
  readiness.continuation.action === 'prepare-plan',
  'Readiness permits an unexpected continuation.',
);

const hostile = structuredClone(readinessInput);
hostile.documentPath = '../outside.json';
let rejectedHostilePath = false;
try {
  compileDesignHandoffReadiness(hostile);
} catch {
  rejectedHostilePath = true;
}
requireCondition(rejectedHostilePath, 'Readiness accepted evidence outside the project.');

const handoff = {
  kind: 'openplanr-design-implementation-handoff',
  schemaVersion: '1.0.0',
  id: 'handoff-fieldwork-1',
  version: 1,
  status: 'draft',
  authority: 'prepare-plan',
  title: 'Fieldwork implementation package',
  basis: {
    designId: 'fieldwork',
    sourceRevision: revision,
    selectedVariant: 'direction-1',
    readiness: { status: 'ready', digest: digest('c') },
    reviewHandoff: { version: 1, contentDigest: digest('b') },
  },
  sources: [
    {
      id: 'design-revision',
      kind: 'design-revision',
      path: 'design-document.json',
      revision,
      digest: digest('d'),
    },
  ],
  requirements: [
    {
      id: 'REQ-001',
      kind: 'behavior',
      statement: 'Keep dispatch confirmation explicit.',
      sourceRefs: ['design-revision'],
      verification: ['The confirmation remains keyboard reachable.'],
    },
  ],
  contentDigest: digest('0'),
  markdown: '# Fieldwork implementation package\n',
};
handoff.contentDigest = designImplementationHandoffDigest(handoff);
assertDesignImplementationHandoff(handoff);

const approved = structuredClone(handoff);
approved.status = 'approved';
approved.approval = {
  actorId: 'owner-1',
  approvedAt: '2026-09-21T10:00:00Z',
  contentDigest: approved.contentDigest,
  authority: 'prepare-plan',
};
assertDesignImplementationHandoff(approved);
assertDesignPlanningLineage(
  {
    kind: 'openplanr-design-planning-lineage',
    schemaVersion: '1.0.0',
    handoff: { id: approved.id, version: approved.version, contentDigest: approved.contentDigest },
    specId: 'SPEC-014',
    mappings: [
      {
        requirementId: 'REQ-001',
        acceptanceRefs: [{ storyId: 'US-041', acceptanceId: 'AC-001' }],
        taskIds: ['T-041'],
      },
    ],
  },
  approved,
);

console.log('Design handoff contract conformance: PASS');
