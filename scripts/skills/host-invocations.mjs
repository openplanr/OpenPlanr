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
