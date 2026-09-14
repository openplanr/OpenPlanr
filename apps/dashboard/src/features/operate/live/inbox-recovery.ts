import {
  fetchOperateInboxDisplay,
  fetchOperateRecoveryDisplay,
} from '../actions/operate-action-api.js';
import { InboxPage } from '../inbox/InboxPage.js';
import { createOperateInboxDisplayValidator } from '../inbox/inbox-model.js';
import { RecoveryPage } from '../recovery/RecoveryPage.js';
import { createOperateRecoveryDisplayValidator } from '../recovery/recovery-model.js';

export const liveInboxRecoveryCapabilities = Object.freeze({
  InboxPage,
  RecoveryPage,
  createInboxValidator: createOperateInboxDisplayValidator,
  createRecoveryValidator: createOperateRecoveryDisplayValidator,
  fetchInbox: fetchOperateInboxDisplay,
  fetchRecovery: fetchOperateRecoveryDisplay,
});
