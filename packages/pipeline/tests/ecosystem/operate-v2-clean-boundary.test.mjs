import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the clean-boundary report passes locally without requiring excluded private owner reports', () => {
  const result = spawnSync(process.execPath, ['conformance/verify-operate-v2-clean-boundary.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'NOT_APPLICABLE');
  assert.equal(report.local.status, 'PASS');
  assert.equal(report.local.packagePurity, true);
  assert.equal(report.local.evidence.ok, true);
  assert.equal(report.local.evidence.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.deepEqual(report.downstream, []);
  const evidenceSource = readFileSync(
    new URL('../../lib/operate/evidence-v2.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    evidenceSource,
    /node:fs|node:child_process|fetch\(|import\(|require\(|spawn\(|exec\(/u,
  );
  assert.doesNotMatch(evidenceSource, /citation|operating-providers\.json|private[-_ ]?consumer/iu);
  const planrResolver = readFileSync(
    new URL('../../lib/operate/evidence-planr-v2.mjs', import.meta.url),
    'utf8',
  );
  const artifactResolver = readFileSync(
    new URL('../../lib/operate/evidence-artifact-v2.mjs', import.meta.url),
    'utf8',
  );
  const materializer = readFileSync(
    new URL('../../lib/operate/evidence-materialization-v2.mjs', import.meta.url),
    'utf8',
  );
  const projections = readFileSync(
    new URL('../../lib/operate/evidence-projections-v2.mjs', import.meta.url),
    'utf8',
  );
  for (const source of [planrResolver, artifactResolver, materializer, projections]) {
    assert.doesNotMatch(
      source,
      /citation|operating-providers\.json|private[-_ ]?consumer|fetch\(|spawn\(|exec\(/iu,
    );
  }
  assert.doesNotMatch(
    artifactResolver,
    /acceptOperatingAssignmentSubmission|artifact\.created|evidence\.resolved/iu,
  );
  const governedExtensions = readFileSync(
    new URL('../../lib/operate/governed-extensions-v2.mjs', import.meta.url),
    'utf8',
  );
  const containedExecutors = readFileSync(
    new URL('../../lib/operate/reference-governed-executors-v2.mjs', import.meta.url),
    'utf8',
  );
  for (const source of [governedExtensions, containedExecutors]) {
    assert.doesNotMatch(
      source,
      /from ['"]node:(?:fs|net|http|https|child_process|worker_threads)['"]|fetch\(|WebSocket|EventSource|process\.env|private[-_ ]?consumer/iu,
    );
    assert.doesNotMatch(
      source,
      /\.planr\/products|\.planr\/specs|\.planr\/runs|\.pipeline-shipped/iu,
    );
  }
  assert.doesNotMatch(
    containedExecutors,
    /acceptOperatingAssignmentSubmission|createOperatingRuntimeEvent|appendOperating|writeFile|artifact\.created|operation\.succeeded/iu,
  );
});
