/** Node test client with the same short-route cookie handling as a browser. */
import { startDesignReview as startNative } from '../lib/design/review.mjs';

const cookies = new Map();
export async function startDesignReview(file, options) {
  const session = await startNative(file, options);
  const response = await globalThis.fetch(session.url);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (cookie) cookies.set(new URL(session.url).origin, cookie);
  return session;
}
export function fetch(input, options = {}) {
  const url = new URL(String(input));
  const headers = new Headers(options.headers);
  const cookie = cookies.get(url.origin);
  if (cookie && url.pathname.startsWith('/studio/') && options.credentials !== 'omit')
    headers.set('cookie', cookie);
  return globalThis.fetch(input, { ...options, headers });
}
