import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';

test('evaluation declarations require explicit active sources and accept portable legacy reads', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'planr-evaluation-types-'));
  try {
    copyFileSync(new URL('../../lib/evaluation/runner.d.mts', import.meta.url), join(consumer, 'runner.d.mts'));
    writeFileSync(join(consumer, 'consumer.mts'), `
import { loadEvaluationInputs, runEvaluation } from './runner.mjs';
import type { EvaluationInputs, EvaluationOutcome, EvaluationRunOptions } from './runner.mjs';
const repoRoot = '/installed/pipeline';
const sourceRoot = '/selected/source';
const legacy: EvaluationInputs = loadEvaluationInputs({ repoRoot });
loadEvaluationInputs({ repoRoot, view: 'legacy' });
const active = loadEvaluationInputs({ repoRoot, sourceRoot, view: 'active' });
loadEvaluationInputs({ repoRoot, sourceRoot });
loadEvaluationInputs({ repoRoot, sourceRoot, view: 'legacy' });
const options: EvaluationRunOptions = { repoRoot, sourceRoot, now: '2026-09-22T00:00:00Z', inputs: active };
const outcome: Promise<EvaluationOutcome> = runEvaluation(options);
// @ts-expect-error active reads require the selected source root
loadEvaluationInputs({ repoRoot, view: 'active' });
// @ts-expect-error the view is an exact runtime choice
loadEvaluationInputs({ repoRoot, sourceRoot, view: 'current' });
// @ts-expect-error evaluation cannot discover an active source root
runEvaluation({ repoRoot, now: options.now });
// @ts-expect-error supplying inputs does not remove the source-root requirement
runEvaluation({ repoRoot, now: options.now, inputs: legacy });
void outcome;
`);
    const result = spawnSync(process.execPath, [
      join(resolveWorkspaceDependencyRoot('typescript'), 'bin', 'tsc'),
      '--noEmit', '--strict', '--target', 'ES2022',
      '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.mts',
    ], { cwd: consumer, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
