/** Same-origin loopback adapter. A URL is a capability: never persist it in recovery. */
export function createDiagramLocalOwnerTransport({
  apiBase,
  fetch: request = globalThis.fetch,
  origin = globalThis.location?.origin,
  maxResponseBytes = 64 * 1024 * 1024,
}) {
  const base = new URL(apiBase);
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !/^\/o\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/api\/$/u.test(base.pathname) ||
    (origin && origin !== base.origin)
  )
    throw new TypeError(
      'Owner transport requires this page’s exact loopback owner capability URL.',
    );
  if (typeof request !== 'function') throw new TypeError('Owner transport requires fetch.');
  if (
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 64 * 1024 * 1024
  )
    throw new TypeError('Invalid owner response byte limit.');
  async function call(action, body) {
    const response = await request(new URL(action, base).href, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        'X-OpenPlanr-Owner': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      throw new Error('Owner returned an unexpected response type.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Owner returned no response body.');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > maxResponseBytes) throw new Error('Owner response exceeds the byte limit.');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('Owner returned an invalid response.');
    return { ...result, ...(!response.ok ? { ok: false, httpStatus: response.status } : {}) };
  }
  return {
    read: () => call('read'),
    initialize: (bundle, { transactionId }) => call('initialize', { bundle, transactionId }),
    commit: (transaction) => call('commit', { transaction }),
    recover: (identity = {}) => call('recover', identity),
  };
}
