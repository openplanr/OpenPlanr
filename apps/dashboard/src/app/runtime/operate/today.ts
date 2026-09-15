import {
  createOperateTodayDisplayValidator,
  resolveOperateTodayModel,
} from '../../../features/operate/today/today-model.js';

export const operateTodayRuntime = Object.freeze({
  createValidator: createOperateTodayDisplayValidator,
  resolveModel: resolveOperateTodayModel,
});
