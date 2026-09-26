const PRIVATE_PATH =
  /(?:\bfile:\/\/|(?:^|[\s"'(=])\/(?:Users|home|private|tmp|var|Volumes|etc|opt|root|srv)\/|\b[A-Za-z]:\\(?:Users|Documents and Settings|Windows|ProgramData)\\)/u;
const SECRET_BODY =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|authorization|client[_-]?secret)\s*[:=]\s*[^\s,;]+|\bBearer\s+[A-Za-z0-9._~+\/-]{12,})/iu;

function unsafeReviewWorkspaceError(path, reason) {
  const error = new Error('Review workspace contains unsafe display text.');
  error.name = 'PipelineError';
  error.code = 'E_OPERATE_REVIEW_WORKSPACE_UNSAFE';
  error.fix = '';
  error.details = { retryable: false, context: { path, reason } };
  error.toJSON = () => ({
    ok: false,
    code: error.code,
    problem: error.message,
    details: error.details,
  });
  return error;
}

export function classifyOperateReviewUnsafeTextV1(value) {
  if (PRIVATE_PATH.test(value)) return 'private-path';
  if (SECRET_BODY.test(value)) return 'secret';
  return null;
}

export function assertOperateReviewWorkspacePayloadSafeV1(payload) {
  const walk = (value, path = '$') => {
    if (typeof value === 'string') {
      const reason = classifyOperateReviewUnsafeTextV1(value);
      if (reason !== null) throw unsafeReviewWorkspaceError(path, reason);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([field, nested]) => walk(nested, `${path}.${field}`));
    }
  };
  walk(payload);
  return payload;
}
