import { createOperateActionDisplayWorkspaceValidator } from '../../../features/operate/actions/action-model.js';
import { createOperateActionsSurfaceValidator } from '../../../features/operate/actions/actions-list-model.js';
import {
  fetchOperateActionDisplay,
  fetchOperateActionsDisplay,
  fetchOperateInboxDisplay,
  fetchOperateRecoveryDisplay,
} from '../../../features/operate/actions/operate-action-api.js';
import { createOperateInboxDisplayValidator } from '../../../features/operate/inbox/inbox-model.js';
import { createOperateRecoveryDisplayValidator } from '../../../features/operate/recovery/recovery-model.js';

export const operateActionRuntime = Object.freeze({
  createDetailValidator: createOperateActionDisplayWorkspaceValidator,
  createInboxValidator: createOperateInboxDisplayValidator,
  createListValidator: createOperateActionsSurfaceValidator,
  createRecoveryValidator: createOperateRecoveryDisplayValidator,
  fetchDetail: fetchOperateActionDisplay,
  fetchInbox: fetchOperateInboxDisplay,
  fetchList: fetchOperateActionsDisplay,
  fetchRecovery: fetchOperateRecoveryDisplay,
});
