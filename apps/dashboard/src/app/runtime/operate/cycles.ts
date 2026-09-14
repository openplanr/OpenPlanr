import { createOperateCyclesDisplayValidator } from '../../../features/operate/cycles/CyclesPage.js';
import { createOperateCycleDisplayWorkspaceValidator } from '../../../features/operate/cycles/cycle-model.js';

export const operateCycleRuntime = Object.freeze({
  createDetailValidator: createOperateCycleDisplayWorkspaceValidator,
  createListValidator: createOperateCyclesDisplayValidator,
});
