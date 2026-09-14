/**
 * Provider registry + graceful degradation (reference engines hard-fail
 * without an OpenAI key — fixed here, hard rule 9):
 *
 *   requested 'openai'      → needs a key; if absent, the error TELLS the user
 *                             both repairs (setup, or claude-svg) — never a dead-end.
 *   requested 'claude-svg'  → always available.
 *   requested 'auto'/empty  → openai when a key resolves, else claude-svg.
 *
 * One interface: generateVariant(brief, opts) / iterate(session, feedback, opts)
 * / checkQuality(artifact, brief, opts). Future providers slot in here.
 */

import * as openai from './openai.mjs';
import * as claudeSvg from './claudeSvg.mjs';

export const PROVIDERS = ['openai', 'claude-svg'];

/**
 * @param {{ requested?: string, auth: { apiKey: string|null } }} input
 * @returns {{ name: 'openai'|'claude-svg', provider: object, degraded: boolean, reason: string }}
 */
export function resolveProvider({ requested = 'auto', auth }) {
  const hasKey = Boolean(auth?.apiKey);

  if (requested === 'openai') {
    if (!hasKey) {
      throw new Error(
        'provider "openai" requested but no API key resolves. ' +
          'Repair: `planr-design setup` (stores a key + smoke test), or use `--provider claude-svg` (no key, agent-authored SVG — often better for logos/UI).',
      );
    }
    return { name: 'openai', provider: openai, degraded: false, reason: 'requested' };
  }

  if (requested === 'claude-svg') {
    return { name: 'claude-svg', provider: claudeSvg, degraded: false, reason: 'requested' };
  }

  if (hasKey) return { name: 'openai', provider: openai, degraded: false, reason: 'auto: key available' };
  return {
    name: 'claude-svg',
    provider: claudeSvg,
    degraded: true,
    reason: 'auto: no OpenAI key — claude-svg fallback (first-class: exact geometry + real type)',
  };
}
