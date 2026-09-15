import type { OperateTodaySurfaceModel } from '../today/today-model.js';

export type OperateReviewNavigation = NonNullable<
  OperateTodaySurfaceModel['inbox'][number]['navigationLocator']
>;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export function isOperateReviewNavigationForCycle(
  value: OperateReviewNavigation,
  cycleId: string,
): boolean {
  return (
    value.kind === 'review' &&
    value.cycleId === cycleId &&
    SHA256.test(value.readActionDigest) &&
    value.deepLink ===
      `#/operate/cycles/${encodeURIComponent(value.cycleId)}/reviews/${encodeURIComponent(value.reviewId)}`
  );
}

/**
 * Select one exact navigation capability already issued in the validated Today/Inbox view.
 * Ambiguous or foreign-Cycle candidates fail closed; no Review identity or digest is derived here.
 */
export function uniqueOperateReviewNavigationForCycle(
  model: OperateTodaySurfaceModel,
  cycleId: string,
): OperateReviewNavigation | null {
  const candidates = model.inbox.flatMap((item) => {
    const locator = item.navigationLocator;
    return locator && isOperateReviewNavigationForCycle(locator, cycleId) ? [locator] : [];
  });
  return candidates.length === 1 ? candidates[0] : null;
}
