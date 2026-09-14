// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxItemDetail } from '../../../../apps/dashboard/src/features/operate/inbox/InboxItemDetail.js';
import type { OperateInboxItem } from '../../../../apps/dashboard/src/features/operate/inbox/inbox-model.js';
import { uniqueOperateReviewNavigationForCycle } from '../../../../apps/dashboard/src/features/operate/review/review-navigation.js';
import { DecisionFocus } from '../../../../apps/dashboard/src/features/operate/today/DecisionFocus.js';
import type { OperateTodaySurfaceModel } from '../../../../apps/dashboard/src/features/operate/today/today-model.js';

const REVIEW_ROUTE = '#/operate/cycles/cyc_navigation_12345678/reviews/rev_navigation_12345678';

const navigationLocator = Object.freeze({
  kind: 'review' as const,
  cycleId: 'cyc_navigation_12345678',
  reviewId: 'rev_navigation_12345678',
  deepLink: REVIEW_ROUTE,
  readActionDigest: `sha256:${'a'.repeat(64)}`,
});

function reviewInboxItem(): OperateInboxItem {
  return {
    itemId: 'decision:dec_navigation_12345678',
    kind: 'decision',
    subjectId: 'dec_navigation_12345678',
    ownerActorId: 'owner-navigation',
    state: 'proposed',
    title: 'Choose the exact Review disposition',
    consequence: 'The Cycle remains pending until the owner decides.',
    expiresAt: null,
    blocking: true,
    evidence: [],
    requiredParties: [],
    redactions: [],
    actionLocator: null,
    navigationLocator,
    unavailableReason: null,
  };
}

function todayModel(): OperateTodaySurfaceModel {
  const item = reviewInboxItem();
  const unrelatedItem = {
    ...item,
    itemId: 'approval:rev_unrelated_12345678',
    subjectId: 'rev_unrelated_12345678',
    navigationLocator: {
      ...navigationLocator,
      cycleId: 'cyc_navigation_unrelated_1234',
      reviewId: 'rev_unrelated_12345678',
      deepLink: '#/operate/cycles/cyc_navigation_unrelated_1234/reviews/rev_unrelated_12345678',
      readActionDigest: `sha256:${'b'.repeat(64)}`,
    },
  };
  return {
    priorityAttention: {
      subjectId: item.subjectId,
      title: item.title,
      whyNow: 'The owner Review is ready.',
      consequence: item.consequence,
    },
    continuation: {
      subjectId: navigationLocator.reviewId,
      action: {
        tool: 'operate.review.get',
        label: 'Inspect review',
        effect: 'read-only',
      },
    },
    continuationRelationship: null,
    inbox: [unrelatedItem, item],
    actions: [],
    activeCycle: {
      cycleId: navigationLocator.cycleId,
      focus: ['Resolve the pending Review.'],
      deepLink: '#/operate/cycles/cyc_navigation_12345678',
    },
    mutationEnabled: true,
  } as unknown as OperateTodaySurfaceModel;
}

afterEach(cleanup);

describe('authoritative Review navigation', () => {
  it('opens the frozen Review locator from a multi-choice Inbox item without preview authority', () => {
    const onPreview = vi.fn();
    render(
      <InboxItemDetail
        item={reviewInboxItem()}
        mutationEnabled
        pendingItemId={null}
        surfaceReasonCodes={[]}
        onPreview={onPreview}
      />,
    );

    const link = screen.getByRole('link', { name: 'Open Review' });
    expect(link.getAttribute('href')).toBe(REVIEW_ROUTE);
    expect(link.getAttribute('data-review-read-action-digest')).toBe(
      navigationLocator.readActionDigest,
    );
    expect(screen.queryByRole('button', { name: 'Open verified preview' })).toBeNull();
    fireEvent.click(link);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('retains the governed preview path for an ordinary non-Review Inbox action', () => {
    const onPreview = vi.fn();
    const item = {
      ...reviewInboxItem(),
      actionLocator: {
        subjectId: 'dec_navigation_12345678',
        actionDigest: `sha256:${'c'.repeat(64)}`,
      },
      navigationLocator: null,
    } as OperateInboxItem;
    render(
      <InboxItemDetail
        item={item}
        mutationEnabled
        pendingItemId={null}
        surfaceReasonCodes={[]}
        onPreview={onPreview}
      />,
    );

    const button = screen.getByRole('button', { name: 'Open verified preview' });
    fireEvent.click(button);
    expect(onPreview).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: 'Open Review' })).toBeNull();
  });

  it('uses Today’s exact validated locator instead of invoking or reconstructing a continuation', () => {
    const onContinuation = vi.fn();
    render(<DecisionFocus model={todayModel()} onContinuation={onContinuation} />);

    const link = screen.getByRole('link', { name: 'Open Review' });
    expect(link.getAttribute('href')).toBe(REVIEW_ROUTE);
    expect(link.getAttribute('data-review-read-action-digest')).toBe(
      navigationLocator.readActionDigest,
    );
    expect(screen.queryByRole('button', { name: 'Inspect review' })).toBeNull();
    fireEvent.click(link);
    expect(onContinuation).not.toHaveBeenCalled();
  });

  it('requires one exact current-Cycle Review locator and fails closed on ambiguity', () => {
    const model = todayModel();
    expect(uniqueOperateReviewNavigationForCycle(model, navigationLocator.cycleId)).toEqual(
      navigationLocator,
    );
    const ambiguous = {
      ...model,
      inbox: [
        ...model.inbox,
        {
          ...reviewInboxItem(),
          itemId: 'decision:dec_navigation_duplicate_1234',
        },
      ],
    } as OperateTodaySurfaceModel;
    expect(uniqueOperateReviewNavigationForCycle(ambiguous, navigationLocator.cycleId)).toBeNull();
    expect(uniqueOperateReviewNavigationForCycle(model, 'cyc_navigation_foreign_1234')).toBeNull();
  });
});
