import { liveActionCapabilities } from './actions.js';
import { liveInboxRecoveryCapabilities } from './inbox-recovery.js';
import { liveProjectionCapabilities } from './platform.js';

export const operateLiveCapabilities = Object.freeze({
  actions: liveActionCapabilities,
  inboxRecovery: liveInboxRecoveryCapabilities,
  projection: liveProjectionCapabilities,
});

export type {
  DashboardProductState,
  DashboardProductStateKind,
  DashboardQueryIdentity,
} from './platform.js';
