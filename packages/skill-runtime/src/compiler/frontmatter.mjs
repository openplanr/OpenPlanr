import { SkillRuntimeError } from '../errors.mjs';
import { canonicalText, parseMarkdownAsset } from './render-primitives.mjs';

/**
 * Read a markdown asset's frontmatter and body using the same shape the
 * markdown-v1 catalog already produces (`{ fields, frontmatter, lines, body }`).
 */
export function readFrontmatter(bytes, { expectedName } = {}) {
  return parseMarkdownAsset(bytes, { expectedName });
}

/**
 * Render a closed YAML frontmatter block from ordered `[key, value]` pairs. Used
 * by composed-v1 to project a skill's declared identity into a host asset.
 */
export function renderFrontmatterBlock(pairs) {
  const lines = pairs.map(([key, value]) => {
    if (typeof key !== 'string' || key.length === 0 || key.includes(':') || key.includes('\n')) {
      throw new SkillRuntimeError('E_FRONTMATTER_KEY_INVALID', `Frontmatter key ${String(key)} is invalid.`, { key });
    }
    const text = canonicalText(value);
    if (text.includes('\n')) throw new SkillRuntimeError('E_FRONTMATTER_VALUE_INVALID', `Frontmatter value for ${key} may not contain a newline.`, { key });
    return `${key}: ${text}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}
