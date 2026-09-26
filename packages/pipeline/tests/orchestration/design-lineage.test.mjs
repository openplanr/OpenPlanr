import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  composeDesignPlanningLineage,
  readDesignPlanningLineage,
  resolveDesignPlanningLineage,
  writeDesignPlanningArtifacts,
} from '../../lib/pipeline/design-lineage.mjs';
import { designImplementationHandoffDigest } from '../../lib/protocol/design-handoff-contracts.mjs';

const fixed = (value) => `sha256:${value.repeat(64)}`;

function approvedHandoff() {
  const value = {
    kind: 'openplanr-design-implementation-handoff',
    schemaVersion: '1.0.0',
    id: 'checkout-implementation',
    version: 2,
    status: 'approved',
    authority: 'prepare-plan',
    title: 'Checkout implementation package',
    basis: {
      designId: 'checkout',
      sourceRevision: fixed('a'),
      selectedVariant: 'direction-one',
      readiness: { status: 'ready', digest: fixed('b') },
      reviewHandoff: { version: 1, contentDigest: fixed('c') },
    },
    sources: [
      { id: 'checkout-screen', kind: 'screen', path: 'design/checkout.json', digest: fixed('d') },
      { id: 'billing-screen', kind: 'screen', path: 'design/billing.json', digest: fixed('e') },
    ],
    requirements: [
      {
        id: 'REQ-001',
        kind: 'behavior',
        statement: 'Confirm the order.',
        sourceRefs: ['checkout-screen'],
        verification: ['Confirm action succeeds.'],
      },
      {
        id: 'REQ-002',
        kind: 'accessibility',
        statement: 'Name the total.',
        sourceRefs: ['billing-screen'],
        verification: ['Total has an accessible name.'],
      },
    ],
    contentDigest: fixed('0'),
    markdown: '# Checkout implementation package\n',
  };
  value.contentDigest = designImplementationHandoffDigest(value);
  value.approval = {
    actorId: 'owner',
    approvedAt: '2026-09-21T12:00:00.000Z',
    contentDigest: value.contentDigest,
    authority: 'prepare-plan',
  };
  return value;
}

function planInput() {
  const handoff = approvedHandoff();
  return {
    handoff,
    specId: 'SPEC-014',
    mappings: [
      {
        requirementId: 'REQ-001',
        acceptanceRefs: [{ storyId: 'US-045', acceptanceId: 'AC-013' }],
        taskIds: ['T-046'],
      },
      {
        requirementId: 'REQ-002',
        acceptanceRefs: [{ storyId: 'US-045', acceptanceId: 'AC-014' }],
        taskIds: ['T-047'],
      },
    ],
    stories: [{ id: 'US-045', acceptanceCriteria: [{ id: 'AC-013' }, { id: 'AC-014' }] }],
    tasks: [
      {
        id: 'T-046',
        storyId: 'US-045',
        acceptanceRefs: ['AC-013'],
        testRequirements: 'Prove AC-013 in browser verification.',
      },
      {
        id: 'T-047',
        storyId: 'US-045',
        acceptanceRefs: ['AC-014'],
        testRequirements: 'Prove AC-014 with accessibility checks.',
      },
    ],
  };
}

test('Plan composes closed requirement, acceptance, and task lineage', () => {
  const input = planInput();
  const lineage = composeDesignPlanningLineage(input);
  assert.equal(lineage.handoff.contentDigest, input.handoff.contentDigest);
  assert.deepEqual(
    lineage.mappings.map(({ requirementId }) => requirementId),
    ['REQ-001', 'REQ-002'],
  );
  assert.throws(
    () => composeDesignPlanningLineage({ ...input, mappings: input.mappings.slice(0, 1) }),
    /every implementation requirement/u,
  );
  assert.throws(
    () =>
      composeDesignPlanningLineage({
        ...input,
        tasks: [{ ...input.tasks[0], testRequirements: 'No mapped verification.' }, input.tasks[1]],
      }),
    /Test Requirements/u,
  );
});

test('Plan writes generated artifacts and lineage atomically after validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-lineage-'));
  try {
    const input = {
      ...planInput(),
      artifacts: [{ path: 'stories/US-045.md', bytes: '# Story\n' }],
    };
    const result = writeDesignPlanningArtifacts(root, input);
    assert.deepEqual(result.written, ['stories/US-045.md', 'design-lineage.json']);
    assert.equal(readFileSync(join(root, 'stories/US-045.md'), 'utf8'), '# Story\n');
    assert.equal(readDesignPlanningLineage(root).specId, 'SPEC-014');
    assert.equal(writeDesignPlanningArtifacts(root, input).repeated, true);

    const before = new Set([...(existsSync(root) ? ['root'] : [])]);
    assert.throws(
      () =>
        writeDesignPlanningArtifacts(join(root, 'invalid'), {
          ...input,
          mappings: input.mappings.slice(0, 1),
        }),
      /every implementation requirement/u,
    );
    assert.equal(existsSync(join(root, 'invalid')), false, 'incomplete coverage writes nothing');
    assert.equal(before.has('root'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed multi-file commit restores the exact prior state', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-lineage-rollback-'));
  try {
    mkdirSync(join(root, 'stories'), { recursive: true });
    writeFileSync(join(root, 'stories/US-045.md'), '# Previous story\n');
    let renames = 0;
    const failingRename = (...args) => {
      renames += 1;
      if (renames === 3) throw new Error('simulated storage interruption');
      return renameSync(...args);
    };
    assert.throws(
      () =>
        writeDesignPlanningArtifacts(
          root,
          {
            ...planInput(),
            artifacts: [
              { path: 'stories/US-045.md', bytes: '# New story\n' },
              { path: 'tasks/T-046.md', bytes: '# New task\n' },
            ],
          },
          { replace: true, fs: { renameSync: failingRename } },
        ),
      /simulated storage interruption/u,
    );
    assert.equal(readFileSync(join(root, 'stories/US-045.md'), 'utf8'), '# Previous story\n');
    assert.equal(existsSync(join(root, 'tasks/T-046.md')), false);
    assert.equal(existsSync(join(root, 'design-lineage.json')), false);
    assert.equal(existsSync(join(root, '.design-lineage-transaction.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Ship resolves only the selected task requirement and its exact source references', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-lineage-resolve-'));
  try {
    const input = planInput();
    const lineage = composeDesignPlanningLineage(input);
    const key = `${createHash('sha256').update(input.handoff.id).digest('hex').slice(0, 16)}-v2-${input.handoff.contentDigest.slice(7, 23)}`;
    const history = join(root, 'design/implementation-handoff/versions', key);
    mkdirSync(history, { recursive: true });
    writeFileSync(join(history, 'handoff.json'), JSON.stringify(input.handoff));
    mkdirSync(join(root, 'design/implementation-handoff'), { recursive: true });
    writeFileSync(
      join(root, 'design/implementation-handoff/current.json'),
      JSON.stringify({
        id: input.handoff.id,
        version: input.handoff.version,
        contentDigest: input.handoff.contentDigest,
        status: 'approved',
      }),
    );
    const context = resolveDesignPlanningLineage({ root, lineage, taskIds: ['T-046'] });
    assert.equal(context.status, 'current');
    assert.deepEqual(
      context.requirements.map(({ id }) => id),
      ['REQ-001'],
    );
    assert.deepEqual(
      context.sources.map(({ id }) => id),
      ['checkout-screen'],
    );
    assert.equal(
      resolveDesignPlanningLineage({ root, lineage: null, taskIds: ['T-046'] }).status,
      'absent',
    );
    writeFileSync(
      join(root, 'design/implementation-handoff/current.json'),
      JSON.stringify({
        id: input.handoff.id,
        version: 3,
        contentDigest: fixed('f'),
        status: 'approved',
      }),
    );
    assert.equal(
      resolveDesignPlanningLineage({ root, lineage, taskIds: ['T-046'] }).status,
      'stale',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
