import { serializeYamlScalar } from '../compiler/index.mjs';
import { SkillRuntimeError } from '../errors.mjs';

const MAX_SHORT_DESCRIPTION = 64;

function displayName(skillId) {
  return skillId
    .split('-')
    .map((part) => (part === 'planr' ? 'Planr' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function shortDescription(description) {
  const compact = String(description).replace(/\s+/gu, ' ').trim();
  if (compact.length <= MAX_SHORT_DESCRIPTION) return compact;
  const candidate = compact.slice(0, MAX_SHORT_DESCRIPTION + 1);
  const boundary = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, boundary > 24 ? boundary : MAX_SHORT_DESCRIPTION - 1).replace(/[.,;:]$/u, '')}…`;
}

/** Render one Codex-native skill card from canonical skill identity. */
export function renderOpenAiSkillMetadata({ skillId, description, invocation = `$${skillId}` }) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skillId) ||
    typeof description !== 'string' ||
    description.trim().length === 0
  ) {
    throw new SkillRuntimeError(
      'E_SKILL_OPENAI_METADATA_INVALID',
      'Codex skill metadata requires a canonical skill ID and non-empty description.',
      { skillId, repair: 'Use the parsed canonical SKILL.md identity as the metadata source.' },
    );
  }
  if (
    typeof invocation !== 'string' ||
    !/^\$[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)?$/u.test(invocation)
  ) {
    throw new SkillRuntimeError(
      'E_SKILL_OPENAI_METADATA_INVALID',
      'Codex skill metadata requires a valid explicit invocation.',
      { skillId, invocation },
    );
  }
  const summary = shortDescription(description);
  const prompt = `Use ${invocation} to ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
  return [
    'interface:',
    `  display_name: ${serializeYamlScalar(displayName(skillId))}`,
    `  short_description: ${serializeYamlScalar(summary)}`,
    `  default_prompt: ${serializeYamlScalar(prompt)}`,
    'policy:',
    '  allow_implicit_invocation: true',
    '',
  ].join('\n');
}
