/** Dashboard server entry; importing it does not load the package root. */

export { listDashboardServers, stopDashboardServer } from './server/lifecycle.mjs';
export { createDashboardServer as startDashboard } from './server.mjs';
