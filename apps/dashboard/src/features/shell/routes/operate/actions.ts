import { ActionDetailPage } from '../../../operate/actions/ActionDetailPage.js';
import { ActionsPage } from '../../../operate/actions/ActionsPage.js';
import { createOperateActionDisplayWorkspaceValidator } from '../../../operate/actions/action-model.js';
import { createOperateActionsSurfaceValidator } from '../../../operate/actions/actions-list-model.js';
import { PlanningHandoffPage } from '../../../operate/planning/PlanningHandoffPage.js';

export const actionRoutes = Object.freeze({
  DetailPage: ActionDetailPage,
  ListPage: ActionsPage,
  PlanningHandoffPage,
  createDetailValidator: createOperateActionDisplayWorkspaceValidator,
  createListValidator: createOperateActionsSurfaceValidator,
});
