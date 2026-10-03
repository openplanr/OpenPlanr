// @ts-check
/** Installed CLI dependency support, checked before loading prompt/runtime modules. */
/** @type {typeof import('./node-runtime.d.mts').CLI_NODE_RANGE} */
export const CLI_NODE_RANGE = '^20.19.0 || ^22.13.0 || >=23.5.0';
/** @type {typeof import('./node-runtime.d.mts').CLI_NODE_REMEDIATION} */
export const CLI_NODE_REMEDIATION =
  'Install a supported Node.js version, then rerun. OpenPlanr never changes Node.js for you.';

/** Accept released versions in the same branches as the installed production dependencies. */
/** @type {typeof import('./node-runtime.d.mts').supportsCliNodeVersion} */
export function supportsCliNodeVersion(version) {
  if (typeof version !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
    return false;
  const [major, minor, patch] = version.replace(/^v/u, '').split('.').map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return (
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 13) ||
    (major === 23 && minor >= 5) ||
    major > 23
  );
}

/** @type {typeof import('./node-runtime.d.mts').cliNodeVersionMessage} */
export function cliNodeVersionMessage(version) {
  return `OpenPlanr requires Node.js ${CLI_NODE_RANGE}; found ${version}.`;
}
