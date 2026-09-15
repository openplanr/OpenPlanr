import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createGovernedCommandLifecycle,
  type GovernedCommandConfirmation,
  type GovernedCommandLocator,
  type GovernedCommandPreview,
} from '../governed-command-lifecycle.js';

export type InboxActionLocator = GovernedCommandLocator;
export type InboxActionConfirmation = GovernedCommandConfirmation;
export type InboxActionPreview = GovernedCommandPreview;

export type InboxActions = Readonly<{
  bind(identity: DashboardQueryIdentity): void;
  preview(locator: InboxActionLocator): Promise<InboxActionPreview>;
  reconcile(identity: DashboardQueryIdentity): void;
  cancel(): void;
  dispose(): void;
}>;

export type InboxActionsOptions = Readonly<{
  origin: string;
  fetcher?: typeof fetch;
}>;

/** Thin Inbox-route adapter over the one private governed command lifecycle. */
export function createInboxActions(options: InboxActionsOptions): InboxActions {
  return createGovernedCommandLifecycle({
    ...options,
    routeKinds: ['operate.inbox', 'operate.inbox-item'],
    routeErrorCode: 'OPERATE_INBOX_ROUTE_REQUIRED',
  });
}
