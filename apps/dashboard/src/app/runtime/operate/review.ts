import { fetchOperateReviewDisplay } from '../../../features/operate/review/review-api.js';
import { createOperateReviewDisplayValidator } from '../../../features/operate/review/review-model.js';
import { uniqueOperateReviewNavigationForCycle } from '../../../features/operate/review/review-navigation.js';

export const operateReviewRuntime = Object.freeze({
  createValidator: createOperateReviewDisplayValidator,
  fetch: fetchOperateReviewDisplay,
  uniqueNavigationForCycle: uniqueOperateReviewNavigationForCycle,
});

export type { OperateReviewNavigation } from '../../../features/operate/review/review-navigation.js';
