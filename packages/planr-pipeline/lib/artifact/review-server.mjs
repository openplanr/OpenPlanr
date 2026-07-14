import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acquireStartLock,
  assertLoopbackRequest,
  closeHttpServer,
  listenLoopback,
  LOOPBACK_HOST,
  probeLoopbackJson,
  readJsonState,
  readRequestBody,
  writePrivateJsonState,
} from '../design-engine/server-util.mjs';
import {
  isCapabilityToken,
  mintCapabilityToken,
  timingSafeTokenEqual,
} from '../design-engine/board-token.mjs';
import { planrHome } from '../design-engine/paths.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';
import { digestArtifactEnvelope, validateArtifactEnvelope, validateArtifactReview } from './envelope.mjs';
import { resolveArtifactReviewDestination } from './import.mjs';
import {
  createReviewLedger,
  effectiveReviewDecision,
  mergeReviewLedger,
} from './merge.mjs';
import {
  ARTIFACT_REVIEW_MAX_STATE_BYTES as REVIEW_STATE_MAX_BYTES,
  exportArtifactReview,
  readArtifactReviewState,
  withArtifactReviewLock,
  writeArtifactReviewState,
} from './review.mjs';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
} from './bridge.mjs';
import { renderArtifactShellDocument } from './ui/shell.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const STAGE_RUNTIME_PATH = join(here, '..', '..', 'templates', 'artifact-review-stage.js');

export const ARTIFACT_REVIEW_SERVER_VERSION = 1;
export const ARTIFACT_REVIEW_SERVER_KIND = 'artifact-review';
// A valid 10 MiB HTML bundle can expand close to sixfold when JSON escapes
// control characters. Keep the private control transport coherent with the
// public engine limit instead of rejecting an otherwise valid envelope.
export const ARTIFACT_REVIEW_MAX_CONTROL_BYTES = 64 * 1024 * 1024;
export const ARTIFACT_REVIEW_MAX_STATE_BYTES = REVIEW_STATE_MAX_BYTES;

const SESSION_ID_BYTES = 16;
const CONTROL_TOKEN_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;
const MAX_URL_BYTES = 4_096;
const TITLE_LIMIT = 512;
const THEME_VALUES = new Set(['auto', 'light', 'dark']);
const localServers = new Map();

const PARENT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' data: blob:",
  "script-src 'self' 'unsafe-inline' data: blob:",
  'frame-src blob:',
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'self'",
  'worker-src data: blob:',
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const PERMISSIONS_POLICY = [
  'accelerometer=()', 'ambient-light-sensor=()', 'autoplay=()', 'camera=()',
  'clipboard-read=()', 'clipboard-write=(self)', 'display-capture=()',
  'encrypted-media=()', 'fullscreen=()', 'geolocation=()',
  'gyroscope=()', 'hid=()', 'identity-credentials-get=()', 'magnetometer=()',
  'microphone=()', 'midi=()', 'payment=()', 'publickey-credentials-get=()',
  'picture-in-picture=()', 'screen-wake-lock=()', 'serial=()', 'usb=()',
  'web-share=()', 'xr-spatial-tracking=()',
].join(', ');

function artifactError(code, message, fix = '', details) {
  return new PipelineError(code, message, fix, details);
}

function reviewStateDir(env = process.env) {
  return join(planrHome(env), 'artifact-daemon');
}

export function artifactReviewStatePath(port = 0, env = process.env) {
  const suffix = port === 0 ? 'default' : String(port);
  return join(reviewStateDir(env), `state-${suffix}.json`);
}

function stateLockPath(port, env) {
  const suffix = port === 0 ? 'default' : String(port);
  return join(reviewStateDir(env), `start-${suffix}.lock`);
}

function statusForError(error) {
  if (error?.code === 'E_REQUEST_BODY_LIMIT' || error?.code === ARTIFACT_ERROR_CODES.REQUEST_LIMIT) return 413;
  if (['E_LOOPBACK_HOST', 'E_LOOPBACK_ORIGIN', 'E_LOOPBACK_FETCH_SITE'].includes(error?.code)) return 403;
  if (error?.code === ARTIFACT_ERROR_CODES.LOOPBACK_STATE) return 503;
  if (error?.code === ARTIFACT_ERROR_CODES.REVIEW_WRITE) return 500;
  if (error instanceof SyntaxError || error instanceof PipelineError) return 400;
  return 500;
}

function commonHeaders() {
  return {
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-robots-tag': 'noindex, nofollow, noarchive',
  };
}

function parentHeaders() {
  return {
    ...commonHeaders(),
    'content-security-policy': PARENT_CSP,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': PERMISSIONS_POLICY,
    'x-frame-options': 'DENY',
  };
}

function send(res, status, body = '', headers = {}, { head = false } = {}) {
  const value = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    ...commonHeaders(),
    'content-length': value.byteLength,
    ...headers,
  });
  res.end(head ? undefined : value);
}

function sendJson(res, status, value, options) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' }, options);
}

function notFound(res, options) {
  sendJson(res, 404, { ok: false, error: 'not found' }, options);
}

function parseRequestPath(rawUrl) {
  if (typeof rawUrl !== 'string' || Buffer.byteLength(rawUrl, 'utf8') > MAX_URL_BYTES
    || !rawUrl.startsWith('/') || rawUrl.includes('//')
    || rawUrl.includes('?') || rawUrl.includes('#') || rawUrl.includes('\\')
    || /%(?:00|2f|5c)/i.test(rawUrl)) {
    throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact review path rejected.');
  }
  const trailingSlash = rawUrl.endsWith('/');
  const rawSegments = rawUrl.split('/').filter(Boolean);
  const segments = rawSegments.map((segment) => {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch {
      throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact review path encoding rejected.');
    }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/')
      || decoded.includes('\\') || decoded.includes('\0')) {
      throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact review path segment rejected.');
    }
    return decoded;
  });
  return { segments, trailingSlash };
}

function bearerToken(req) {
  const value = req.headers?.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '';
}

function cloneAndValidateEnvelope(envelope) {
  let cloned;
  try { cloned = structuredClone(envelope); } catch {
    throw artifactError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Artifact envelope is not cloneable.');
  }
  validateArtifactEnvelope(cloned);
  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
  };
  return freeze(cloned);
}

function normalizeRegistration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact session registration must be an object.');
  }
  const envelope = cloneAndValidateEnvelope(value.envelope);
  const title = value.title ?? envelope.artifacts[0]?.title ?? 'Artifact review';
  const theme = value.theme ?? 'auto';
  if (typeof title !== 'string' || title.length < 1 || title.length > TITLE_LIMIT) {
    throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, `Artifact title must be 1 through ${TITLE_LIMIT} characters.`);
  }
  if (!THEME_VALUES.has(theme)) {
    throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact shell theme must be auto, light, or dark.');
  }
  const cwd = value.cwd ?? process.cwd();
  if (typeof cwd !== 'string' || cwd.length < 1 || cwd.length > 4_096) {
    throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact session working directory is invalid.');
  }
  return { envelope, title, theme, cwd };
}

function assertReviewStateSize(ledger) {
  const bytes = Buffer.byteLength(JSON.stringify(ledger), 'utf8');
  if (bytes > ARTIFACT_REVIEW_MAX_STATE_BYTES) {
    throw artifactError(
      ARTIFACT_ERROR_CODES.REQUEST_LIMIT,
      `Artifact review state exceeds ${ARTIFACT_REVIEW_MAX_STATE_BYTES} UTF-8 bytes.`,
    );
  }
}

async function initializeSessionReview(registration, env) {
  const artifactId = registration.envelope.viewer.activeArtifactId;
  const currentReviewOf = digestArtifactEnvelope(registration.envelope);
  const destination = resolveArtifactReviewDestination({
    cwd: registration.cwd,
    env,
    artifactId,
  });
  return withArtifactReviewLock(destination.path, () => {
    let ledger = readArtifactReviewState(destination.path, { allowMissing: true })
      ?? createReviewLedger({ artifactId, currentReviewOf });
    if (ledger.artifactId !== artifactId) {
      throw artifactError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Stored review state belongs to another artifact.');
    }
    if (ledger.currentReviewOf !== currentReviewOf) {
      ledger = createReviewLedger({
        artifactId,
        currentReviewOf,
        reviews: ledger.reviews.map((entry) => ({
          review: entry.review,
          stale: entry.stale || entry.review.reviewOf !== currentReviewOf,
        })),
      });
    }
    if (registration.envelope.review) {
      ledger = mergeReviewLedger(ledger, registration.envelope.review, { stale: false });
    }
    assertReviewStateSize(ledger);
    writeArtifactReviewState(destination.path, ledger);
    return { ledger, path: destination.path };
  });
}

function queueSessionReviewWrite(session, review) {
  validateArtifactReview(review);
  if (review.reviewOf !== session.reviewState.currentReviewOf) {
    throw artifactError(
      ARTIFACT_ERROR_CODES.STALE_REVIEW,
      'Artifact review targets a different canonical artifact digest.',
      'Reload the local review before submitting feedback.',
      { localDigest: session.reviewState.currentReviewOf, reviewDigest: review.reviewOf },
    );
  }
  const commit = () => {
    return withArtifactReviewLock(session.reviewPath, () => {
      const durable = readArtifactReviewState(session.reviewPath, { allowMissing: true })
        ?? session.reviewState;
      const next = mergeReviewLedger(durable, review, { stale: false });
      assertReviewStateSize(next);
      writeArtifactReviewState(session.reviewPath, next);
      session.reviewState = next;
      return next;
    });
  };
  const operation = session.writeQueue.then(commit, commit);
  session.writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function refreshSessionReview(session) {
  await session.writeQueue;
  const durable = await withArtifactReviewLock(session.reviewPath, () => (
    readArtifactReviewState(session.reviewPath, { allowMissing: true }) ?? session.reviewState
  ));
  session.reviewState = durable;
  return durable;
}

function sessionMatches(session, capability) {
  return session && isCapabilityToken(capability, { bytes: SESSION_TOKEN_BYTES })
    && timingSafeTokenEqual(session.capability, capability);
}

function safeSessionId(value) {
  return isCapabilityToken(value, { bytes: SESSION_ID_BYTES });
}

function artifactFor(session, artifactId) {
  return session.envelope.artifacts.find(({ id }) => id === artifactId) ?? null;
}

function publicBase(session) {
  return `/r/${session.id}/${session.capability}/`;
}

function shellEnvelope(session) {
  const candidates = session.reviewState.reviews
    .filter((entry) => !entry.stale
      && entry.review.reviewOf === session.reviewState.currentReviewOf)
    .map((entry) => entry.review)
    .sort((a, b) => String(a.updatedAt ?? a.createdAt ?? '').localeCompare(
      String(b.updatedAt ?? b.createdAt ?? ''),
    ) || a.reviewId.localeCompare(b.reviewId));
  const review = candidates.at(-1);
  return {
    schemaVersion: session.envelope.schemaVersion,
    artifacts: session.envelope.artifacts,
    viewer: session.envelope.viewer,
    ...(review ? { review } : {}),
  };
}

function serverHealth(instanceId) {
  return {
    ok: true,
    kind: ARTIFACT_REVIEW_SERVER_KIND,
    version: ARTIFACT_REVIEW_SERVER_VERSION,
    pid: process.pid,
    instanceId,
  };
}

/** A loopback-only, non-enumerating server with in-memory review sessions. */
export function createArtifactReviewServer({
  controlToken = mintCapabilityToken({ bytes: CONTROL_TOKEN_BYTES }),
  instanceId = mintCapabilityToken({ bytes: SESSION_ID_BYTES }),
  env = process.env,
  onEmpty,
} = {}) {
  if (!isCapabilityToken(controlToken, { bytes: CONTROL_TOKEN_BYTES })) {
    throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_STATE, 'Artifact review control token is invalid.');
  }
  if (!isCapabilityToken(instanceId, { bytes: SESSION_ID_BYTES })) {
    throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_STATE, 'Artifact review instance id is invalid.');
  }
  const sessions = new Map();
  let port = null;
  let closePromise = null;
  let pendingRegistrations = 0;
  let activeRequests = 0;
  let draining = false;
  let emptyTimer = null;
  const stageRuntime = () => readFileSync(STAGE_RUNTIME_PATH, 'utf8');
  const idle = () => sessions.size === 0 && pendingRegistrations === 0 && activeRequests === 0;
  const scheduleEmpty = () => {
    if (emptyTimer || draining || typeof onEmpty !== 'function') return;
    emptyTimer = setTimeout(async () => {
      emptyTimer = null;
      if (idle() && !draining) {
        try { await onEmpty(); } catch {
          // The next session start revalidates state and recovers stale ownership.
        }
      }
    }, 25);
    emptyTimer.unref?.();
  };

  const server = createServer(async (req, res) => {
    activeRequests += 1;
    let requestFinished = false;
    const finishRequest = () => {
      if (requestFinished) return;
      requestFinished = true;
      activeRequests = Math.max(0, activeRequests - 1);
      if (idle()) scheduleEmpty();
    };
    res.once('finish', finishRequest);
    res.once('close', finishRequest);
    const head = req.method === 'HEAD';
    try {
      if (port === null) throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_STATE, 'Artifact server is not ready.');
      const { segments, trailingSlash } = parseRequestPath(req.url);
      const internal = segments[0] === 'internal';
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      assertLoopbackRequest(req, { port, mutating, internal });

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
        sendJson(res, 200, serverHealth(instanceId), { head });
        return;
      }

      if (internal) {
        if (!timingSafeTokenEqual(bearerToken(req), controlToken)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return;
        }
        if (req.method === 'POST' && segments.join('/') === 'internal/v1/sessions') {
          if (draining) {
            throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_STATE, 'Artifact review server is restarting.');
          }
          if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
            throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact registration requires application/json.');
          }
          pendingRegistrations += 1;
          try {
            let body;
            try {
              body = await readRequestBody(req, { maxBytes: ARTIFACT_REVIEW_MAX_CONTROL_BYTES, encoding: 'utf8' });
            } catch (error) {
              if (error?.code === 'E_REQUEST_BODY_LIMIT') {
                throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_LIMIT, error.message);
              }
              throw error;
            }
            const registration = normalizeRegistration(JSON.parse(body || '{}'));
            if (draining) {
              throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_STATE, 'Artifact review server is restarting.');
            }
            const id = mintCapabilityToken({ bytes: SESSION_ID_BYTES });
            const reviewState = await initializeSessionReview(registration, env);
            const session = {
              ...registration,
              id,
              capability: mintCapabilityToken({ bytes: SESSION_TOKEN_BYTES }),
              bridgeNonce: createArtifactBridgeNonce(),
              createdAt: new Date().toISOString(),
              reviewState: reviewState.ledger,
              reviewPath: reviewState.path,
              writeQueue: Promise.resolve(),
            };
            sessions.set(id, session);
            sendJson(res, 201, {
              ok: true,
              sessionId: id,
              capability: session.capability,
              path: publicBase(session),
            });
          } finally {
            pendingRegistrations -= 1;
          }
          return;
        }
        if (req.method === 'DELETE' && segments.length === 4
          && segments[0] === 'internal' && segments[1] === 'v1'
          && segments[2] === 'sessions' && safeSessionId(segments[3])) {
          const target = sessions.get(segments[3]);
          if (target) await target.writeQueue;
          const removed = sessions.delete(segments[3]);
          const remaining = sessions.size;
          sendJson(res, removed ? 200 : 404, removed
            ? { ok: true, remaining }
            : { ok: false, error: 'not found' });
          return;
        }
        if (req.method === 'GET' && segments.length === 5
          && segments[0] === 'internal' && segments[1] === 'v1'
          && segments[2] === 'sessions' && safeSessionId(segments[3])
          && segments[4] === 'review') {
          const target = sessions.get(segments[3]);
          if (!target) {
            notFound(res, { head });
            return;
          }
          await refreshSessionReview(target);
          sendJson(res, 200, {
            ok: true,
            reviewState: target.reviewState,
            effectiveDecision: effectiveReviewDecision(target.reviewState),
          }, { head });
          return;
        }
        if (req.method === 'GET' && segments.length === 6
          && segments[0] === 'internal' && segments[1] === 'v1'
          && segments[2] === 'sessions' && safeSessionId(segments[3])
          && segments[4] === 'export' && ['json', 'markdown'].includes(segments[5])) {
          const target = sessions.get(segments[3]);
          if (!target) {
            notFound(res, { head });
            return;
          }
          await refreshSessionReview(target);
          const format = segments[5];
          send(res, 200, exportArtifactReview(target.reviewState, { format }), {
            'content-type': format === 'json'
              ? 'application/json; charset=utf-8'
              : 'text/markdown; charset=utf-8',
          }, { head });
          return;
        }
        notFound(res, { head });
        return;
      }

      if (segments.length < 3 || segments[0] !== 'r' || !safeSessionId(segments[1])) {
        notFound(res, { head });
        return;
      }
      const session = sessions.get(segments[1]);
      if (!sessionMatches(session, segments[2])) {
        notFound(res, { head });
        return;
      }
      const base = publicBase(session);
      const parentOrigin = `http://${LOOPBACK_HOST}:${port}`;

      if (segments.length === 5 && segments[3] === 'api' && segments[4] === 'review') {
        if (['GET', 'HEAD'].includes(req.method)) {
          await refreshSessionReview(session);
          sendJson(res, 200, {
            ok: true,
            reviewState: session.reviewState,
            effectiveDecision: effectiveReviewDecision(session.reviewState),
          }, { head });
          return;
        }
        if (req.method === 'PUT') {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
            throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_INVALID, 'Artifact review persistence requires application/json.');
          }
          let body;
          try {
            body = await readRequestBody(req, {
              maxBytes: ARTIFACT_REVIEW_MAX_STATE_BYTES,
              encoding: 'utf8',
            });
          } catch (error) {
            if (error?.code === 'E_REQUEST_BODY_LIMIT') {
              throw artifactError(ARTIFACT_ERROR_CODES.REQUEST_LIMIT, error.message);
            }
            throw error;
          }
          const value = JSON.parse(body || '{}');
          const review = value?.review ?? value;
          const reviewState = await queueSessionReviewWrite(session, review);
          sendJson(res, 200, {
            ok: true,
            reviewId: review.reviewId,
            effectiveDecision: effectiveReviewDecision(reviewState),
          });
          return;
        }
        notFound(res, { head });
        return;
      }

      if (segments.length === 6 && segments[3] === 'api' && segments[4] === 'export'
        && ['json', 'markdown'].includes(segments[5]) && ['GET', 'HEAD'].includes(req.method)) {
        await refreshSessionReview(session);
        const format = segments[5];
        send(res, 200, exportArtifactReview(session.reviewState, { format }), {
          'content-type': format === 'json'
            ? 'application/json; charset=utf-8'
            : 'text/markdown; charset=utf-8',
        }, { head });
        return;
      }

      if (!['GET', 'HEAD'].includes(req.method)) {
        notFound(res, { head });
        return;
      }

      if (segments.length === 3) {
        if (!trailingSlash) {
          send(res, 308, '', { location: base }, { head });
          return;
        }
        await refreshSessionReview(session);
        const envelope = shellEnvelope(session);
        const document = renderArtifactShellDocument({
          envelope,
          viewer: session.envelope.viewer,
          shell: {
            title: session.title,
            theme: session.theme,
            privacy: 'local',
            status: 'ready',
          },
        }, { stageRuntimeUrl: `${base}runtime.js` });
        send(res, 200, document, {
          ...parentHeaders(),
          'content-type': 'text/html; charset=utf-8',
        }, { head });
        return;
      }

      if (segments.length === 4 && segments[3] === 'runtime.js') {
        const runtime = renderArtifactParentRuntime({
          artifactBaseUrl: `${base}artifacts/`,
          stageRuntimeUrl: `${base}stage.js`,
          nonce: session.bridgeNonce,
        });
        send(res, 200, runtime, {
          ...parentHeaders(),
          'content-type': 'text/javascript; charset=utf-8',
          'x-frame-options': 'DENY',
        }, { head });
        return;
      }
      if (segments.length === 4 && segments[3] === 'stage.js') {
        send(res, 200, stageRuntime(), {
          ...parentHeaders(),
          'content-type': 'text/javascript; charset=utf-8',
          'x-frame-options': 'DENY',
        }, { head });
        return;
      }
      if (segments.length === 5 && segments[3] === 'artifacts') {
        const artifact = artifactFor(session, segments[4]);
        if (!artifact) {
          notFound(res, { head });
          return;
        }
        const destination = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase();
        if (destination && destination !== 'empty') {
          notFound(res, { head });
          return;
        }
        const prepared = prepareArtifactDocument({
          html: artifact.html,
          artifactId: artifact.id,
          nonce: session.bridgeNonce,
          parentOrigin,
        });
        send(res, 200, prepared.html, {
          'content-security-policy': `${prepared.csp}; sandbox allow-scripts; frame-ancestors 'none'`,
          'content-disposition': 'attachment; filename="openplanr-artifact.html"',
          'content-type': 'application/octet-stream',
          'cross-origin-resource-policy': 'same-origin',
          'permissions-policy': PERMISSIONS_POLICY,
          'x-frame-options': 'DENY',
        }, { head });
        return;
      }
      notFound(res, { head });
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = statusForError(error);
      const value = error instanceof PipelineError
        ? error.toJSON()
        : { ok: false, error: status === 500 ? 'internal error' : error.message };
      sendJson(res, status, value, { head });
    }
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 2_000;

  return Object.freeze({
    server,
    controlToken,
    instanceId,
    sessionCount: () => sessions.size,
    isIdle: idle,
    accepting: () => !draining && !closePromise,
    beginCloseIfIdle() {
      if (draining || closePromise || !idle()) return false;
      draining = true;
      if (emptyTimer) clearTimeout(emptyTimer);
      emptyTimer = null;
      return true;
    },
    get port() { return port; },
    async listen(requestedPort = 0) {
      if (port !== null) return port;
      port = await listenLoopback(server, requestedPort);
      return port;
    },
    async close() {
      if (closePromise) return closePromise;
      draining = true;
      if (emptyTimer) clearTimeout(emptyTimer);
      emptyTimer = null;
      closePromise = (async () => {
        sessions.clear();
        await closeHttpServer(server);
      })();
      return closePromise;
    },
  });
}

function validState(value, requestedPort) {
  return value?.schemaVersion === '1.0.0'
    && value.kind === ARTIFACT_REVIEW_SERVER_KIND
    && value.serverVersion === ARTIFACT_REVIEW_SERVER_VERSION
    && Number.isInteger(value.pid) && value.pid > 0
    && Number.isInteger(value.port) && value.port > 0 && value.port <= 65_535
    && (requestedPort === 0 || value.port === requestedPort)
    && isCapabilityToken(value.instanceId, { bytes: SESSION_ID_BYTES })
    && isCapabilityToken(value.controlToken, { bytes: CONTROL_TOKEN_BYTES });
}

async function stateIsHealthy(state, fetchImpl) {
  if (!validState(state, 0)) return false;
  const health = await probeLoopbackJson(state.port, '/health', { fetchImpl });
  return health?.ok === true
    && health.kind === ARTIFACT_REVIEW_SERVER_KIND
    && health.version === ARTIFACT_REVIEW_SERVER_VERSION
    && health.pid === state.pid
    && health.instanceId === state.instanceId;
}

async function cleanupOwnedDescriptor(descriptor, { force = false } = {}) {
  if (!descriptor?.local) return;
  if (!force && !descriptor.reviewServer.beginCloseIfIdle()) return false;
  try { await descriptor.reviewServer.close(); } finally {
    const current = readJsonState(descriptor.statePath);
    if (current?.pid === process.pid
      && timingSafeTokenEqual(current.controlToken, descriptor.state.controlToken)
      && current.instanceId === descriptor.state.instanceId) {
      rmSync(descriptor.statePath, { force: true });
    }
    if (localServers.get(descriptor.statePath) === descriptor) {
      localServers.delete(descriptor.statePath);
    }
    descriptor.resolveClosed?.();
  }
  return true;
}

async function ensureArtifactReviewServer({ port = 0, env = process.env, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_BIND, 'Artifact review port must be 0 through 65535.');
  }
  const statePath = artifactReviewStatePath(port, env);
  const cached = localServers.get(statePath);
  if (cached?.reviewServer.accepting()) return cached;
  if (cached) await cached.closed;

  const release = await acquireStartLock(stateLockPath(port, env));
  try {
    const existing = readJsonState(statePath);
    if (validState(existing, port) && await stateIsHealthy(existing, fetchImpl)) {
      return Object.freeze({ statePath, state: existing, local: false });
    }
    rmSync(statePath, { force: true });
    const controlToken = mintCapabilityToken({ bytes: CONTROL_TOKEN_BYTES });
    const instanceId = mintCapabilityToken({ bytes: SESSION_ID_BYTES });
    let descriptor;
    let resolveClosed;
    const closed = new Promise((resolveClose) => { resolveClosed = resolveClose; });
    const reviewServer = createArtifactReviewServer({
      controlToken,
      instanceId,
      env,
      onEmpty: async () => {
        await cleanupOwnedDescriptor(descriptor);
      },
    });
    let actualPort;
    try {
      actualPort = await reviewServer.listen(port);
    } catch (error) {
      const code = error?.code === 'EADDRINUSE'
        ? ARTIFACT_ERROR_CODES.PORT_IN_USE
        : ARTIFACT_ERROR_CODES.LOOPBACK_BIND;
      throw artifactError(code, error?.code === 'EADDRINUSE'
        ? `Artifact review port ${port} is already in use.`
        : `Unable to bind artifact review server: ${error.message}`);
    }
    const state = Object.freeze({
      schemaVersion: '1.0.0',
      kind: ARTIFACT_REVIEW_SERVER_KIND,
      serverVersion: ARTIFACT_REVIEW_SERVER_VERSION,
      pid: process.pid,
      port: actualPort,
      controlToken,
      instanceId,
      startedAt: new Date().toISOString(),
    });
    writePrivateJsonState(statePath, state);
    descriptor = Object.freeze({
      statePath, state, local: true, reviewServer, closed, resolveClosed,
    });
    localServers.set(statePath, descriptor);
    reviewServer.server.once('close', () => resolveClosed());
    return descriptor;
  } finally {
    release();
  }
}

async function controlRequest(descriptor, path, {
  method,
  body,
  fetchImpl,
} = {}) {
  const response = await fetchImpl(`http://${LOOPBACK_HOST}:${descriptor.state.port}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${descriptor.state.controlToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw artifactError(
      value.code ?? ARTIFACT_ERROR_CODES.LOOPBACK_STATE,
      value.problem ?? value.error ?? `Artifact review control request failed with HTTP ${response.status}.`,
    );
  }
  return value;
}

async function controlTextRequest(descriptor, path, { fetchImpl } = {}) {
  const response = await fetchImpl(`http://${LOOPBACK_HOST}:${descriptor.state.port}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${descriptor.state.controlToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.text();
  if (!response.ok) {
    throw artifactError(
      ARTIFACT_ERROR_CODES.REVIEW_EXPORT,
      `Artifact review export failed with HTTP ${response.status}.`,
    );
  }
  return value;
}

/**
 * Start or reuse a secure loopback server, register an in-memory review, and
 * return a serializable controller. Platform browser launching remains an
 * injected CLI concern; `--no-open` is represented without hidden side effects.
 */
export async function startArtifactReview({
  envelope,
  title,
  theme = 'auto',
  port = 0,
  noOpen = false,
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = fetch,
  openUrl,
} = {}) {
  const normalized = normalizeRegistration({ envelope, title, theme, cwd });
  let descriptor;
  let registration;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    descriptor = await ensureArtifactReviewServer({ port, env, fetchImpl });
    try {
      registration = await controlRequest(descriptor, '/internal/v1/sessions', {
        method: 'POST',
        body: normalized,
        fetchImpl,
      });
      break;
    } catch (error) {
      const restarting = error?.code === ARTIFACT_ERROR_CODES.LOOPBACK_STATE
        || (descriptor.local && !descriptor.reviewServer.accepting());
      if (restarting && attempt === 0) {
        if (descriptor.local) {
          await Promise.race([
            descriptor.closed,
            new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
          ]);
        } else {
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        continue;
      }
      if (descriptor.local && descriptor.reviewServer.isIdle()) {
        await cleanupOwnedDescriptor(descriptor);
      }
      throw error;
    }
  }
  if (!registration) throw artifactError(ARTIFACT_ERROR_CODES.LOOPBACK_STATE, 'Artifact review session could not start.');
  const url = `http://${LOOPBACK_HOST}:${descriptor.state.port}${registration.path}`;
  const sshDetected = Boolean(env.SSH_CONNECTION || env.SSH_TTY);
  const forwardingCommand = `ssh -N -L ${descriptor.state.port}:${LOOPBACK_HOST}:${descriptor.state.port} <ssh-host>`;
  let opened = false;
  let launchError = null;
  const shouldOpen = !noOpen && !sshDetected;
  if (shouldOpen && typeof openUrl === 'function') {
    try {
      await openUrl(url);
      opened = true;
    } catch (error) {
      launchError = Object.freeze({
        code: 'E_ARTIFACT_BROWSER_OPEN_FAILED',
        message: 'The browser could not be opened automatically. Open the returned loopback URL manually.',
      });
    }
  }
  let closed = false;
  let sessionClosePromise = null;
  const result = {
    ok: true,
    action: 'artifact_review_started',
    executionMode: 'loopback',
    sessionId: registration.sessionId,
    host: LOOPBACK_HOST,
    port: descriptor.state.port,
    url,
    noOpen: Boolean(noOpen),
    shouldOpen,
    opened,
    launch: Object.freeze({
      attempted: shouldOpen && typeof openUrl === 'function',
      ok: opened || !shouldOpen || typeof openUrl !== 'function',
      ...(launchError === null ? {} : { error: launchError }),
    }),
    remote: Object.freeze({
      detected: sshDetected,
      browserUrl: url,
      forwardingCommand,
      instruction: sshDetected
        ? `Forward the port, then open ${url} in your local browser.`
        : `Open ${url} in a browser on this machine.`,
    }),
    getReview() {
      return controlRequest(
        descriptor,
        `/internal/v1/sessions/${encodeURIComponent(registration.sessionId)}/review`,
        { method: 'GET', fetchImpl },
      );
    },
    exportReview(format = 'json') {
      if (!['json', 'markdown'].includes(format)) {
        return Promise.reject(artifactError(
          ARTIFACT_ERROR_CODES.REVIEW_EXPORT,
          'Artifact review export format must be json or markdown.',
        ));
      }
      return controlTextRequest(
        descriptor,
        `/internal/v1/sessions/${encodeURIComponent(registration.sessionId)}/export/${format}`,
        { fetchImpl },
      );
    },
    close() {
      if (sessionClosePromise) return sessionClosePromise;
      if (closed) return Promise.resolve({ ok: true, alreadyClosed: true });
      sessionClosePromise = (async () => {
        try {
          const value = await controlRequest(
            descriptor,
            `/internal/v1/sessions/${encodeURIComponent(registration.sessionId)}`,
            { method: 'DELETE', fetchImpl },
          );
          closed = true;
          if (descriptor.local && value.remaining === 0) {
            await Promise.race([
              descriptor.closed,
              new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
            ]);
          }
          return value;
        } catch (error) {
          sessionClosePromise = null;
          throw error;
        } finally {
          if (closed) {
            queueMicrotask(() => {
              sessionClosePromise = null;
            });
          }
        }
      })();
      return sessionClosePromise;
    },
    toJSON() {
      const { close, getReview, exportReview, toJSON, ...serializable } = this;
      return serializable;
    },
  };
  return Object.freeze(result);
}

/** Test/support hook: close every server owned by this process. */
export async function closeArtifactReviewServers() {
  const descriptors = [...localServers.values()];
  for (const descriptor of descriptors) {
    await cleanupOwnedDescriptor(descriptor, { force: true });
  }
}

export function artifactReviewServerStateExists(port = 0, env = process.env) {
  return existsSync(artifactReviewStatePath(port, env));
}
