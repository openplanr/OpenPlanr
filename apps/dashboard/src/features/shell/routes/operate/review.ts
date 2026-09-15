import { ReviewPage } from '../../../operate/review/ReviewPage.js';
import { createOperateReviewDisplayValidator } from '../../../operate/review/review-model.js';
import type { OperateReviewNavigation } from '../../../operate/review/review-navigation.js';

export const reviewRoutes = Object.freeze({
  Page: ReviewPage,
  createValidator: createOperateReviewDisplayValidator,
});

export type { OperateReviewNavigation };
