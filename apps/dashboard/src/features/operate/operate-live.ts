/** Loopback dashboard origin for owner-issued Operate reads. */
export function operateLiveOrigin(): string {
  if (typeof window === 'undefined') return '';
  const { origin, protocol, hostname, pathname, search, hash } = window.location;
  if (protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(hostname)) return '';
  if (pathname !== '/' || search || hash) return '';
  return origin;
}

/** True when the shell can reconcile governed Operate reads without a full reload. */
export function operateLiveReadsEnabled(): boolean {
  return operateLiveOrigin().length > 0;
}

/** Prefer owner-issued live reads over hydrated projection when the dashboard is connected. */
export function shouldPreferOperateLiveRoute(
  _hasValidatedProjection: boolean,
  connectionState: string,
): boolean {
  if (!operateLiveReadsEnabled()) return false;
  if (connectionState !== 'connected' && connectionState !== 'read-only') return false;
  return true;
}
