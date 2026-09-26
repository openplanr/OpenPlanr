/**
 * Dashboard HTTP server.
 *
 * A persistent localhost server for the planr dashboard, following the same
 * agent-independent daemon pattern as lib/design-engine/daemon.mjs: the dashboard
 * keeps serving if the launching agent dies, and a second launch on the same port
 * reuses the running server instead of double-binding.
 *
 * Routes (the ordered table lives in server/routes.mjs; graph data comes from graph-engine.mjs):
 *   GET /api/graph      → typed project graph { nodes, edges }   (application/json)
 *   GET /api/node/:id   → a single node with body                (application/json)
 *   GET /api/meta       → { version, planrDir, views, defaultView } (application/json)
 *   GET /api/events     → SSE stream, emits a `ready` event (text/event-stream)
 *   GET /api/operate/*  → bound product views + ordered live patches
 *   GET /health         → { ok, pid }                 (reuse-if-running probe)
 *   GET /*              → static asset from the unified OpenPlanr dashboard build
 *                         (traversal-guarded; see resolve-packaged-dashboard-root.mjs)
 *
 * State: <planrHome>/dashboard-daemon/{port} PID file (reuse detection) +
 * <planrHome>/dashboard-daemon/port (last bound port, discovery).
 *
 * Stdlib only — no npm runtime dependency. Live sync: when watching is
 * enabled the server starts lib/dashboard/watcher.mjs, keeps an in-memory
 * `currentGraph` cache that the watcher's diff events patch, and broadcasts each
 * patch to every open /api/events SSE client. `--no-watch` suppresses startup.
 */

import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  DASHBOARD_BUILD_ID,
  DASHBOARD_SERVER_KIND,
  dashboardManifestState,
  readPackageVersion,
  resolveDashboardStaticRoot,
  safeProjectMetadata,
} from './server/identity.mjs';
import {
  buildOperateExperienceLivePatchV2,
  encodeOperateExperienceCheckpoint,
  readOperateExperienceProjection,
  readOperatingProjection,
  selectOperateExperienceDisplaySurface,
} from './server/operate.mjs';
import { sameExperienceBinding } from './server/operate-routes.mjs';
import { createOperateState } from './server/operate-state.mjs';
import {
  createDashboardLiveEventEnvelope,
  encodePlanningCheckpoint,
  LIVE_ID,
} from './server/planning.mjs';
import { createPlanningState } from './server/planning-state.mjs';
import {
  createWatcher,
  listenLoopback,
  planrHome,
  probeLoopbackJson,
  writePidFile,
} from './server/platform.mjs';
import { sseFrame } from './server/responses.mjs';
import { handleDashboardRequest } from './server/routes.mjs';

export {
  DASHBOARD_SERVER_KIND,
  DASHBOARD_VIEWS,
  DEFAULT_VIEW,
  defaultDashboardStaticRoot,
  resolveDashboardStaticRoot,
} from './server/identity.mjs';
export { parseOperateApiRoute } from './server/operate-routes.mjs';
export {
  assertDashboardLiveEventEnvelope,
  assertPlanningDetailEnvelope,
  assertPlanningGraphEnvelope,
  assertPlanningLiveEventEnvelope,
  assertPlanningPatch,
  createDashboardLiveEventEnvelope,
  decodePlanningCheckpoint,
  encodePlanningCheckpoint,
} from './server/planning.mjs';
export { applyPatch } from './server/planning-state.mjs';
export {
  assertDashboardSafeError,
  DASHBOARD_SAFE_CONTEXT_FIELDS,
  DASHBOARD_SAFE_ERROR_CODES,
  mapDashboardSafeError,
} from './server/responses.mjs';

export const DEFAULT_PORT = 7473;

/** Resolve the `.planr/` directory for a project root (default: <cwd>/.planr). */
export function resolvePlanrDir(projectRoot = process.cwd()) {
  return join(projectRoot, '.planr');
}

/** Per-process state dir for the dashboard daemon (mirrors design-daemon). */
export function dashboardDir(env = process.env) {
  return join(planrHome(env), 'dashboard-daemon');
}

/**
 * Create the dashboard HTTP server. `getGraph` / `getNode` remain injectable so the
 * watcher can supply cached/patched readers without editing this module; the
 * defaults serve the in-memory graph cache, which the watcher
 * patches in place. `watch` (default true) starts the filesystem watcher; pass
 * `watch: false` (the `--no-watch` flag) to suppress it.
 */
export function createDashboardServer({
  staticRoot,
  dashboardBuildId,
  planrDir = resolvePlanrDir(),
  watch = true,
  getGraph,
  getNode,
  planningActorId = null,
  getOperatingProjection = () => readOperatingProjection(planrDir),
  getOperatingExperience = () => readOperateExperienceProjection(planrDir),
  getOperatingCycleRead = null,
  getOperatingReviewRead = null,
  getOperatingCommandGateway = null,
  getOperatingPlanningGateway = null,
} = {}) {
  const dashboardStaticRoot = resolveDashboardStaticRoot(staticRoot);
  const dashboardManifest = dashboardManifestState(dashboardStaticRoot);
  if (
    dashboardBuildId !== undefined &&
    (typeof dashboardBuildId !== 'string' || !DASHBOARD_BUILD_ID.test(dashboardBuildId))
  ) {
    throw new TypeError('dashboardBuildId must be a valid embedded dashboard build identity');
  }
  const expectedDashboardBuildId = dashboardBuildId ?? dashboardManifest.buildId;
  const project = safeProjectMetadata(planrDir);
  if (
    planningActorId !== null &&
    (typeof planningActorId !== 'string' || !LIVE_ID.test(planningActorId))
  ) {
    throw new TypeError('planningActorId must be a valid public actor identity');
  }
  const planning = createPlanningState({ planrDir, getGraph, getNode });
  const operate = createOperateState({
    getOperatingExperience,
    getOperatingCommandGateway,
    getOperatingPlanningGateway,
  });

  /** Open legacy /api/events connections — the watcher broadcasts each patch to all of them. */
  const sseClients = new Set();

  /** Watcher handle (started in listen() unless watching is disabled). */
  let watcher = null;

  /** Set by listen(): whether the last bind reused a running server, and its pid. */
  let reused = false;
  let ownerPid = process.pid;

  /**
   * Receive a watcher patch: update the in-memory cache, then push the patch to
   * every open SSE client as a default `message` event (the client merges it in
   * place, preserving selection / view / zoom / filters).
   */
  const onWatcherPatch = (patch) => {
    let prepared;
    try {
      prepared = planning.preparePatch(patch);
    } catch {
      for (const client of planning.clients) {
        try {
          const event = planning.staleEvent(client.binding, 'PLANNING_PATCH_INVALID');
          client.res.write(sseFrame('stale', event, encodePlanningCheckpoint(event.cursor)));
        } catch {
          planning.clients.delete(client);
        }
      }
      return false;
    }
    const { signal, to } = planning.commitPatch(prepared);

    const frame = `data: ${JSON.stringify(prepared.accepted)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
    for (const client of planning.clients) {
      try {
        const event = planning.liveEnvelope('patch', client.binding, to, signal);
        client.res.write(sseFrame('patch', event, encodePlanningCheckpoint(to)));
      } catch {
        planning.clients.delete(client);
      }
    }
    return true;
  };

  const onExperienceChange = ({ previous, next }) => {
    operate.replaceExperience(next);
    const before = previous?.view;
    const after = next?.view;
    let patch = null;
    if (before && after) {
      try {
        patch = buildOperateExperienceLivePatchV2(before, after);
        operate.rememberPatch(patch);
      } catch {
        patch = null;
      }
    }
    for (const client of operate.clients) {
      try {
        if (!after || !sameExperienceBinding(after, client.binding)) {
          const fallback = before ?? after;
          if (!fallback) continue;
          const cursor = { eventHead: fallback.eventHead, viewHash: fallback.viewHash };
          client.res.write(
            sseFrame(
              'stale',
              createDashboardLiveEventEnvelope({
                event: 'stale',
                binding: client.binding,
                cursor,
                payload: {
                  mutationEnabled: false,
                  reasonCodes: ['OPERATE_PROJECTION_UNAVAILABLE'],
                  recovery: 'Refresh the validated snapshot before submitting any command.',
                },
              }),
            ),
          );
        } else if (client.surface === 'inbox') {
          const cursor = { eventHead: after.eventHead, viewHash: after.viewHash };
          const surface = selectOperateExperienceDisplaySurface(after, {
            surface: 'inbox',
            binding: {
              actorId: client.binding.actorId,
              scopeId: client.binding.scopeId,
              domainId: client.binding.domainId,
              domainVersion: client.binding.domainVersion,
              generatedAt: after.generatedAt,
              eventHead: after.eventHead,
              viewHash: after.viewHash,
              surface: 'inbox',
              projectId: client.binding.projectId,
              generation: client.binding.generation,
              subjectId: null,
            },
          });
          if (surface?.kind !== 'operate-experience-display-surface') {
            throw new TypeError('The live Inbox display could not be issued.');
          }
          client.res.write(
            sseFrame(
              'snapshot',
              createDashboardLiveEventEnvelope({
                event: 'snapshot',
                binding: client.binding,
                cursor,
                payload: surface,
              }),
              encodeOperateExperienceCheckpoint(cursor),
            ),
          );
          client.res.write(
            sseFrame(
              'ready',
              createDashboardLiveEventEnvelope({
                event: 'ready',
                binding: client.binding,
                cursor,
                payload: {
                  mutationEnabled:
                    surface.payload.status === 'ready' && surface.payload.mutationEnabled === true,
                  reasonCodes: surface.payload.reasonCodes,
                },
              }),
              encodeOperateExperienceCheckpoint(cursor),
            ),
          );
        } else if (
          patch &&
          patch.actorId === client.binding.actorId &&
          patch.scopeId === client.binding.scopeId &&
          patch.domainId === client.binding.domainId &&
          patch.domainVersion === client.binding.domainVersion
        ) {
          const cursor = { eventHead: patch.toEventHead, viewHash: patch.toViewHash };
          client.res.write(
            sseFrame(
              'patch',
              createDashboardLiveEventEnvelope({
                event: 'patch',
                binding: client.binding,
                cursor,
                payload: patch,
              }),
              encodeOperateExperienceCheckpoint(cursor),
            ),
          );
        } else {
          const cursor = { eventHead: after.eventHead, viewHash: after.viewHash };
          client.res.write(
            sseFrame(
              'stale',
              createDashboardLiveEventEnvelope({
                event: 'stale',
                binding: client.binding,
                cursor,
                payload: {
                  mutationEnabled: false,
                  reasonCodes: ['OPERATE_EVENT_GAP'],
                  recovery: 'Refresh the validated snapshot before submitting any command.',
                },
              }),
              encodeOperateExperienceCheckpoint(after),
            ),
          );
        }
      } catch {
        operate.clients.delete(client);
      }
    }
  };

  const refreshOperatingExperience = () => {
    const previous = operate.ensureExperience();
    const next = operate.readExperience();
    onExperienceChange({ previous, next });
    return next;
  };

  const dashboard = Object.freeze({
    planrDir,
    project,
    planningActorId,
    staticRoot: dashboardStaticRoot,
    manifest: dashboardManifest,
    expectedBuildId: expectedDashboardBuildId,
    planning,
    operate,
    legacyClients: sseClients,
    getOperatingProjection,
    getOperatingCycleRead,
    getOperatingReviewRead,
    refreshOperatingExperience,
  });
  const server = createServer((req, res) => handleDashboardRequest(dashboard, req, res));

  return {
    server,
    sseClients,
    planningSseClients: planning.clients,
    operateSseClients: operate.clients,
    /** Validated immutable asset root selected for this server instance. */
    staticRoot: dashboardStaticRoot,
    /** Current in-memory graph (for tests / introspection). */
    getCurrentGraph: () => planning.ensureGraph(),
    /** Current committed Planning transport cursor (for tests / introspection). */
    getPlanningCursor: () => planning.cursor(),
    /** The watcher and focused contract tests share this single validated ingress. */
    acceptPlanningWatcherPatch: onWatcherPatch,
    /** Current access-safe experience read result (for tests / introspection). */
    getCurrentExperience: () => operate.ensureExperience(),
    /** Process-local gateway only; null keeps every command route read-only. */
    getOperatingCommandGateway: () => operate.resolveCommandGateway(),
    /** Planning gateway is separate from generic governed command authority. */
    getOperatingPlanningGateway: () => operate.resolvePlanningGateway(),
    /** Re-read the public projection now (the watcher calls the same path). */
    refreshOperatingExperience,
    /** True when the filesystem watcher is running. */
    isWatching: () => watcher != null,
    /**
     * Broadcast a named SSE event to every open /api/events client. Patches are
     * pushed as default `message` events via onWatcherPatch; this stays for the
     * `ready`-style named events.
     */
    broadcast(event, payload) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) client.write(frame);
    },
    /** True when the last listen() reused a running server instead of binding. */
    get reused() {
      return reused;
    },
    /** Pid of the server the last listen() bound or reused (never a stale guess). */
    get ownerPid() {
      return ownerPid;
    },
    /**
     * Bind on 127.0.0.1 and write the port + PID files for reuse discovery.
     * A failed bind rejects (never an uncaught 'error' event). On EADDRINUSE, a
     * compatible running dashboard on the same port is reused instead of crashing;
     * an incompatible or unreachable occupant fails with a typed error.
     */
    async listen(port = DEFAULT_PORT, { env = process.env } = {}) {
      reused = false;
      ownerPid = process.pid;
      let actual;
      try {
        actual = await listenLoopback(server, port);
      } catch (error) {
        if (error?.code === 'EADDRINUSE' && Number(port) > 0) {
          const existing = await probeLoopbackJson(port, '/health');
          if (
            existing?.ok === true &&
            existing.kind === DASHBOARD_SERVER_KIND &&
            existing.version === readPackageVersion()
          ) {
            reused = true;
            ownerPid =
              Number.isInteger(existing.pid) && existing.pid > 0 ? existing.pid : process.pid;
            return port;
          }
          throw Object.assign(
            new Error(
              `Port ${port} is already in use by a process that is not a compatible dashboard.`,
            ),
            { code: 'E_DASHBOARD_PORT_IN_USE' },
          );
        }
        throw error;
      }
      const stateDir = dashboardDir(env);
      writePidFile(stateDir, actual);
      writePidFile(stateDir, 'port', actual); // last-bound port for discovery
      // Start live sync unless suppressed by --no-watch. The watcher is
      // seeded with the current cache so its first patch is a true diff.
      if (watch && !watcher) {
        const initialExperience = operate.ensureExperience();
        watcher = createWatcher(planrDir, {
          onPatch: onWatcherPatch,
          initialGraph: planning.ensureGraph(),
          buildGraph: (_directory, options) => planning.readFreshGraph(options),
          getExperience: operate.readExperience,
          initialExperience,
          onExperience: onExperienceChange,
        });
        watcher.start();
      }
      return actual;
    },
    close: () =>
      new Promise((r) => {
        if (watcher) {
          watcher.stop();
          watcher = null;
        }
        for (const client of sseClients) client.end();
        sseClients.clear();
        for (const client of planning.clients) client.res.end();
        planning.clients.clear();
        for (const client of operate.clients) client.res.end();
        operate.clients.clear();
        server.close(r);
      }),
  };
}

// CLI entry: `node server.mjs --serve [port] [--no-watch]`
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop()) &&
  process.argv.includes('--serve')
) {
  const serveArg = process.argv[process.argv.indexOf('--serve') + 1];
  const portArg = Number(serveArg) || DEFAULT_PORT;
  // --no-watch suppresses the filesystem watcher (live sync off).
  const watch = !process.argv.includes('--no-watch');
  const dash = createDashboardServer({ watch });
  dash
    .listen(portArg)
    .then((port) => {
      process.stdout.write(`DASHBOARD_URL: http://localhost:${port}/\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          ok: false,
          code: error?.code ?? 'E_DASHBOARD_LISTEN',
          problem: error?.message ?? 'The dashboard server failed to start.',
        })}\n`,
      );
      process.exitCode = 1;
    });
}
