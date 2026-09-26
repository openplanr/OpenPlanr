import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

const backendAndFrontendModes = [
  'agents/shared/modes/default/backend.md',
  'agents/shared/modes/default/frontend.md',
  'agents/shared/modes/spec-driven/backend.md',
  'agents/shared/modes/spec-driven/frontend.md',
];

const backendAndFrontendRoles = [
  'agents/dev/planr-backend/AGENT.md',
  'agents/dev/planr-frontend/AGENT.md',
];

const createModifyPreserveContract =
  'agents/shared/modes/shared/contract-create-modify-preserve.md';

const taskContextResolution = 'agents/shared/modes/shared/task-context-resolution.md';

const recoveryGuidance = [
  'agents/shared/modes/shared/verification-and-recovery-backend.md',
  'agents/shared/modes/shared/verification-and-recovery-frontend.md',
];

const specificationGuidance = [
  'agents/po/planr-specification/AGENT.md',
  'agents/shared/modes/default/specification.md',
  'agents/shared/modes/spec-driven/specification.md',
];

const postBuildRoles = [
  'agents/post-build/planr-devops/AGENT.md',
  'agents/post-build/planr-documentation/AGENT.md',
];

const postBuildModes = [
  'agents/shared/modes/default/devops.md',
  'agents/shared/modes/spec-driven/devops.md',
  'agents/shared/modes/default/doc-gen.md',
  'agents/shared/modes/spec-driven/doc-gen.md',
];

test('ordinary QA is direct, read-only, and free of release bookkeeping', () => {
  const qa = read('agents/qa/planr-qa/AGENT.md');
  const ordinary = qa.slice(0, qa.indexOf('## Explicit release-certification compatibility'));
  const frontmatter = qa.split('---')[1];

  assert.doesNotMatch(frontmatter, /(?:^|,)\s*Write(?:,|$)/u);
  assert.match(ordinary, /human-readable review/iu);
  assert.match(ordinary, /acceptance criteria/iu);
  assert.match(ordinary, /security/iu);
  assert.match(ordinary, /correctness/iu);
  assert.match(ordinary, /practical next action/iu);
  assert.match(ordinary, /Missing Planr artifacts do not prevent review/iu);
  assert.doesNotMatch(
    ordinary,
    /candidateDigest|runId|reviewerIds|evidenceDigest|SHA-256|frozen roster|accepted receipt|JSON object/iu,
  );

  for (const path of [
    'agents/shared/modes/default/qa.md',
    'agents/shared/modes/spec-driven/qa.md',
  ]) {
    const mode = read(path);
    assert.match(mode, /useful sources, not prerequisites/iu, path);
    assert.match(mode, /direct human-readable response/iu, path);
    assert.doesNotMatch(
      mode,
      /candidate|digest|gate evidence|review event|closure read model/iu,
      path,
    );
  }
});

test('implementation roles recover from observed results without retry budgets or mandatory memory', () => {
  for (const path of backendAndFrontendRoles) {
    const guidance = read(path);
    assert.match(guidance, /Resolve and load the active task through the selected mode/iu, path);
    assert.match(guidance, /Create\/Modify lists as expected scope/iu, path);
    assert.match(guidance, /Directly required companion/iu, path);
    assert.match(guidance, /Keep every genuine Preserve path unchanged/iu, path);
    assert.match(guidance, /Verify in proportion to risk/iu, path);
    assert.doesNotMatch(
      guidance,
      /3 R6|three failed|error-report|run-manifest|ONE task spec|Do not read other task|touch only files listed|files outside the task lists|orchestrator owns .*status/iu,
      path,
    );
  }

  {
    const guidance = read(createModifyPreserveContract);
    assert.match(guidance, /expected change surface, not an exhaustive\s+lock list/iu);
    assert.match(guidance, /directly required companion/iu);
    assert.match(guidance, /Leave every genuine Preserve path unchanged/iu);
    assert.doesNotMatch(
      guidance,
      /Do not write any file outside|Touch only the declared files|error-report|memory\.md/iu,
    );
  }

  for (const path of recoveryGuidance) {
    const guidance = read(path);
    assert.match(guidance, /inspect the actual error/iu, path);
    assert.match(guidance, /observed results suggest a useful next step/iu, path);
    assert.match(guidance, /failing command or operation/iu, path);
    assert.match(guidance, /affected requirement/iu, path);
    assert.match(guidance, /Project learning notes are optional/iu, path);
    assert.doesNotMatch(
      guidance,
      /Max 3|three failed|iteration\s+2|MUST write|mandatory.*memory|correction cap|authoriz|ask immediately before/iu,
      path,
    );
  }

  for (const path of backendAndFrontendModes) {
    const guidance = read(path);
    assert.match(guidance, /Use that exact (?:path|task path) first/iu, path);
    assert.match(guidance, /ActiveStackFiles/iu, path);
    assert.match(guidance, /dependsOn/iu, path);
    assert.match(guidance, /adaptive verification and recovery/iu, path);
    assert.match(guidance, /observed|report/iu, path);
    assert.doesNotMatch(
      guidance,
      /human review|correction cap|three failed|STOP\. Write|Authorization and recovery/iu,
      path,
    );
  }
});

test('Ship implementation roles deterministically recover task and parent context', () => {
  const shared = read(taskContextResolution);
  assert.match(shared, /load that exact task before implementation/iu);
  assert.match(shared, /`id`, `storyId`, `specId` or `featureSlug`, `type`/u);
  assert.match(shared, /Objective, Implementation or Technical Spec/iu);
  assert.match(shared, /Create, Modify, and Preserve/iu);
  assert.match(shared, /Follow `storyId` to the parent story Markdown/iu);
  assert.match(shared, /Gherkin sidecar when one exists; its absence is not an error/iu);
  assert.match(shared, /Treat `dependsOn` as real output dependency context/u);
  assert.match(shared, /Do not infer ordering from shared paths, file overlap, or prose/u);
  assert.match(shared, /input\/tech\/stack\.md/u);
  assert.match(shared, /\{\{PIPELINE_PACKAGE_ROOT\}\}\/stacks\/<logical-path>/u);
  assert.match(shared, /\{\{PROJECT_STACKS_ROOT\}\}\/<logical-path>/u);
  assert.match(shared, /project-local stack file overrides the installed default/iu);
  assert.match(shared, /Outcome.*completed, partial, or blocked/isu);
  assert.match(shared, /Issues.*always include/isu);
  assert.match(shared, /problem, impact,\s+and next action/iu);
  assert.match(shared, /write `none` when the issues array is empty/iu);
  assert.doesNotMatch(shared, /receipt|digest|run[- ]?id|fixed retry|approval gate/iu);

  for (const path of backendAndFrontendRoles) {
    const role = read(path);
    assert.match(role, /Resolve and load the active task through the selected mode/iu, path);
    assert.match(role, /technical specification, acceptance criteria, `dependsOn` edges/iu, path);
    assert.match(role, /task-context-resolution\.md/u, path);
    assert.match(role, /\{\{PROJECT_STACKS_ROOT\}\}/u, path);
  }

  for (const path of [
    'agents/shared/modes/spec-driven/backend.md',
    'agents/shared/modes/spec-driven/frontend.md',
  ]) {
    const mode = read(path);
    assert.match(mode, /<SPEC_DIR>\/tasks\/T-NNN-\{slug\}\.md/u, path);
    assert.match(mode, /<SPEC_DIR>\/stories\/\{storyId\}-\*\.md/u, path);
    assert.match(mode, /\{storyId\}-gherkin\.feature/u, path);
    assert.match(mode, /flat\s+`<SPEC_DIR>\/tasks\/` directory/iu, path);
  }

  for (const path of [
    'agents/shared/modes/default/backend.md',
    'agents/shared/modes/default/frontend.md',
  ]) {
    const mode = read(path);
    assert.match(mode, /input\/specs\/spec-\{name\}\.md/u, path);
    assert.match(mode, /output\/feats\/feat-\{name\}\/us-\{N\}\/tasks/u, path);
    assert.match(mode, /Default-mode task IDs are story-scoped/u, path);
  }

  assert.match(read('agents/shared/modes/spec-driven/backend.md'), /output\/db\/schema\.json/u);
  assert.match(read('agents/shared/modes/default/backend.md'), /table and column names/iu);
  assert.match(
    read('agents/shared/modes/spec-driven/frontend.md'),
    /<SPEC_DIR>\/design\/design-spec\.md/u,
  );
  assert.match(
    read('agents/shared/modes/default/frontend.md'),
    /output\/feats\/feat-\{name\}\/design-spec\.md/u,
  );
});

test('specification preserves the planning contract without lifecycle gates', () => {
  for (const path of specificationGuidance) {
    const guidance = read(path);
    assert.match(guidance, /(?:R2|has_design)/u, path);
    assert.match(guidance, /(?:story|task).*schema|schema-compatible/isu, path);
    assert.match(guidance, /dependsOn/u, path);
    assert.doesNotMatch(
      guidance,
      /human review|phase approval|MUST write to .*memory|STOP\. Do not proceed|review receipt|content digest|correction budget/iu,
      path,
    );
  }
});

test('post-build roles use relevant context without QA artifact prerequisites', () => {
  for (const path of postBuildRoles) {
    const guidance = read(path);
    assert.match(guidance, /requested outcome|implemented behavior/iu, path);
    assert.match(guidance, /Verify .*in proportion|verification.*proportion/isu, path);
    assert.doesNotMatch(
      guidance,
      /after qa-agent verdict|QA verdict is PASS|QA-report path|QA-gate|always reads `qa-report\.md`/iu,
      path,
    );
  }

  for (const path of postBuildModes) {
    const guidance = read(path);
    assert.match(guidance, /request|requested outcome/iu, path);
    assert.match(
      guidance,
      /When useful|useful inputs, not prerequisites|optional stack and database context/iu,
      path,
    );
    assert.doesNotMatch(guidance, /qa-report|QA gate|Verdict: PASS|skip silently/iu, path);
  }

  const devops = read('agents/post-build/planr-devops/AGENT.md');
  assert.match(
    devops,
    /never deploys, pushes an image, mutates a\s+remote environment, or calls a cloud API/iu,
  );

  const documentation = read('agents/post-build/planr-documentation/AGENT.md');
  assert.match(documentation, /Missing Planr or QA artifacts are not a reason to\s+skip/iu);
  assert.match(documentation, /Preserve hand-written sections/iu);
});

test('design questions and compatibility routing do not create lifecycle gates', () => {
  const template = read('agents/shared/modes/shared/design-spec-template.md');
  assert.match(template, /recommended default/iu);
  assert.match(template, /Do not block ordinary implementation/iu);
  assert.doesNotMatch(template, /must be cleared before `\/ship`/iu);

  const aliasTemplate = read('packages/skill-runtime/templates/legacy-alias.md');
  assert.match(aliasTemplate, /Do not implement a second workflow or add lifecycle machinery/iu);
  assert.match(aliasTemplate, /real effect boundaries/iu);
  assert.doesNotMatch(aliasTemplate, /required approval gates/iu);
});
