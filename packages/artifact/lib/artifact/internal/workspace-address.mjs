/** Read-only workspace addressing, independent of encryption, packing, or network clients. */
export function createWorkspaceAddress({
  label,
  reviewPath,
  defaultBaseUrl = 'https://share.openplanr.dev',
}) {
  function normalizeWorkspaceBase(baseUrl = defaultBaseUrl) {
    const url = new URL(baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new TypeError(
        `${label} sharing requires an HTTPS origin or a local development server.`,
      );
    return url.origin;
  }
  function workspaceReviewUrl(access) {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(access.id))
      throw new TypeError(`Invalid ${label.toLowerCase()} workspace identity.`);
    return `${normalizeWorkspaceBase(access.baseUrl)}${reviewPath}/${access.id}`;
  }
  return { normalizeWorkspaceBase, workspaceReviewUrl };
}
