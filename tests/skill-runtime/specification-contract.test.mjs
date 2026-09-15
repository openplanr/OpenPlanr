import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));

const agentPath = 'agents/po/planr-specification/AGENT.md';
const defaultPath = 'agents/shared/modes/default/specification.md';
const specDrivenPath = 'agents/shared/modes/spec-driven/specification.md';

test('specification frontmatter guidance agrees with the Protocol v1.7 schemas', () => {
  const guidance = read(agentPath);
  const story = readJson('packages/pipeline/schemas/v1.7.0/story.schema.json');
  const task = readJson('packages/pipeline/schemas/v1.7.0/task.schema.json');

  for (const field of story.required) {
    assert.match(guidance, new RegExp(`\\b${field}\\b`, 'u'), `missing story field ${field}`);
  }
  for (const field of task.required) {
    assert.match(guidance, new RegExp(`\\b${field}\\b`, 'u'), `missing task field ${field}`);
  }

  assert.ok(story.properties.status.enum.includes('pending'));
  assert.ok(task.properties.status.enum.includes('done'));
  assert.match(guidance, /new.*status: "pending"|status: "pending"/isu);
  assert.match(guidance, /exactly one mode-specific parent/iu);
  assert.match(guidance, /Tech.*backend-agent.*UI.*frontend-agent/isu);
  assert.match(guidance, /board\s+sync fields remain owned by the sync integration/iu);
});

test('mode guidance loads stack, design, and database context deterministically', () => {
  for (const path of [defaultPath, specDrivenPath]) {
    const guidance = read(path);
    const packageIndex = guidance.indexOf('{{PIPELINE_PACKAGE_ROOT}}/stacks/...');
    const projectIndex = guidance.indexOf('{{PROJECT_STACKS_ROOT}}/...');

    assert.match(guidance, /ActiveStackFiles/u, path);
    assert.ok(packageIndex >= 0, `${path}: package stack lookup missing`);
    assert.ok(projectIndex > packageIndex, `${path}: project override must load after package default`);
    assert.match(guidance, /project file overrides\s+the installed file/iu, path);
    assert.match(guidance, /design-spec\.md/iu, path);
    assert.match(guidance, /\.png/iu, path);
    assert.match(guidance, /output\/db\/schema\.json/iu, path);
    assert.match(guidance, /report that exact entry/iu, path);
  }
});

test('R2 and output paths stay stable in both modes', () => {
  const agent = read(agentPath);
  const defaultMode = read(defaultPath);
  const specMode = read(specDrivenPath);

  for (const guidance of [agent, defaultMode, specMode]) {
    assert.match(guidance, /one.*UI.*frontend-agent.*one.*Tech.*backend-agent/isu);
    assert.match(guidance, /without design.*one Tech task.*backend-agent|has_design = false.*one.*Tech/isu);
    assert.match(guidance, /never (?:emit|write) (?:more than two|a third) task/iu);
  }

  assert.match(defaultMode, /output\/feats\/feat-\$ARGUMENTS\/us-\{N\}\/us-\{N\}\.md/u);
  assert.match(defaultMode, /task-1\.md.*frontend-agent.*task-2\.md.*backend-agent/isu);
  assert.match(specMode, /<SPEC_DIR>\/stories\/US-NNN-\{slug\}\.md/u);
  assert.match(specMode, /flat\s+`<SPEC_DIR>\/tasks\/` directory/iu);
  assert.match(specMode, /storyId/u);
});

test('host-native skill references and deterministic templates share one artifact contract', () => {
  const guidance = read(agentPath);
  const specSkill = read('skills/planr-spec/SKILL.md');
  const planSkill = read('skills/planr-plan/SKILL.md');
  const specContract = read('skills/planr-spec/references/specification-contract.md');
  const artifactContract = read('skills/planr-plan/references/artifact-contract.md');
  const specTemplate = read('packages/cli/src/templates/spec/spec.md.hbs');
  const storyTemplate = read('packages/cli/src/templates/spec/story.md.hbs');
  const taskTemplate = read('packages/cli/src/templates/spec/task.md.hbs');

  for (const heading of [
    '## Context & Goal',
    '## Audience',
    '## Outcome & Measurement',
    '## Functional Requirements',
    '## Business Rules',
    '## Constraints',
    '## Evidence Expectations',
    '## Failure Modes',
    '## Rollback',
    '## Scope Boundaries',
    '## Acceptance Criteria',
    '## Declared Risk Specialists',
    '## Notes for Decomposition',
  ]) {
    assert.ok(specTemplate.includes(heading), `spec template missing ${heading}`);
    assert.ok(specContract.includes(`\`${heading}\``), `specification contract missing ${heading}`);
  }
  assert.match(specSkill, /\[the specification contract\]\(references\/specification-contract\.md\)/u);

  for (const heading of [
    '## User Story',
    '## Scope',
    '## Acceptance Criteria',
    '## Task Breakdown',
    '## Dependencies',
    '## Notes',
  ]) {
    assert.match(storyTemplate, new RegExp(heading, 'u'));
    assert.match(guidance, new RegExp(heading.replace('## ', '`## ') + '`', 'u'));
    assert.ok(artifactContract.includes(`\`${heading}\``), `plan artifact contract missing ${heading}`);
  }

  for (const heading of [
    '## Objective',
    '## Files',
    '### Create',
    '### Modify',
    '### Preserve (do not touch)',
    '## Technical Spec',
    '## Test Requirements',
    '## Definition of Done',
  ]) {
    assert.ok(taskTemplate.includes(heading), `task template missing ${heading}`);
    assert.ok(guidance.includes(`\`${heading}\``), `agent guidance missing ${heading}`);
    assert.ok(artifactContract.includes(`\`${heading}\``), `plan artifact contract missing ${heading}`);
  }

  assert.match(planSkill, /\[the artifact contract\]\(references\/artifact-contract\.md\)/u);

  for (const field of ['rationale:', 'dependsOn:', 'preserve:', 'reviewRisks:', 'browserSurfaces:', 'acceptanceRefs:']) {
    assert.ok(taskTemplate.includes(field), `task template missing ${field}`);
  }
});

test('task dependencies and diagnostics guide execution without workflow bookkeeping', () => {
  for (const path of [agentPath, defaultPath, specDrivenPath]) {
    const guidance = read(path);
    assert.match(guidance, /dependsOn/u, path);
    assert.match(guidance, /only when a task consumes another task's output|only for real output dependencies/iu, path);
    assert.match(guidance, /do not (?:derive|infer).*file overlap|never infer ordering from file overlap/isu, path);
    assert.match(guidance, /exact path|artifact path/iu, path);
    assert.doesNotMatch(
      guidance,
      /human review|phase approval|accepted receipt|content digest|SHA-256|correction budget|MUST write to .*memory/iu,
      path,
    );
  }
});
