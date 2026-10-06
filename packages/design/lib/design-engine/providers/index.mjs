/**
 * Provider registry. claude-svg is the only provider: the calling agent authors SVG
 * against the engine's contract, so the engine makes no model calls of its own.
 *
 * One interface: generateVariant(brief, opts) / iterate(session, feedback, opts)
 * / checkQuality(artifact, brief, opts). Future providers slot in here.
 */

import * as claudeSvg from './claude-svg.mjs';

export const PROVIDERS = ['claude-svg'];
export const DEFAULT_PROVIDER = 'claude-svg';

/**
 * @param {{ requested?: string }} input
 * @returns {{ name: 'claude-svg', provider: object, degraded: boolean, reason: string }}
 */
export function resolveProvider({ requested = 'auto' } = {}) {
  if (requested === 'claude-svg') {
    return { name: 'claude-svg', provider: claudeSvg, degraded: false, reason: 'requested' };
  }

  if (requested !== 'auto' && requested !== '') {
    throw new Error(`unknown provider "${requested}" (expected: ${PROVIDERS.join(' | ')})`);
  }

  return { name: DEFAULT_PROVIDER, provider: claudeSvg, degraded: false, reason: 'default ($0)' };
}
