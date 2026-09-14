import { describe, expect, it, vi } from 'vitest';

const { readCommittedReviewReceipt, submitBoundOperatingReview, submitOperatingReview } =
  vi.hoisted(() => ({
    readCommittedReviewReceipt: vi.fn(() => ({
      ok: true,
      operation: 'operate.review.submit',
      data: { kind: 'operating-review-receipt' },
      allowedActions: [],
    })),
    submitBoundOperatingReview: vi.fn(() => ({
      replayed: true,
      response: { ok: true, operation: 'operate.review.submit', allowedActions: [] },
    })),
    submitOperatingReview: vi.fn(() => ({
      replayed: true,
      response: { ok: true, operation: 'operate.review.submit', allowedActions: [] },
    })),
  }));

vi.mock('planr-pipeline/operate/runtime-v2', () => ({
  readCommittedOperatingReviewReceiptV2: readCommittedReviewReceipt,
  readOperatingReviewV2: vi.fn(),
  submitBoundOperatingReviewV2: submitBoundOperatingReview,
  submitOperatingReviewV2: submitOperatingReview,
}));

import {
  readCommittedOperateReviewReceipt,
  submitBoundOperateReview,
  submitOperateReview,
} from '../../src/services/operate/review-lifecycle-service.js';

describe('Operate Review lifecycle capability custody', () => {
  it('submits an advertised Review choice with the exact frozen versioned capability', async () => {
    const request = {
      reviewId: 'rev_capability_00000001',
      cycleId: 'cyc_capability_00000001',
      actor: { actorId: 'owner-capability', kind: 'human' as const, runtime: 'openplanr' },
      scope: {
        scopeId: 'scope-capability',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
      disposition: 'approved' as const,
      workDispositions: [],
    };

    await expect(
      submitOperateReview({
        root: '/tmp/openplanr-review-capability',
        request,
        issueFactory: () => () => ({
          id: (prefix) => `${prefix}_capability_00000001`,
          stableId: (prefix) => `${prefix}_capability_stable_0001`,
          timestamp: () => '2026-08-20T12:00:00.000Z',
        }),
        requiredRuntime: async () => ({ state: {} }) as never,
        commit: vi.fn(),
      }),
    ).resolves.toMatchObject({ ok: true, operation: 'operate.review.submit' });

    expect(submitOperatingReview).toHaveBeenCalledTimes(1);
    expect(submitOperatingReview.mock.calls[0]?.[2]).toMatchObject({
      capabilities: [{ id: 'operate-review-submit', version: '2.0.0' }],
    });
  });

  it('reads one terminal receipt with only the exact owner read capability', () => {
    const request = {
      reviewId: 'rev_capability_00000001',
      cycleId: 'cyc_capability_00000001',
      actor: { actorId: 'owner-capability', kind: 'human' as const, runtime: 'openplanr' },
      scope: {
        scopeId: 'scope-capability',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
    };
    expect(readCommittedOperateReviewReceipt({ state: {} } as never, request)).toMatchObject({
      ok: true,
      operation: 'operate.review.submit',
    });
    expect(readCommittedReviewReceipt).toHaveBeenCalledWith(request, {
      initialState: {},
      capabilities: ['operate.review.get'],
    });
  });

  it('commits the additive head- and choice-bound wrapper without weakening capability custody', async () => {
    const submission = {
      kind: 'operate-review-bound-submission' as const,
      schemaVersion: '1.0.0' as const,
      protocolVersion: '2.0.0' as const,
      expectedReadEventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
      choiceId: 'rch_capability_00000001',
      choiceHash: `sha256:${'b'.repeat(64)}`,
      submitArguments: {
        reviewId: 'rev_capability_00000001',
        cycleId: 'cyc_capability_00000001',
        actor: { actorId: 'owner-capability', kind: 'human' as const, runtime: 'openplanr' },
        scope: {
          scopeId: 'scope-capability',
          domainId: 'business',
          domainVersion: '1.0.0',
        },
        disposition: 'approved' as const,
        workDispositions: [],
      },
      note: null,
      boundSubmissionHash: `sha256:${'c'.repeat(64)}`,
    } as never;

    await expect(
      submitBoundOperateReview({
        root: '/tmp/openplanr-review-capability',
        submission,
        issueFactory: () => () => ({
          id: (prefix) => `${prefix}_capability_00000001`,
          stableId: (prefix) => `${prefix}_capability_stable_0001`,
          timestamp: () => '2026-08-20T12:00:00.000Z',
        }),
        requiredRuntime: async () => ({ state: {} }) as never,
        commit: vi.fn(),
      }),
    ).resolves.toMatchObject({ ok: true, operation: 'operate.review.submit' });

    expect(submitBoundOperatingReview).toHaveBeenCalledWith(
      submission,
      expect.any(Object),
      expect.objectContaining({
        capabilities: [{ id: 'operate-review-submit', version: '2.0.0' }],
      }),
    );
  });
});
