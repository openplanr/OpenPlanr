import { InboxPage } from '../../../operate/inbox/InboxPage.js';
import { createOperateInboxDisplayValidator } from '../../../operate/inbox/inbox-model.js';
import { RecoveryPage } from '../../../operate/recovery/RecoveryPage.js';
import { createOperateRecoveryDisplayValidator } from '../../../operate/recovery/recovery-model.js';

export const inboxRecoveryRoutes = Object.freeze({
  InboxPage,
  RecoveryPage,
  createInboxValidator: createOperateInboxDisplayValidator,
  createRecoveryValidator: createOperateRecoveryDisplayValidator,
});
