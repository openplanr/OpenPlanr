import { SkillRuntimeError } from '../../packages/skill-runtime/src/errors.mjs';

const CANONICAL_PREFIX = 'planr-';

export const HOST_PLUGIN_NAME = 'planr';

export function projectedSkillName(skillId) {
  if (typeof skillId !== 'string' || !skillId.startsWith(CANONICAL_PREFIX)) {
    throw new Error(`Cannot project non-OpenPlanr skill identity: ${skillId}`);
  }
  return skillId.slice(CANONICAL_PREFIX.length);
}

export function namespacedInvocation(skillId, host) {
  const name = projectedSkillName(skillId);
  if (host === 'claude-code') return `/${HOST_PLUGIN_NAME}:${name}`;
  if (host === 'codex') return `$${HOST_PLUGIN_NAME}:${name}`;
  throw new Error(`Unsupported namespaced invocation host: ${host}`);
}

export function renderNamespacedSkill(markdown, skillId) {
  const projectedName = projectedSkillName(skillId);
  return String(markdown)
    .replace(new RegExp(`^name:\\s*["']?${skillId}["']?\\s*$`, 'mu'), `name: ${projectedName}`)
    .replace(/\/openplanr:planr-([a-z0-9-]+)/gu, '/planr:$1')
    .replace(/\/planr-([a-z0-9-]+)/gu, '/planr:$1')
    .replace(/\$openplanr:planr-([a-z0-9-]+)/gu, '$planr:$1')
    .replace(/\$planr-([a-z0-9-]+)/gu, '$planr:$1');
}

/** Cursor keeps each rule beside its resource folder, one level above the canonical skill body. */
export function renderCursorSkillBody(markdown, skillId, resources) {
  const paths = new Set(resources.map((resource) => resource.path));
  return String(markdown)
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/\]\(([^)]+)\)/gu, (match, target) => {
      const [path, suffix = ''] = target.split(/(?=[?#])/u, 2);
      const relative = path.replace(/^\.\//u, '');
      return paths.has(relative) ? `](${skillId}/${relative}${suffix})` : match;
    });
}

/** Adds the Claude Code flag that keeps the model from invoking a skill itself. */
export function renderUserOnlySkill(markdown, skillId) {
  const source = String(markdown);
  const frontmatter = /^---\n[\s\S]*?\n---\n/u.exec(source)?.[0];
  if (!frontmatter)
    throw new SkillRuntimeError(
      'E_SKILL_USER_ONLY_FRONTMATTER_INVALID',
      `${skillId} is user-only but its SKILL.md has no closed frontmatter block.`,
      { skillId },
    );
  const declared = /^disable-model-invocation:\s*(.*)$/mu.exec(frontmatter)?.[1].trim();
  if (declared === 'true') return source;
  if (declared !== undefined)
    throw new SkillRuntimeError(
      'E_SKILL_USER_ONLY_FRONTMATTER_INVALID',
      `${skillId} is user-only in the registry but its SKILL.md declares disable-model-invocation: ${declared}.`,
      { skillId, declared },
    );
  return `${frontmatter.slice(0, -4)}disable-model-invocation: true\n---\n${source.slice(frontmatter.length)}`;
}

/**
 * Renders a Cursor rule. A user-only rule omits `description` so Cursor applies it only when
 * the user mentions it; the description then opens the body instead.
 */
export function renderCursorRule({ description, body, userOnly = false }) {
  if (!userOnly)
    return `---\ndescription: ${JSON.stringify(description)}\nalwaysApply: false\n---\n\n${body}`;
  const title = /^# [^\n]*\n/u.exec(body)?.[0] ?? '';
  return `---\nalwaysApply: false\n---\n\n${title}${title ? '\n' : ''}${description}\n\n${body.slice(title.length).replace(/^\n+/u, '')}`;
}
