/** Explicit daemon and static-asset platform surface owned by the dashboard server. */

export { MIME } from '../../design/mime-types.mjs';
export { serveStaticFile } from '../../design/path-util.mjs';
export { planrHome } from '../../design-engine/paths.mjs';
export {
  assertLoopbackRequest,
  listenLoopback,
  probeLoopbackJson,
  writePidFile,
} from '../../design-engine/server-util.mjs';
export { resolvePackagedDashboardRoot } from '../resolve-packaged-dashboard-root.mjs';
export { createWatcher } from '../watcher.mjs';
