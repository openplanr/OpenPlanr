import { BUSINESS_EXECUTIVE_SKILL_BINDINGS } from './role-skills.mjs';

const SKILL_FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u;

export function splitSkillMarkdown(markdown) {
  const match = markdown.match(SKILL_FRONTMATTER);
  if (!match) {
    throw new Error('Skill markdown is missing YAML frontmatter.');
  }
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body: match[2] };
}

/** Cursor rule files already carry the product prefix; a second one reads as a stutter. */
export function cursorRuleName(canonicalName) {
  return canonicalName.startsWith('planr-') ? canonicalName.slice('planr-'.length) : canonicalName;
}

export function operateAdapterAssetPaths(clientId) {
  const roleSkillNames = BUSINESS_EXECUTIVE_SKILL_BINDINGS.map(({ skillName }) => skillName);
  if (clientId === 'claude-code') {
    return [
      'skills/planr-operate/SKILL.md',
      ...roleSkillNames.map((skillName) => `skills/${skillName}/SKILL.md`),
      'adapters/claude-code/README.md',
    ];
  }
  if (clientId === 'codex') {
    return [
      'adapters/codex/skills/planr-operate/SKILL.md',
      ...roleSkillNames.map((skillName) => `adapters/codex/skills/${skillName}/SKILL.md`),
      'adapters/codex/project-guidance.md',
    ];
  }
  return [
    'adapters/cursor/rules/openplanr-operate.mdc',
    ...roleSkillNames.map(
      (skillName) => `adapters/cursor/rules/openplanr-${cursorRuleName(skillName)}.mdc`,
    ),
    'adapters/cursor/rules/openplanr.mdc',
  ];
}

export function renderClaudeCodeReadme(skillIds = []) {
  const skillList = skillIds.map((skillId) => `- \`${skillId}\``).join('\n');
  return `# Claude Code adapter

The native plugin keeps slash-command compatibility and host-native agents.
Canonical skills provide deterministic context, output conventions, and useful
diagnostics for the requested work.

Artifact review always routes through \`planr artifact\`. Generic HTML uses the
headless \`document\` presentation by default; design boards and spatial variant
workflows use \`canvas\`. Private review sharing never publishes the artifact as a
standalone website.

## Canonical skills

These package projections are generated from the workspace \`skills/\` source of truth:

${skillList}

## Guided interaction

Infer reversible details from the repository. When a consequential decision
cannot be inferred, use Claude Code's native structured question surface; if it
is unavailable, ask one concise chat question at a time. Never dump a written
questionnaire on the user.

Spec, Plan, Plan Review, and Ship are guidance-first workflows. Planning-only
requests stop after the plan; implementation requests continue through the
relevant code changes and checks.

## Operate

The native \`/planr-pipeline:planr-operate\` skill copies
\`skills/planr-operate/SKILL.md\`. It scopes one review cycle with the human,
writes a single shared cycle brief, dispatches the five advisor lenses as
parallel subagents, then the challenger and the chair, and assembles a board
report from the files those lenses wrote. Each lens writes its own file and
returns only a short status summary, so no analysis is ever retyped through the
orchestrator. A lens that reports nothing is recorded absent and never filled in.
The board returns prioritized advice and concrete next actions. It does not
govern implementation or require a separate lifecycle decision.
`;
}

export function renderCodexProjectGuidance(skillIds = []) {
  const skillList = skillIds.map((skillId) => `- \`$${skillId}\``).join('\n');
  return `<!-- openplanr:runtime:start -->
## OpenPlanr project guidance

Use the installed skills when they match the request. They provide procedures
and context plus stable output conventions and diagnostics.

### Installed canonical skills

All skills below are generated from the workspace \`skills/\` source of truth:

${skillList}

Infer reversible details from the repository. When a consequential decision
cannot be inferred, use Codex's native structured question surface; if it is
unavailable, ask one concise chat question at a time. Never dump a written
questionnaire on the user.

Spec, Plan, Plan Review, and Ship are guidance-first workflows. Planning-only
requests stop after the plan; implementation requests continue through the
relevant code changes and checks. Use the installed \`$planr-plan\`,
\`$planr-design\`, \`$planr-artifact\`, \`$planr-ship\`, \`$planr-dashboard\`,
\`$planr-operate\`, \`$planr-sync\`, and \`$planr-doctor\` skills. \`$planr-operate\`
scopes one review cycle, writes a single shared cycle brief, and dispatches
the \`$planr-ceo-review\` through \`$planr-chair-review\` lenses — the five
advisors in parallel, then the challenger, then the chair. Every lens writes its
own file and returns only a short status summary; an absent lens is recorded
absent and never synthesised. The board returns prioritized advice and concrete
next actions; it does not govern implementation.
Artifact review must invoke the public
\`planr artifact\` route: generic HTML defaults to the headless \`document\`
presentation, while design boards and spatial variants use \`canvas\`. Verify
work in proportion to risk and fix relevant failures directly.
<!-- openplanr:runtime:end -->
`;
}

export function renderCursorProjectGuidance() {
  return `---
description: OpenPlanr project guidance
alwaysApply: true
---

Use the installed OpenPlanr rules when they match the request. They provide
procedures and context plus stable output conventions and diagnostics.

Infer reversible details from the repository. When a consequential decision
cannot be inferred, use Cursor's native structured question surface; if it is
unavailable, ask one concise chat question at a time. Never dump a written
questionnaire on the user.

Spec, Plan, Plan Review, and Ship are guidance-first workflows. Planning-only
requests stop after the plan; implementation requests continue through the
relevant code changes and checks. Verify work in proportion to risk and fix
relevant failures directly.

Invoke artifact review through \`planr artifact\`. Generic HTML defaults to the
headless \`document\` presentation; design boards and spatial variant reviews
use \`canvas\`.

For Operate requests, apply \`openplanr-operate.mdc\`. It may dispatch the
relevant review lenses and returns prioritized advice with concrete next
actions. Operate does not govern implementation or widen the user's request.
`;
}
