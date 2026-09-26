import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  approveImplementationHandoff,
  compareImplementationHandoffVersions,
  IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
  IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
  implementationHandoffApprovalPaths,
  previewImplementationHandoffApproval,
  readImplementationHandoffLifecycle,
  recoverImplementationHandoffApproval,
  regenerateImplementationHandoffDraft,
  revokeImplementationHandoff,
} from '../lib/design/implementation-handoff-approval.mjs';
import {
  composeImplementationHandoff,
  createRepositorySourceResolver,
  writeImplementationHandoffDraft,
} from '../lib/design/implementation-handoff.mjs';

const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const fixed = (character) => `sha256:${character.repeat(64)}`;
const clock = () => new Date('2026-09-21T12:00:00.000Z');
const actor = {
  id: 'local-owner',
  role: 'owner',
  capabilities: [
    IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
    IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
  ],
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-handoff-approval-'));
  mkdirSync(join(root, 'source'), { recursive: true });
  const body = 'checkout-screen-v1\n';
  writeFileSync(join(root, 'source/checkout.txt'), body);
  const basis = {
    designId: 'checkout',
    sourceRevision: fixed('a'),
    selectedVariant: 'direction-one',
    readiness: { status: 'ready', digest: fixed('b') },
    reviewHandoff: { version: 1, contentDigest: fixed('c') },
  };
  const input = {
    id: 'checkout-implementation',
    version: 1,
    title: 'Checkout implementation package',
    basis,
    sources: [
      {
        id: 'checkout-screen',
        kind: 'screen',
        path: 'source/checkout.txt',
        revision: fixed('a'),
        digest: sha(body),
      },
    ],
    requirements: [
      {
        kind: 'behavior',
        statement: 'Keep the checkout summary visible.',
        sourceRefs: ['checkout-screen'],
        verification: ['The summary remains visible in the desktop frame.'],
      },
    ],
  };
  const resolver = createRepositorySourceResolver(root);
  const draft = writeImplementationHandoffDraft(root, input, { resolveSource: resolver });
  return { root, input, basis, resolver, draft };
}

function options(f, overrides = {}) {
  return { actor, clock, currentBasis: f.basis, resolveSource: f.resolver, ...overrides };
}

test('approval binds the exact loaded package and exact retries reuse one immutable result', () => {
  const f = fixture();
  try {
    const request = {
      requestId: 'approve-checkout-v1',
      expectedVersion: f.draft.version,
      expectedContentDigest: f.draft.contentDigest,
    };
    const result = approveImplementationHandoff(f.root, request, options(f));
    assert.equal(result.package.status, 'approved');
    assert.deepEqual(result.package.approval, {
      actorId: 'local-owner',
      approvedAt: '2026-09-21T12:00:00.000Z',
      contentDigest: f.draft.contentDigest,
      authority: 'prepare-plan',
    });
    assert.equal(result.current.status, 'approved');
    assert.equal(result.event.actor.role, 'owner');
    assert.equal(result.event.actor.capability, IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY);
    assert.equal(result.event.authority, 'prepare-plan');
    const preview = previewImplementationHandoffApproval(f.root);
    assert.equal(preview.available, false);
    assert.deepEqual(preview.summary, {
      title: 'Checkout implementation package',
      packageVersion: 1,
      selectedVariant: 'direction-one',
      requirementCount: 1,
      unresolvedNonblockingItems: 0,
      effect: 'Prepare Plan',
      description: 'Approve this reviewed design context for a later, separate Plan invocation.',
    });
    assert.doesNotMatch(JSON.stringify(preview.summary), /sha256:|contentDigest/u);

    const repeated = approveImplementationHandoff(f.root, request, options(f));
    assert.equal(repeated.repeated, true);
    assert.equal(repeated.package.contentDigest, result.package.contentDigest);
    const lifecycle = readImplementationHandoffLifecycle(f.root);
    assert.equal(lifecycle.history.length, 1);
    assert.equal(lifecycle.events.length, 1);

    assert.throws(
      () =>
        approveImplementationHandoff(
          f.root,
          {
            ...request,
            expectedContentDigest: fixed('d'),
          },
          options(f),
        ),
      /already used for different input/u,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('stale tabs, changed bases, wrong roles, missing capabilities, and expired sessions fail closed', () => {
  const f = fixture();
  try {
    const loaded = f.draft;
    const changed = composeImplementationHandoff({
      ...f.input,
      requirements: [
        { ...f.input.requirements[0], statement: 'Show the checkout summary and taxes.' },
      ],
    });
    writeImplementationHandoffDraft(f.root, changed, { resolveSource: f.resolver });
    assert.throws(
      () =>
        approveImplementationHandoff(
          f.root,
          {
            requestId: 'stale-tab',
            expectedVersion: loaded.version,
            expectedContentDigest: loaded.contentDigest,
          },
          options(f),
        ),
      /changed after it was loaded/u,
    );
    assert.equal(readImplementationHandoffLifecycle(f.root).history.length, 0);

    assert.throws(
      () =>
        approveImplementationHandoff(
          f.root,
          {
            requestId: 'wrong-role',
            expectedVersion: changed.version,
            expectedContentDigest: changed.contentDigest,
          },
          options(f, { actor: { ...actor, role: 'reviewer' } }),
        ),
      /owner or maintainer/u,
    );
    assert.throws(
      () =>
        approveImplementationHandoff(
          f.root,
          {
            requestId: 'missing-capability',
            expectedVersion: changed.version,
            expectedContentDigest: changed.contentDigest,
          },
          options(f, { actor: { ...actor, capabilities: [] } }),
        ),
      /lacks the required/u,
    );
    assert.throws(
      () =>
        approveImplementationHandoff(
          f.root,
          {
            requestId: 'expired-session',
            expectedVersion: changed.version,
            expectedContentDigest: changed.contentDigest,
          },
          options(f, {
            actor: { ...actor, id: 'hosted-owner', sessionExpiresAt: '2026-09-21T11:59:59.000Z' },
          }),
        ),
      /expired/u,
    );
    assert.throws(
      () =>
        approveImplementationHandoff(
          f.root,
          {
            requestId: 'changed-basis',
            expectedVersion: changed.version,
            expectedContentDigest: changed.contentDigest,
          },
          options(f, { currentBasis: { ...f.basis, selectedVariant: 'direction-two' } }),
        ),
      /basis changed/u,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('regeneration supersedes only the current pointer while history stays immutable', () => {
  const f = fixture();
  try {
    const first = approveImplementationHandoff(
      f.root,
      {
        requestId: 'approve-v1',
        expectedVersion: 1,
        expectedContentDigest: f.draft.contentDigest,
      },
      options(f),
    );
    const paths = implementationHandoffApprovalPaths(f.root);
    const firstDirectory = readdirSync(paths.history)[0];
    const firstBytes = readFileSync(join(paths.history, firstDirectory, 'handoff.json'), 'utf8');
    const regenerated = regenerateImplementationHandoffDraft(
      f.root,
      {
        ...f.input,
        requirements: [
          { ...f.input.requirements[0], statement: 'Keep the checkout summary and taxes visible.' },
        ],
      },
      { requestId: 'regenerate-v2' },
      options(f),
    );
    assert.equal(regenerated.draft.version, 2);
    assert.equal(regenerated.supersession.current.status, 'superseded');
    assert.equal(regenerated.supersession.current.supersededBy.version, 2);
    const repeatedRegeneration = regenerateImplementationHandoffDraft(
      f.root,
      {
        ...f.input,
        requirements: [
          { ...f.input.requirements[0], statement: 'Keep the checkout summary and taxes visible.' },
        ],
      },
      { requestId: 'regenerate-v2' },
      options(f),
    );
    assert.equal(repeatedRegeneration.draft.version, 2);
    assert.equal(repeatedRegeneration.supersession.repeated, true);
    assert.throws(
      () =>
        regenerateImplementationHandoffDraft(
          f.root,
          {
            ...f.input,
            requirements: [
              {
                ...f.input.requirements[0],
                statement: 'Use different content under the same request.',
              },
            ],
          },
          { requestId: 'regenerate-v2' },
          options(f),
        ),
      /already used for different package content/u,
    );
    assert.equal(
      readFileSync(join(paths.history, firstDirectory, 'handoff.json'), 'utf8'),
      firstBytes,
    );
    assert.equal(
      regenerated.supersession.event.actor.capability,
      IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
    );

    const comparison = compareImplementationHandoffVersions(
      f.root,
      {
        id: first.package.id,
        version: first.package.version,
        contentDigest: first.package.contentDigest,
      },
      'draft',
    );
    assert.equal(comparison.changed, true);
    assert.equal(comparison.requirements.added.length, 1);
    assert.equal(comparison.requirements.removed.length, 1);

    const second = approveImplementationHandoff(
      f.root,
      {
        requestId: 'approve-v2',
        expectedVersion: regenerated.draft.version,
        expectedContentDigest: regenerated.draft.contentDigest,
      },
      options(f),
    );
    assert.equal(second.current.version, 2);
    assert.equal(readImplementationHandoffLifecycle(f.root).history.length, 2);
    assert.equal(
      readFileSync(join(paths.history, firstDirectory, 'handoff.json'), 'utf8'),
      firstBytes,
    );

    const revoked = revokeImplementationHandoff(
      f.root,
      {
        requestId: 'revoke-v2',
        expectedVersion: 2,
        expectedContentDigest: second.package.contentDigest,
        reason: 'The release scope changed.',
      },
      options(f),
    );
    assert.equal(revoked.current.status, 'revoked');
    assert.equal(revoked.event.actor.capability, IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY);
    const retry = revokeImplementationHandoff(
      f.root,
      {
        requestId: 'revoke-v2',
        expectedVersion: 2,
        expectedContentDigest: second.package.contentDigest,
        reason: 'The release scope changed.',
      },
      options(f),
    );
    assert.equal(retry.repeated, true);
    assert.equal(readImplementationHandoffLifecycle(f.root).history.length, 2);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('an interrupted lifecycle publication recovers one complete immutable commit', () => {
  const f = fixture();
  try {
    const result = approveImplementationHandoff(
      f.root,
      {
        requestId: 'recover-v1',
        expectedVersion: 1,
        expectedContentDigest: f.draft.contentDigest,
      },
      options(f),
    );
    const paths = implementationHandoffApprovalPaths(f.root);
    rmSync(paths.history, { recursive: true, force: true });
    rmSync(paths.events, { recursive: true, force: true });
    rmSync(paths.current, { force: true });
    writeFileSync(
      paths.journal,
      `${JSON.stringify(
        {
          kind: 'openplanr-design-implementation-handoff-lifecycle-publication',
          schemaVersion: '1.0.0',
          archive: result.package,
          event: result.event,
          pointer: result.current,
        },
        null,
        2,
      )}\n`,
    );
    assert.equal(recoverImplementationHandoffApproval(f.root), true);
    assert.equal(recoverImplementationHandoffApproval(f.root), false);
    const lifecycle = readImplementationHandoffLifecycle(f.root);
    assert.equal(lifecycle.history.length, 1);
    assert.equal(lifecycle.events.length, 1);
    assert.deepEqual(lifecycle.current, result.current);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('approval changes only handoff custody and has no planning, source, Git, release, deployment, or agent effect', () => {
  const f = fixture();
  try {
    const sentinels = [
      'plan.md',
      'source/checkout.txt',
      'git-ref',
      'release.json',
      'deployment.json',
      'agent.log',
    ];
    for (const path of sentinels) {
      mkdirSync(join(f.root, path, '..'), { recursive: true });
      if (path !== 'source/checkout.txt') writeFileSync(join(f.root, path), `${path}:unchanged\n`);
    }
    const before = Object.fromEntries(
      sentinels.map((path) => [path, readFileSync(join(f.root, path), 'utf8')]),
    );
    approveImplementationHandoff(
      f.root,
      {
        requestId: 'no-side-effects',
        expectedVersion: 1,
        expectedContentDigest: f.draft.contentDigest,
      },
      options(f),
    );
    for (const [path, bytes] of Object.entries(before))
      assert.equal(readFileSync(join(f.root, path), 'utf8'), bytes);
    const moduleSource = readFileSync(
      new URL('../lib/design/implementation-handoff-approval.mjs', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(
      moduleSource,
      /node:child_process|\b(?:spawn|execFile|fork)\s*\(|\bgit\s+(?:add|commit|push)|planr\s+(?:plan|ship)|deploy\s*\(/u,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
