/**
 * Provider registry. claude-svg is the only provider: the calling agent authors SVG
 * against the engine's sheet contract, so the engine makes no model calls of its own.
 */

import * as claudeSvg from './claude-svg.mjs';

export const PROVIDERS = ['claude-svg'];
export const DEFAULT_PROVIDER = 'claude-svg';

/**
 * @param {{ requested?: string }} input
 * @returns {{ name: 'claude-svg', provider: object, degraded: boolean, reason: string }}
 */
export function resolveProvider({ requested = 'auto' } = {}) {
  if (requested === 'openai') {
    throw new Error(
      'the openai provider was removed: claude-svg, where your coding agent authors the SVG, is the only provider',
    );
  }

  if (requested === 'claude-svg') {
    return { name: 'claude-svg', provider: claudeSvg, degraded: false, reason: 'requested' };
  }

  if (requested !== 'auto' && requested !== '') {
    throw new Error(`unknown provider "${requested}" (expected: ${PROVIDERS.join(' | ')})`);
  }

  return { name: DEFAULT_PROVIDER, provider: claudeSvg, degraded: false, reason: 'default ($0)' };
}
