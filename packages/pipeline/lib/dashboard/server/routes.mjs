/**
 * The dashboard route table and its request dispatcher.
 *
 * Routes are tried in order and the first whose method and `match` accept the request handles
 * it; the order is part of the contract (an exact path precedes the prefix that would also
 * claim it). A route's `family` selects how a thrown failure is answered: `command` routes
 * refuse through the governed command envelope, `planning` routes through the Planning
 * response contract. GET and HEAD requests no route claims are served as static assets.
 */

import { OPERATE_COMMAND_ROUTES } from './command-contracts.mjs';
import { handleOperateCommand, handlePlanningTrace } from './command-routes.mjs';
import {
  handleLocalReview,
  handleLocalReviewIndex,
  handleOperateProjection,
  handleOperateSurface,
  parseOperateRoute,
} from './operate-routes.mjs';
import {
  handlePlanningDetail,
  handlePlanningEvents,
  handlePlanningGraph,
} from './planning-routes.mjs';
import { assertLoopbackRequest } from './platform.mjs';
import {
  handleBootstrap,
  handleEvents,
  handleGraph,
  handleHealth,
  handleMeta,
  handleNode,
  handleStaticAsset,
} from './platform-routes.mjs';
import { commandError, dashboardSafeErrorJson, json, planningResponseError } from './responses.mjs';

function path(expected) {
  return ({ pathname }) => pathname === expected;
}

function pathPrefix(prefix) {
  return ({ pathname }) => pathname.startsWith(prefix);
}

/** Matches on the non-empty path segments, so repeated or trailing slashes do not count. */
function segments(count, ...leading) {
  return ({ parts }) =>
    parts.length === count && parts.slice(0, leading.length).join('/') === leading.join('/');
}

const always = () => true;

export const DASHBOARD_ROUTES = Object.freeze(
  [
    { method: 'GET', match: path('/api/bootstrap'), handle: handleBootstrap },
    {
      method: 'POST',
      match: ({ pathname }) => OPERATE_COMMAND_ROUTES.has(pathname),
      handle: handleOperateCommand,
      family: 'command',
    },
    { method: 'GET', match: path('/health'), handle: handleHealth },
    {
      method: 'GET',
      match: path('/api/planning/graph'),
      handle: handlePlanningGraph,
      family: 'planning',
    },
    {
      method: 'GET',
      match: pathPrefix('/api/planning/detail/'),
      handle: handlePlanningDetail,
      family: 'planning',
    },
    {
      method: 'GET',
      match: path('/api/planning/events'),
      handle: handlePlanningEvents,
      family: 'planning',
    },
    { method: 'GET', match: path('/api/graph'), handle: handleGraph },
    { method: 'GET', match: path('/api/operate/local-reviews'), handle: handleLocalReviewIndex },
    {
      method: 'GET',
      match: segments(4, 'api', 'operate', 'local-reviews'),
      handle: handleLocalReview,
    },
    { method: 'GET', match: path('/api/operate'), handle: handleOperateProjection },
    {
      method: 'GET',
      match: segments(5, 'api', 'operate', 'planning', 'trace'),
      handle: handlePlanningTrace,
      family: 'command',
    },
    {
      method: 'GET',
      match: ({ pathname }) =>
        pathname.startsWith('/api/operate/') ? { operateRoute: parseOperateRoute(pathname) } : null,
      handle: handleOperateSurface,
    },
    { method: 'GET', match: path('/api/meta'), handle: handleMeta },
    {
      method: 'GET',
      match: ({ parts }) => parts[0] === 'api' && parts[1] === 'node' && Boolean(parts[2]),
      handle: handleNode,
    },
    { method: 'GET', match: path('/api/events'), handle: handleEvents },
    { method: 'GET', match: always, handle: handleStaticAsset },
    { method: 'HEAD', match: always, handle: handleStaticAsset },
  ].map((route) => Object.freeze(route)),
);

/** Loopback failures and handler errors on these requests are answered as command refusals. */
function isCommandRequest(method, pathname) {
  return (
    (method === 'POST' && OPERATE_COMMAND_ROUTES.has(pathname)) ||
    (method === 'GET' && pathname.startsWith('/api/operate/planning/trace/'))
  );
}

/** Answer a failed request with the envelope of its family; nothing from the failure is echoed. */
function answerRequestFailure(err, { req, res, pathname, commandRequest, planningRequest }) {
  if (String(err?.code ?? '').startsWith('E_LOOPBACK_')) {
    if (req.method === 'GET' && pathname === '/api/bootstrap' && err.code === 'E_LOOPBACK_HOST') {
      return dashboardSafeErrorJson(res, 400, {
        code: 'DASHBOARD_LOOPBACK_HOST_INVALID',
        retryable: false,
        context: {},
      });
    }
    if (commandRequest) {
      return commandError(res, {
        code: 'OPERATE_ORIGIN_INVALID',
        status: 403,
      });
    }
    return dashboardSafeErrorJson(res, 400, {
      code: 'DASHBOARD_LOOPBACK_REQUEST_REJECTED',
      retryable: false,
      context: {},
    });
  }
  if (commandRequest) return commandError(res, err);
  if (planningRequest) return planningResponseError(res);
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return undefined;
  }
  return json(res, 500, { error: 'dashboard request unavailable' });
}

/** Serve one request against `dashboard`, the server-owned route context. */
export async function handleDashboardRequest(dashboard, req, res) {
  const request = { req, res, pathname: null, commandRequest: false, planningRequest: false };
  try {
    const url = new URL(req.url, 'http://localhost');
    request.pathname = url.pathname;
    request.commandRequest = isCommandRequest(req.method, url.pathname);
    assertLoopbackRequest(req, {
      port: req.socket.localPort,
      mutating: req.method !== 'GET' && req.method !== 'HEAD',
      hosts: ['127.0.0.1', 'localhost'],
    });
    const context = {
      dashboard,
      req,
      res,
      url,
      pathname: url.pathname,
      parts: url.pathname.split('/').filter(Boolean),
      match: null,
    };
    for (const route of DASHBOARD_ROUTES) {
      const match = route.method === req.method && route.match(context);
      if (!match) continue;
      if (route.family === 'command') request.commandRequest = true;
      if (route.family === 'planning') request.planningRequest = true;
      context.match = match;
      return await route.handle(context);
    }
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return answerRequestFailure(err, request);
  }
}
