import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createGovernedCommandLifecycle,
  type GovernedCommandConfirmation,
  type GovernedCommandLifecycle,
  type GovernedCommandLocator,
  type GovernedCommandPreview,
} from '../governed-command-lifecycle.js';

export type ActionActionLocator = GovernedCommandLocator;
export type ActionActionConfirmation = GovernedCommandConfirmation;
export type ActionActionPreview = GovernedCommandPreview;

export type ActionActions = Readonly<{
  bind(identity: DashboardQueryIdentity): void;
  preview(locator: ActionActionLocator): Promise<ActionActionPreview>;
  reconcile(identity: DashboardQueryIdentity): void;
  cancel(): void;
  dispose(): void;
}>;

export type ActionActionsOptions = Readonly<{
  origin: string;
  fetcher?: typeof fetch;
}>;

/** Thin Action-route adapter over the one private governed command lifecycle. */
export function createActionActions(options: ActionActionsOptions): ActionActions {
  return createGovernedCommandLifecycle({
    ...options,
    routeKinds: ['operate.action'],
    routeErrorCode: 'OPERATE_ACTION_ROUTE_REQUIRED',
    includeOriginHeader: true,
  }) as GovernedCommandLifecycle;
}
