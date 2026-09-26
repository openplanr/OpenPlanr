/**
 * Provider registry. claude-svg is the default and the only provider `auto`
 * resolves to; openai runs only on an explicit request (`--provider openai`)
 * and needs a key. A key in the environment never opts the user into billed
 * calls (hard rule 9 still holds: a missing key is never a dead-end).
 *
 * One interface: generateVariant(brief, opts) / iterate(session, feedback, opts)
 * / checkQuality(artifact, brief, opts). Future providers slot in here.
 */

import * as claudeSvg from './claudeSvg.mjs';
import * as openai from './openai.mjs';

export const PROVIDERS = ['openai', 'claude-svg'];
export const DEFAULT_PROVIDER = 'claude-svg';

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
          'Setup: `planr-design setup` (stores your key with mode 0600 and runs one small smoke image, billed to your OpenAI account) ' +
          'or export OPENAI_API_KEY for this run. Or drop the flag: claude-svg is the $0 default (agent-authored SVG — often better for logos/UI).',
      );
    }
    return { name: 'openai', provider: openai, degraded: false, reason: 'requested' };
  }

  if (requested === 'claude-svg') {
    return { name: 'claude-svg', provider: claudeSvg, degraded: false, reason: 'requested' };
  }

  if (requested !== 'auto' && requested !== '') {
    throw new Error(`unknown provider "${requested}" (expected: ${PROVIDERS.join(' | ')})`);
  }

  return {
    name: DEFAULT_PROVIDER,
    provider: claudeSvg,
    degraded: false,
    reason: 'default ($0); pass --provider openai to generate raster images with your own key',
  };
}
