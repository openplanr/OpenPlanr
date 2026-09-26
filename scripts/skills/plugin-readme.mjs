import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The Anthropic plugin directory rejects a plugin folder whose README has fewer words.
export const PLUGIN_README_MINIMUM_WORDS = 40;
export const CLAUDE_PLUGIN_README_TEMPLATE = 'scripts/skills/templates/claude-plugin-readme.md';

/** Counts words outside fenced code blocks, inline code spans, and link targets. */
export function countReadmeWords(markdown) {
  let fenced = false;
  const prose = String(markdown)
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/u.test(line)) {
        fenced = !fenced;
        return '';
      }
      return fenced ? '' : line.replace(/`[^`]*`/gu, '').replace(/\]\([^)]*\)/gu, ']');
    });
  return prose
    .join(' ')
    .split(/\s+/u)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Renders the Claude plugin README from its template with the generator's own totals. */
export function renderClaudePluginReadme({ repoRoot, skillCount, roleCount, pluginVersion }) {
  const readme = readFileSync(resolve(repoRoot, CLAUDE_PLUGIN_README_TEMPLATE), 'utf8')
    .replace(/\r\n/gu, '\n')
    .replaceAll('{{SKILL_COUNT}}', String(skillCount))
    .replaceAll('{{ROLE_COUNT}}', String(roleCount))
    .replaceAll('{{PLUGIN_VERSION}}', pluginVersion);
  const unresolved = readme.match(/\{\{[A-Z0-9_]+\}\}/gu);
  if (unresolved) {
    throw new Error(
      `${CLAUDE_PLUGIN_README_TEMPLATE} has unresolved variables: ${[...new Set(unresolved)].join(', ')}.`,
    );
  }
  const words = countReadmeWords(readme);
  if (words < PLUGIN_README_MINIMUM_WORDS) {
    throw new Error(
      `${CLAUDE_PLUGIN_README_TEMPLATE} renders ${words} words outside code blocks; the plugin directory requires at least ${PLUGIN_README_MINIMUM_WORDS}.`,
    );
  }
  return readme;
}
