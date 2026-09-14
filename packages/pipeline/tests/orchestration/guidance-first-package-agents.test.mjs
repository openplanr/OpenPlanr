import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('shipped ordinary QA is actionable and has no release bookkeeping', () => {
  const qa = read('agents/qa-agent.md');
  const boundary = '## Explicit release-certification compatibility';
  const index = qa.indexOf(boundary);
  assert.ok(index > 0, 'release compatibility must be explicitly scoped');

  const ordinary = qa.slice(0, index);
  assert.match(ordinary, /human-readable (?:review|result)/iu);
  assert.match(ordinary, /acceptance criteria/iu);
  assert.match(ordinary, /practical|actionable/iu);
  assert.match(ordinary, /Missing Planr artifacts do not prevent review/iu);
  assert.doesNotMatch(
    ordinary,
    /candidateDigest|runId|reviewerIds|evidenceDigest|SHA-256|frozen roster|accepted receipt|JSON object/iu,
  );

  const compatibility = qa.slice(index);
  assert.match(compatibility, /only when the caller explicitly identifies/iu);
  assert.match(compatibility, /not a prerequisite for ordinary QA/iu);
});

test('shipped implementation agents use adaptive recovery and flexible task scope', () => {
  for (const path of [
    'agents/backend-agent.md',
    'agents/frontend-agent.md',
    'agents/modes/default/backend.md',
    'agents/modes/default/frontend.md',
    'agents/modes/spec-driven/backend.md',
    'agents/modes/spec-driven/frontend.md',
    'agents/modes/shared/task-context-resolution.md',
    'agents/modes/shared/verification-and-recovery-backend.md',
    'agents/modes/shared/verification-and-recovery-frontend.md',
    'agents/modes/shared/contract-create-modify-preserve.md',
  ]) {
    const guidance = read(path);
    assert.doesNotMatch(
      guidance,
      /3 R6|three failed|correction cap|run-manifest|error-report|MUST write|mandatory.*memory|touch only the declared files|do not write any file outside/iu,
      path,
    );
  }

  assert.match(read('agents/modes/shared/verification-and-recovery-backend.md'), /observed results suggest a useful next step/iu);
  assert.match(read('agents/modes/shared/task-context-resolution.md'), /load that exact task before implementation/iu);
  assert.match(read('agents/modes/shared/task-context-resolution.md'), /project-local stack file overrides the installed default/iu);
  assert.match(read('agents/frontend-agent.md'), /Resolve and load the active task through the selected mode/iu);
  assert.match(read('agents/backend-agent.md'), /Create\/Modify lists as expected scope/iu);
  assert.match(read('agents/modes/shared/contract-create-modify-preserve.md'), /expected change surface/iu);
  assert.match(read('agents/modes/shared/contract-create-modify-preserve.md'), /Preserve.*safety boundary/isu);
});

test('shipped specification guidance preserves R2 and schema semantics without phase gates', () => {
  for (const path of [
    'agents/specification-agent.md',
    'agents/modes/default/specification.md',
    'agents/modes/spec-driven/specification.md',
  ]) {
    const guidance = read(path);
    assert.match(guidance, /(?:R2|has_design)/u, path);
    assert.match(guidance, /(?:story|task).*schema|schema-compatible/isu, path);
    assert.match(guidance, /dependsOn/u, path);
    assert.doesNotMatch(
      guidance,
      /human review|phase approval|STOP\. Do not proceed|MUST write to .*memory|review receipt|content digest|correction budget/iu,
      path,
    );
  }
});

test('documentation and DevOps agents use QA as context, not an ordinary gate', () => {
  for (const path of [
    'agents/doc-gen-agent.md',
    'agents/devops-agent.md',
    'agents/modes/default/doc-gen.md',
    'agents/modes/spec-driven/doc-gen.md',
    'agents/modes/default/devops.md',
    'agents/modes/spec-driven/devops.md',
  ]) {
    const guidance = read(path);
    assert.doesNotMatch(guidance, /QA gate|verdict is PASS|must show PASS|skip silently.*QA/iu, path);
  }

  assert.match(read('agents/doc-gen-agent.md'), /Missing Planr or QA artifacts are not a reason to\s+skip/iu);
  assert.match(read('agents/modes/spec-driven/devops.md'), /optional stack and database context/iu);
  assert.match(read('agents/devops-agent.md'), /never deploys, pushes an image, mutates a\s+remote environment, or calls a cloud API/iu);
});
