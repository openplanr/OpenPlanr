/** Explicit daemon and static-asset platform surface owned by the dashboard server. */
export { planrHome } from '../../design-engine/paths.mjs';
export {
  assertLoopbackRequest,
  writePidFile,
  listenLoopback,
  probeLoopbackJson,
} from '../../design-engine/server-util.mjs';
export { MIME } from '../../design/mime-types.mjs';
export { serveStaticFile } from '../../design/path-util.mjs';
export { createWatcher } from '../watcher.mjs';
export { resolvePackagedDashboardRoot } from '../resolve-packaged-dashboard-root.mjs';
