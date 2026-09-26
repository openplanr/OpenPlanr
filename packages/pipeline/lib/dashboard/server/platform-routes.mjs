/** Platform routes: health, bootstrap, shell metadata, the legacy graph API and static assets. */

import { dirname, sep } from 'node:path';

import {
  DASHBOARD_SERVER_KIND,
  DASHBOARD_VIEWS,
  DEFAULT_VIEW,
  readGitBranch,
  readPackageVersion,
} from './identity.mjs';
import { assertDashboardBootstrapV1 } from './operate.mjs';
import { supportsOperateSession } from './operate-state.mjs';
import {
  detectMode,
  PLANNING_DOMAIN_ID,
  PLANNING_DOMAIN_VERSION,
  PLANNING_SCOPE_ID,
} from './planning.mjs';
import { MIME, serveStaticFile } from './platform.mjs';
import { dashboardSafeErrorJson, json } from './responses.mjs';

/** Owner-issued query roots: Operate from the current view, Planning from the configured actor. */
function dashboardQueryRoots({ operate, planningActorId, project }) {
  const experience = operate.ensureExperience();
  const view = experience?.view;
  const operateRoot =
    view &&
    [view.actorId, view.scopeId, view.domainId, view.domainVersion].every(
      (value) => typeof value === 'string' && value.length > 0,
    )
      ? Object.freeze({
          actorId: view.actorId,
          projectId: project.projectId,
          scopeId: view.scopeId,
          domainId: view.domainId,
          domainVersion: view.domainVersion,
          generation: 0,
        })
      : null;
  const planning =
    planningActorId === null
      ? null
      : Object.freeze({
          actorId: planningActorId,
          projectId: project.projectId,
          scopeId: PLANNING_SCOPE_ID,
          domainId: PLANNING_DOMAIN_ID,
          domainVersion: PLANNING_DOMAIN_VERSION,
          generation: 0,
        });
  return Object.freeze({ planning, operate: operateRoot });
}

export function handleBootstrap({ dashboard, req, res }) {
  const { manifest, expectedBuildId, project } = dashboard;
  const hostHeaders = req.headersDistinct?.host;
  const requestedHost =
    typeof req.headers.host === 'string' && Array.isArray(hostHeaders) && hostHeaders.length === 1
      ? req.headers.host
      : '';
  const hostMatch = requestedHost.match(/^(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/u);
  const localPort = req.socket.localPort;
  const origin = hostMatch && Number(hostMatch[2]) === localPort ? `http://${requestedHost}` : null;
  if (!origin) {
    return dashboardSafeErrorJson(res, 400, {
      code: 'DASHBOARD_LOOPBACK_HOST_INVALID',
      retryable: false,
      context: {},
    });
  }
  const reasonCodes = [...manifest.reasonCodes];
  if (manifest.buildId !== expectedBuildId && !reasonCodes.includes('DASHBOARD_BUILD_MISMATCH'))
    reasonCodes.push('DASHBOARD_BUILD_MISMATCH');
  const body = {
    kind: 'dashboard-bootstrap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ui: {
      buildId: manifest.buildId,
      expectedBuildId,
      assetManifestHash: manifest.assetManifestHash,
    },
    server: { packageVersion: readPackageVersion() },
    capabilities: {
      planningGraph: { schemaVersion: '1.0.0' },
      operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
      operateCommands: {
        protocolVersion: '2.0.0',
        transportVersion: '1.0.0',
        available: supportsOperateSession(dashboard.operate.resolveCommandGateway()),
      },
      diagnostics: { schemaVersion: '1.0.0', available: true },
    },
    project,
    queryRoots: dashboardQueryRoots(dashboard),
    origin,
    compatibility: {
      status: reasonCodes.length === 0 ? 'compatible' : 'incompatible',
      reasonCodes,
    },
  };
  try {
    assertDashboardBootstrapV1(body);
  } catch {
    return dashboardSafeErrorJson(res, 500, {
      code: 'DASHBOARD_BOOTSTRAP_INVALID',
      retryable: false,
      context: {},
    });
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
  return undefined;
}

export function handleHealth({ res }) {
  return json(res, 200, {
    ok: true,
    kind: DASHBOARD_SERVER_KIND,
    version: readPackageVersion(),
    pid: process.pid,
  });
}

export function handleGraph({ dashboard, res }) {
  return json(res, 200, dashboard.planning.ensureGraph());
}

/**
 * Shell metadata: lets the client pre-select the landing view, render the
 * planr-dir breadcrumb, and show the version chip without hard-coding any
 * of it (the version comes from package.json — one source of truth).
 */
export function handleMeta({ dashboard, res }) {
  const { planrDir } = dashboard;
  const metaGraph = dashboard.planning.ensureGraph();
  const repoRoot = dirname(planrDir);
  return json(res, 200, {
    version: readPackageVersion(),
    planrDir,
    repo: repoRoot.split(sep).filter(Boolean).pop() || 'project',
    branch: readGitBranch(repoRoot),
    specs: (metaGraph.nodes || []).filter((n) => n && n.type === 'spec').length,
    mode: detectMode(metaGraph),
    views: DASHBOARD_VIEWS,
    defaultView: DEFAULT_VIEW,
  });
}

export function handleNode({ dashboard, res, parts }) {
  const id = decodeURIComponent(parts.slice(2).join('/'));
  const node = dashboard.planning.readNode(id);
  if (!node) return json(res, 404, { error: `unknown node "${id}"` });
  return json(res, 200, node);
}

export function handleEvents({ dashboard, req, res }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('event: ready\n');
  res.write(`data: ${JSON.stringify({ ok: true, pid: process.pid })}\n\n`);
  dashboard.legacyClients.add(res);
  req.on('close', () => dashboard.legacyClients.delete(res));
  return undefined; // keep the stream open
}

export function handleStaticAsset({ dashboard, res, pathname }) {
  return serveStaticFile(res, dashboard.staticRoot, pathname, MIME);
}
