import { TodayPage } from '../../../operate/today/TodayPage.js';
import { createOperateTodayDisplayValidator } from '../../../operate/today/today-model.js';

export const todayRoute = Object.freeze({
  Page: TodayPage,
  createValidator: createOperateTodayDisplayValidator,
});
