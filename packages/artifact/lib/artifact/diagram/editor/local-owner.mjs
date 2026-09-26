// @ts-check
import { readFileSync } from 'node:fs';
import { embedJson, escapeHtml } from '../../internal/escape.mjs';
import { readRequestBody } from '../../internal/server-util.mjs';
import { createArtifactReviewServer } from '../../review-server.mjs';
import { createDiagramAuthoringStore } from '../authoring/store.mjs';
import { createDiagramEditorDraft } from './draft.mjs';

/**
 * A store result as the API reports it; only unknown outcomes carry path, reason and code.
 * @typedef {(
 *   | import('../authoring/store.d.mts').DiagramStoreReadResult
 *   | import('../authoring/store.d.mts').DiagramStoreSaveResult
 *   | { ok: true; status: 'not-found'; transactionId: string }
 * ) & Partial<Pick<import('../authoring/store.d.mts').DiagramStoreUnknown, 'path' | 'reason' | 'code'>>} StoreOutcome
 */

/** @type {typeof import('./local-owner.d.mts').DIAGRAM_OWNER_HEADER} */
export const DIAGRAM_OWNER_HEADER = 'x-openplanr-owner';
/** @type {typeof import('./local-owner.d.mts').DIAGRAM_OWNER_MAX_REQUEST_BYTES} */
export const DIAGRAM_OWNER_MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const CAPABILITIES = Object.freeze({ read: true, write: true });
const METHODS = Object.freeze({
  read: ['GET', 'HEAD'],
  initialize: ['POST'],
  commit: ['POST'],
  recover: ['POST'],
});

function response(status, body) {
  return { status, body };
}
function rejected(status, code, message, state = 'invalid') {
  return response(status, { ok: false, status: state, code, message });
}
function closedBody(value, allowed, required) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}
function storeFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'E_REQUEST_BODY_LIMIT')
    return rejected(413, code, 'The owner request exceeds its byte limit.');
  if (code === 'E_DIAGRAM_STORE_CAPACITY')
    return rejected(413, code, 'The document exceeds its local storage quota.');
  if (code === 'E_DIAGRAM_STORE_LOCKED')
    return rejected(
      503,
      code,
      'Another local operation owns this diagram. Retry or inspect its recovery state.',
      'unavailable',
    );
  if (
    [
      'E_DIAGRAM_STORE_ID_REUSE',
      'E_DIAGRAM_STORE_CHANGED',
      'E_DIAGRAM_STORE_COLLISION',
      'E_DIAGRAM_STORE_CORRUPT',
    ].includes(code)
  ) {
    return rejected(
      409,
      code,
      'The local source or transaction identity conflicts with this request. No unknown content was overwritten.',
      'conflict',
    );
  }
  if (code === 'E_DIAGRAM_STORE_INVALID_TRANSACTION') {
    const stale = error.details?.diagnostics?.some(
      (item) => item.rule === 'stale-base' || item.rule === 'before-value',
    );
    return rejected(
      stale ? 409 : 422,
      code,
      stale
        ? 'The edit requires a different current diagram revision.'
        : 'The edit is not valid for this diagram.',
      stale ? 'conflict' : 'invalid',
    );
  }
  if (code === 'E_DIAGRAM_STORE_PATH')
    return rejected(
      409,
      code,
      'The configured local document scope failed its path custody checks.',
      'conflict',
    );
  if (code.startsWith('E_DIAGRAM_STORE_'))
    return rejected(422, code, 'The local diagram request is invalid.');
  return rejected(
    503,
    'E_DIAGRAM_OWNER_STORAGE',
    'The local operation could not be confirmed. Read or recover its exact transaction before retrying.',
    'unavailable',
  );
}

/** The owner shell carries preferences, never document content or source paths. */
function ownerPage({ slug, title, grammar }) {
  const config = embedJson({ diagramId: slug, title, grammar });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} · OpenPlanr Diagram Editor</title><link rel="stylesheet" href="editor.css"></head><body class="planr-diagram-owner-page"><main id="diagram-owner-editor" aria-label="Diagram editor"><p role="status">Opening local diagram…</p></main><script type="application/json" id="diagram-owner-data">${config}</script><script src="runtime.js" defer></script></body></html>`;
}

/**
 * Bind one local document before exposing any HTTP capability. HTTP bodies may
 * provide content and operation identity only, never roots, slugs or filenames.
 * Register this adapter with createArtifactReviewServer.registerOwnerSession().
 * @type {typeof import('./local-owner.d.mts').createDiagramLocalOwnerAdapter}
 */
export function createDiagramLocalOwnerAdapter({
  root,
  slug,
  title = 'Untitled diagram',
  grammar = 'process',
  maxRequestBytes = DIAGRAM_OWNER_MAX_REQUEST_BYTES,
  storeOptions = {},
}) {
  if (
    !Number.isSafeInteger(maxRequestBytes) ||
    maxRequestBytes < 1 ||
    maxRequestBytes > DIAGRAM_OWNER_MAX_REQUEST_BYTES
  )
    throw new TypeError('Invalid diagram owner request limit.');
  if (
    !storeOptions ||
    typeof storeOptions !== 'object' ||
    Array.isArray(storeOptions) ||
    Object.keys(storeOptions).some((key) => !['maxBundleBytes', 'faultInjector'].includes(key))
  )
    throw new TypeError('Unsupported diagram owner store options.');
  const draft = createDiagramEditorDraft({ diagramId: slug, title, grammar });
  if (!draft.ok)
    throw new TypeError('The initial diagram title or authoring grammar is not supported.');
  const store = createDiagramAuthoringStore({ ...storeOptions, root, slug });
  return Object.freeze({
    capabilities: CAPABILITIES,
    async handleRequest({ req, segments, origin, recoveryScope }) {
      if (
        ['GET', 'HEAD'].includes(req.method) &&
        (segments.length === 0 ||
          (segments.length === 1 && ['runtime.js', 'editor.css'].includes(segments[0])))
      ) {
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0)
          return rejected(
            400,
            'E_DIAGRAM_OWNER_BODY',
            'Page and asset requests cannot carry a body.',
          );
        if (segments.length === 0)
          return {
            status: 200,
            kind: 'asset',
            asset: 'document',
            body: ownerPage({ slug, title, grammar }),
          };
        if (segments[0] === 'runtime.js')
          return {
            status: 200,
            kind: 'asset',
            asset: 'runtime',
            body: readFileSync(
              new URL('../../../../templates/diagram-owner.js', import.meta.url),
              'utf8',
            ),
          };
        return {
          status: 200,
          kind: 'asset',
          asset: 'stylesheet',
          body: readFileSync(new URL('../../ui/diagram-editor.css', import.meta.url), 'utf8'),
        };
      }
      const action = segments.length === 2 && segments[0] === 'api' ? segments[1] : '';
      if (!Object.hasOwn(METHODS, action) || !METHODS[action].includes(req.method)) return false;
      const headerValues = req.headersDistinct?.[DIAGRAM_OWNER_HEADER];
      if (
        req.headers[DIAGRAM_OWNER_HEADER] !== '1' ||
        (headerValues && headerValues.length !== 1)
      ) {
        return rejected(
          403,
          'E_DIAGRAM_OWNER_HEADER',
          'An explicit local owner request is required.',
          'forbidden',
        );
      }
      const destination = req.headers['sec-fetch-dest'];
      if (destination && destination !== 'empty')
        return rejected(
          403,
          'E_DIAGRAM_OWNER_DESTINATION',
          'Owner data is available only to a scoped API request.',
          'forbidden',
        );
      if (req.method === 'POST' && req.headers.origin !== origin)
        return rejected(
          403,
          'E_DIAGRAM_OWNER_ORIGIN',
          'An exact local owner origin is required.',
          'forbidden',
        );
      const extra = { diagramId: slug, recoveryScope, capabilities: CAPABILITIES };
      try {
        /** @type {StoreOutcome} */
        let result;
        if (action === 'read') {
          if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0)
            return rejected(400, 'E_DIAGRAM_OWNER_BODY', 'Read requests cannot carry a body.');
          result = await store.read();
        } else {
          const mediaType = req.headers['content-type'];
          if (
            typeof mediaType !== 'string' ||
            !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(mediaType)
          )
            return rejected(
              415,
              'E_DIAGRAM_OWNER_MEDIA_TYPE',
              'Owner operations require application/json encoded as UTF-8.',
            );
          if (
            req.headers['content-encoding'] !== undefined &&
            req.headers['content-encoding'] !== 'identity'
          )
            return rejected(
              415,
              'E_DIAGRAM_OWNER_ENCODING',
              'Encoded request bodies are not accepted.',
            );
          let value;
          try {
            const bytes = await readRequestBody(req, { maxBytes: maxRequestBytes });
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'E_REQUEST_BODY_LIMIT')
              throw error;
            return rejected(
              400,
              'E_DIAGRAM_OWNER_JSON',
              'The request body must be one valid UTF-8 JSON object.',
            );
          }
          if (action === 'initialize') {
            if (!closedBody(value, ['bundle', 'transactionId'], ['bundle', 'transactionId']))
              return rejected(
                400,
                'E_DIAGRAM_OWNER_BODY',
                'Initialization requires only a bundle and transactionId.',
              );
            result = await store.initialize(value.bundle, { transactionId: value.transactionId });
          } else if (action === 'commit') {
            if (!closedBody(value, ['transaction'], ['transaction']))
              return rejected(400, 'E_DIAGRAM_OWNER_BODY', 'A commit requires only a transaction.');
            result = await store.commit(value.transaction);
          } else {
            if (!closedBody(value, ['transactionId', 'fingerprint'], []))
              return rejected(
                400,
                'E_DIAGRAM_OWNER_BODY',
                'Recovery accepts only transaction identity.',
              );
            result = await store.recover(value);
          }
        }
        // Source paths and filesystem failure messages are never browser data.
        const { path: _path, reason: _reason, code: _code, ...body } = result;
        if (result.status === 'unknown')
          return response(202, {
            ...body,
            ...extra,
            reason: 'This save is not confirmed. Recover using its exact transaction identity.',
          });
        return response(200, { ...body, ...extra });
      } catch (error) {
        return storeFailure(error);
      }
    },
  });
}

/**
 * Start the local editor and scoped API; review never grants owner authority.
 * @type {typeof import('./local-owner.d.mts').startDiagramOwner}
 */
export async function startDiagramOwner({
  root,
  slug,
  title,
  grammar,
  port = 0,
  noOpen = false,
  openUrl,
  maxRequestBytes,
  storeOptions,
  env = process.env,
}) {
  const adapter = createDiagramLocalOwnerAdapter({
    root,
    slug,
    title,
    grammar,
    maxRequestBytes,
    storeOptions,
  });
  const server = createArtifactReviewServer({ env });
  const registration = server.registerOwnerSession(adapter);
  try {
    await server.listen(port);
    const baseUrl = `http://127.0.0.1:${server.port}${registration.path}`;
    let launchError;
    if (!noOpen && openUrl) {
      try {
        await openUrl(baseUrl);
      } catch {
        launchError = 'Open the returned editor URL manually.';
      }
    }
    return Object.freeze({
      ok: true,
      kind: 'diagram-owner',
      status: 'ready',
      sessionId: registration.sessionId,
      recoveryScope: registration.recoveryScope,
      baseUrl,
      url: baseUrl,
      apiBase: `${baseUrl}api/`,
      capabilities: CAPABILITIES,
      ...(launchError ? { launchError } : {}),
      headers: Object.freeze({ [DIAGRAM_OWNER_HEADER]: '1' }),
      close: () => server.close(),
    });
  } catch (error) {
    await server.close();
    throw error;
  }
}
