import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readContributionGraph } from '../../../skill-runtime/src/catalog.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const roleIds = new Map(readContributionGraph({ repoRoot: root }).roles.map(({ source, id }) => [source, id]));

// Check both the role owner and its active installed projection. Shared mode
// guidance is shipped below references/agents; it is not a pipeline install tree.
for (const surface of ['canonical', 'claude']) {
  const read = (path) => {
    const target = surface === 'canonical' ? path
      : roleIds.has(path) ? `dist/plugins/claude/openplanr/agents/${roleIds.get(path)}.md`
        : `dist/plugins/claude/openplanr/references/${path}`;
    return readFileSync(join(root, target), 'utf8');
  };

  test(`${surface}: shipped ordinary QA is actionable and has no release bookkeeping`, () => {
    const qa = read('agents/qa/planr-qa/AGENT.md');
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

  test(`${surface}: shipped implementation agents use adaptive recovery and flexible task scope`, () => {
    for (const path of [
      'agents/dev/planr-backend/AGENT.md',
      'agents/dev/planr-frontend/AGENT.md',
      'agents/shared/modes/default/backend.md',
      'agents/shared/modes/default/frontend.md',
      'agents/shared/modes/spec-driven/backend.md',
      'agents/shared/modes/spec-driven/frontend.md',
      'agents/shared/modes/shared/task-context-resolution.md',
      'agents/shared/modes/shared/verification-and-recovery-backend.md',
      'agents/shared/modes/shared/verification-and-recovery-frontend.md',
      'agents/shared/modes/shared/contract-create-modify-preserve.md',
    ]) {
      const guidance = read(path);
      assert.doesNotMatch(
        guidance,
        /3 R6|three failed|correction cap|run-manifest|error-report|MUST write|mandatory.*memory|touch only the declared files|do not write any file outside/iu,
        path,
      );
    }

    assert.match(read('agents/shared/modes/shared/verification-and-recovery-backend.md'), /observed results suggest a useful next step/iu);
    assert.match(read('agents/shared/modes/shared/task-context-resolution.md'), /load that exact task before implementation/iu);
    assert.match(read('agents/shared/modes/shared/task-context-resolution.md'), /project-local stack file overrides the installed default/iu);
    assert.match(read('agents/dev/planr-frontend/AGENT.md'), /Resolve and load the active task through the selected mode/iu);
    assert.match(read('agents/dev/planr-backend/AGENT.md'), /Create\/Modify lists as expected scope/iu);
    assert.match(read('agents/shared/modes/shared/contract-create-modify-preserve.md'), /expected change surface/iu);
    assert.match(read('agents/shared/modes/shared/contract-create-modify-preserve.md'), /Preserve.*safety boundary/isu);
  });

  test(`${surface}: shipped specification guidance preserves R2 and schema semantics without phase gates`, () => {
    for (const path of [
      'agents/po/planr-specification/AGENT.md',
      'agents/shared/modes/default/specification.md',
      'agents/shared/modes/spec-driven/specification.md',
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

  test(`${surface}: documentation and DevOps agents use QA as context, not an ordinary gate`, () => {
    for (const path of [
      'agents/post-build/planr-documentation/AGENT.md',
      'agents/post-build/planr-devops/AGENT.md',
      'agents/shared/modes/default/doc-gen.md',
      'agents/shared/modes/spec-driven/doc-gen.md',
      'agents/shared/modes/default/devops.md',
      'agents/shared/modes/spec-driven/devops.md',
    ]) {
      const guidance = read(path);
      assert.doesNotMatch(guidance, /QA gate|verdict is PASS|must show PASS|skip silently.*QA/iu, path);
    }

    assert.match(read('agents/post-build/planr-documentation/AGENT.md'), /Missing Planr or QA artifacts are not a reason to\s+skip/iu);
    assert.match(read('agents/shared/modes/spec-driven/devops.md'), /optional stack and database context/iu);
    assert.match(read('agents/post-build/planr-devops/AGENT.md'), /never deploys, pushes an image, mutates a\s+remote environment, or calls a cloud API/iu);
  });
}
