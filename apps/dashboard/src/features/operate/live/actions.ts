import { ActionDetailPage } from '../actions/ActionDetailPage.js';
import { ActionsPage } from '../actions/ActionsPage.js';
import { createOperateActionDisplayWorkspaceValidator } from '../actions/action-model.js';
import { createOperateActionsSurfaceValidator } from '../actions/actions-list-model.js';
import {
  fetchOperateActionDisplay,
  fetchOperateActionsDisplay,
} from '../actions/operate-action-api.js';
import { PlanningHandoffPage } from '../planning/PlanningHandoffPage.js';

export const liveActionCapabilities = Object.freeze({
  DetailPage: ActionDetailPage,
  ListPage: ActionsPage,
  PlanningHandoffPage,
  createDetailValidator: createOperateActionDisplayWorkspaceValidator,
  createListValidator: createOperateActionsSurfaceValidator,
  fetchDetail: fetchOperateActionDisplay,
  fetchList: fetchOperateActionsDisplay,
});
