import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleOperateCommand,
  handlePlanningTrace,
} from '../../lib/dashboard/server/command-routes.mjs';
import {
  handleLocalReviewIndex,
  handleOperateProjection,
  handleOperateSurface,
} from '../../lib/dashboard/server/operate-routes.mjs';
import { handlePlanningGraph } from '../../lib/dashboard/server/planning-routes.mjs';
import { handleHealth, handleMeta } from '../../lib/dashboard/server/platform-routes.mjs';
import { DASHBOARD_ROUTES } from '../../lib/dashboard/server/routes.mjs';

const PROJECT_ID = `sha256:${'a'.repeat(64)}`;

function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    write(chunk) {
      this.body += chunk;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function fakeContext({ method = 'GET', target, headers = {}, dashboard = {}, match = null }) {
  const url = new URL(target, 'http://localhost');
  return {
    dashboard,
    req: {
      method,
      headers,
      headersDistinct: Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, [value]]),
      ),
      socket: { localPort: 7473 },
    },
    res: fakeResponse(),
    url,
    pathname: url.pathname,
    parts: url.pathname.split('/').filter(Boolean),
    match,
  };
}

function routeFor(method, target) {
  const context = fakeContext({ method, target });
  const route = DASHBOARD_ROUTES.find(
    (candidate) => candidate.method === method && candidate.match(context),
  );
  return route ? { handle: route.handle.name, family: route.family ?? null } : null;
}

test('the route table keeps exact paths ahead of the prefixes that would also claim them', () => {
  assert.deepEqual(routeFor('GET', '/api/operate/local-reviews'), {
    handle: 'handleLocalReviewIndex',
    family: null,
  });
  assert.deepEqual(routeFor('GET', '/api/operate/local-reviews/2026-09-14-review'), {
    handle: 'handleLocalReview',
    family: null,
  });
  assert.deepEqual(routeFor('GET', '/api/operate/planning/trace/SPEC-001'), {
    handle: 'handlePlanningTrace',
    family: 'command',
  });
  assert.deepEqual(routeFor('GET', '/api/operate/today'), {
    handle: 'handleOperateSurface',
    family: null,
  });
  assert.deepEqual(routeFor('POST', '/api/operate/session'), {
    handle: 'handleOperateCommand',
    family: 'command',
  });
  assert.deepEqual(routeFor('GET', '/api/planning/detail/SPEC-001'), {
    handle: 'handlePlanningDetail',
    family: 'planning',
  });
  assert.deepEqual(routeFor('GET', '/api/node/SPEC-001/US-001'), {
    handle: 'handleNode',
    family: null,
  });
  assert.deepEqual(routeFor('HEAD', '/api/graph'), { handle: 'handleStaticAsset', family: null });
  assert.equal(routeFor('POST', '/health'), null);
  assert.equal(routeFor('PUT', '/api/operate/session'), null);
});

test('platform routes answer health and shell metadata from a fake context', () => {
  const health = fakeContext({ target: '/health' });
  handleHealth(health);
  assert.equal(health.res.status, 200);
  assert.equal(health.res.json().kind, 'openplanr-dashboard');
  assert.equal(health.res.json().pid, process.pid);

  const graph = { nodes: [{ id: 'SPEC-001', type: 'spec' }], edges: [] };
  const meta = fakeContext({
    target: '/api/meta',
    dashboard: { planrDir: '/work/acme/.planr', planning: { ensureGraph: () => graph } },
  });
  handleMeta(meta);
  assert.equal(meta.res.status, 200);
  assert.deepEqual(
    { repo: meta.res.json().repo, specs: meta.res.json().specs, mode: meta.res.json().mode },
    { repo: 'acme', specs: 1, mode: 'spec' },
  );
});

test('planning routes refuse an unbound request and serve the bound envelope', () => {
  const planning = { graphEnvelope: (binding) => ({ kind: 'planning-graph-snapshot', binding }) };
  const dashboard = { project: { projectId: PROJECT_ID }, planningActorId: 'owner-acme', planning };
  const unbound = fakeContext({ target: '/api/planning/graph', dashboard });
  handlePlanningGraph(unbound);
  assert.equal(unbound.res.status, 403);
  assert.equal(unbound.res.json().error.code, 'CAPABILITY_DENIED');

  const query = new URLSearchParams({
    projectId: PROJECT_ID,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: '0',
  });
  const bound = fakeContext({
    target: `/api/planning/graph?${query}`,
    headers: { 'x-openplanr-actor': 'owner-acme' },
    dashboard,
  });
  handlePlanningGraph(bound);
  assert.equal(bound.res.status, 200);
  assert.equal(bound.res.headers['cache-control'], 'no-store');
  assert.equal(bound.res.json().binding.actorId, 'owner-acme');
});

test('operate read routes answer undocumented shapes and queries with closed refusals', async () => {
  const unknownShape = fakeContext({
    target: '/api/operate/unknown',
    match: { operateRoute: null },
  });
  await handleOperateSurface(unknownShape);
  assert.equal(unknownShape.res.status, 400);
  assert.equal(unknownShape.res.json().error.reasonCode, 'OPERATE_ROUTE_INVALID');

  const pages = fakeContext({ target: '/api/operate/local-reviews?page=1&page=2' });
  handleLocalReviewIndex(pages);
  assert.equal(pages.res.status, 400);
  assert.equal(pages.res.json().error.code, 'DASHBOARD_RESPONSE_INVALID');

  const projection = fakeContext({
    target: '/api/operate',
    dashboard: { getOperatingProjection: () => ({ available: false }) },
  });
  handleOperateProjection(projection);
  assert.deepEqual(projection.res.json(), { available: false });
});

test('command routes refuse without effect before any gateway is resolved', async () => {
  const resolved = [];
  const operate = {
    resolveCommandGateway: () => resolved.push('command'),
    resolvePlanningGateway: () => resolved.push('planning'),
  };
  const session = fakeContext({
    method: 'POST',
    target: '/api/operate/session?scopeId=s&domainId=d&domainVersion=1.0.0',
    dashboard: { operate },
  });
  await handleOperateCommand(session);
  assert.equal(session.res.status, 403);
  assert.equal(session.res.json().error.reasonCode, 'OPERATE_ORIGIN_INVALID');

  const trace = fakeContext({
    target: '/api/operate/planning/trace/-spec',
    dashboard: { operate },
  });
  await handlePlanningTrace(trace);
  assert.equal(trace.res.status, 400);
  assert.equal(trace.res.json().error.reasonCode, 'OPERATE_COMMAND_INVALID');
  assert.deepEqual(resolved, []);
});
