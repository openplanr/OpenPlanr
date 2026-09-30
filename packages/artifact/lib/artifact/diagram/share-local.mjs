import { readRequestBody } from '../internal/server-util.mjs';
import {
  getDiagramShareStatus,
  manageDiagramShare,
  publishDiagramShare,
  shareDiagram,
  syncDiagramShare,
} from './share.mjs';

const actions = new Set([
  'create',
  'publish',
  'sync',
  'access',
  'rotate',
  'pause',
  'resume',
  'revoke',
  'delete',
]);
const safeResult = ({ reviewPath: _path, ownerFile: _owner, ...safe }) => safe;
const response = (status, body) => ({ status, body });
const uncertainCodes = new Set(['E_WORKSPACE_NETWORK', 'E_WORKSPACE_RESPONSE_INVALID']);
const localStatuses = {
  E_REQUEST_BODY_LIMIT: 413,
  E_DIAGRAM_SHARE_PREVIEW_CHANGED: 409,
  E_DIAGRAM_SHARE_PENDING: 409,
  E_OWNER_CUSTODY_LOCATION: 400,
  E_OWNER_CUSTODY_INVALID: 400,
  E_DIAGRAM_REVIEW_BUNDLE: 422,
  E_DIAGRAM_REVIEW_TOO_LARGE: 413,
  E_WORKSPACE_PAYLOAD_TOO_LARGE: 413,
  EACCES: 403,
  EPERM: 403,
  ENOENT: 404,
};
/** The caller supplies one verified local file; browsers cannot change its scope or destination. */
export function createDiagramShareLocalHandler(file, { env = process.env, ...options } = {}) {
  return async ({ req, segments, origin }) => {
    if (
      segments.length !== 2 ||
      segments[0] !== 'api' ||
      segments[1] !== 'share' ||
      !['GET', 'POST'].includes(req.method)
    )
      return false;
    const reject = (status, message, code) =>
      response(status, { ok: false, ...(code ? { code } : {}), message });
    const headerValues = req.headersDistinct?.['x-openplanr-owner'];
    if (req.headers['x-openplanr-owner'] !== '1' || (headerValues && headerValues.length !== 1))
      return reject(403, 'An explicit local owner request is required.');
    if (req.headers['sec-fetch-dest'] && req.headers['sec-fetch-dest'] !== 'empty')
      return reject(403, 'Share data is only available to a scoped API request.');
    if (req.method === 'POST' && req.headers.origin !== origin)
      return reject(403, 'An exact local owner origin is required.');
    try {
      if (req.method === 'GET') {
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0)
          return reject(400, 'Status requests cannot carry a body.');
        return response(200, safeResult(await getDiagramShareStatus(file, { ...options, env })));
      }
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] ?? '') ||
        (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
      )
        return reject(415, 'Use an unencoded UTF-8 JSON owner request.');
      const bytes = await readRequestBody(req, { maxBytes: 4096 });
      let value;
      try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        return reject(400, 'The share request must be valid UTF-8 JSON.');
      }
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !['action', 'expectedRevision'].includes(key)) ||
        !actions.has(value.action) ||
        !/^[a-f0-9]{64}$/u.test(value.expectedRevision ?? '')
      )
        return reject(400, 'Only the displayed share action and revision are accepted.');
      const current = await getDiagramShareStatus(file, { ...options, env });
      if (current.localRevision !== value.expectedRevision)
        return reject(
          409,
          'The local diagram changed. Reopen Share and review its new revision before publishing.',
          'E_DIAGRAM_SHARE_PREVIEW_CHANGED',
        );
      const result =
        value.action === 'create'
          ? await shareDiagram(file, { ...options, env, expectedRevision: value.expectedRevision })
          : value.action === 'publish'
            ? await publishDiagramShare(file, {
                ...options,
                env,
                expectedRevision: value.expectedRevision,
              })
            : value.action === 'sync'
              ? await syncDiagramShare(file, { ...options, env })
              : await manageDiagramShare(file, value.action, { ...options, env });
      // Private custody and paths never become browser data. Access is the only action
      // that deliberately returns the reviewer token to this authenticated owner.
      return response(200, safeResult(result));
    } catch (error) {
      if (error?.code === 'E_DIAGRAM_SHARE_UNSUPPORTED')
        return response(409, {
          ok: false,
          code: 'E_DIAGRAM_SHARE_UNSUPPORTED',
          message:
            'The selected hosted service does not support permanent diagram reviews. Upgrade the hosted viewer and runtime before sharing this diagram.',
        });
      const knownStatus =
        localStatuses[error?.code] ??
        (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
          ? error.status
          : undefined);
      if (knownStatus && !uncertainCodes.has(error?.code))
        return response(knownStatus, {
          ok: false,
          ...(error.code ? { code: error.code } : {}),
          message: error.message,
          ...(Number.isFinite(error.retryAfterSeconds)
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        });
      return response(503, {
        ok: false,
        ...(error?.code ? { code: error.code } : {}),
        message:
          'This sharing operation could not be confirmed. Existing work and private custody are preserved; retry the same action.',
      });
    }
  };
}
