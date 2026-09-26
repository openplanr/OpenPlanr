import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { completePlan, preparePlan, prepareShip, sha256Jcs } from '../../lib/pipeline/index.mjs';

const bridge = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

function writeOrigin(specDir, origin) {
  const body = structuredClone(origin);
  body.originHash = sha256Jcs(
    Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'originHash')),
  );
  writeFileSync(join(specDir, 'operating-origin.json'), `${JSON.stringify(body)}\n`);
  return body;
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture({
  directory = 'SPEC-020-retention-workflow',
  id = 'SPEC-020',
  slug = 'retention-workflow',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'planr-origin-inheritance-'));
  const specDir = join(root, '.planr/specs', directory);
  mkdirSync(join(specDir, 'stories'), { recursive: true });
  mkdirSync(join(specDir, 'tasks'), { recursive: true });
  mkdirSync(join(specDir, 'design'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  writeFileSync(join(root, '.planr/config.json'), JSON.stringify({ idPrefix: { spec: 'SPEC' } }));
  writeFileSync(
    join(root, 'input', 'tech', 'stack.md'),
    'BuildCommand: "node --version"\nTestCommand: "node --version"\n',
  );
  const specText = `---\nid: "${id}"\nslug: "${slug}"\n---\nCanonical SPEC body.\n`;
  const specPath = join(specDir, `${id}-${slug}.md`);
  writeFileSync(specPath, specText);
  writeFileSync(
    join(specDir, 'stories/US-001-story.md'),
    `---\nid: "US-001"\nspecId: "${id}"\nstatus: "pending"\n---\n`,
  );
  writeFileSync(
    join(specDir, 'tasks/T-001-task.md'),
    `---\nid: "T-001"\nstoryId: "US-001"\nspecId: "${id}"\nstatus: "pending"\ndependsOn: []\n---\n`,
  );
  const origin = structuredClone(bridge['operating-origin']);
  origin.proposalId = `oprop_${'1'.repeat(32)}`;
  origin.transaction.transactionId = `txn_${'2'.repeat(32)}`;
  origin.spec = {
    ...origin.spec,
    specId: id,
    slug,
    contentHash: `sha256:${createHash('sha256').update(specText, 'utf8').digest('hex')}`,
  };
  writeOrigin(specDir, origin);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  return { root, specDir, specPath, origin };
}

test('PLAN and SHIP preview inherit one safe origin only through their parent SPEC', () => {
  const { root } = fixture();
  const planned = preparePlan({ projectRoot: root, feature: 'retention-workflow' });
  assert.equal(planned.operatingOrigin.correlationId, 'corr-001');
  assert.equal(planned.operatingOrigin.specId, 'SPEC-020');
  assert.equal(Object.hasOwn(planned.operatingOrigin, 'evidence'), false);
  const shipped = prepareShip({
    projectRoot: root,
    feature: 'retention-workflow',
    humanReviewConfirmed: true,
  });
  assert.deepEqual(shipped.operatingOrigin, planned.operatingOrigin);
  completePlan({
    projectRoot: root,
    feature: 'retention-workflow',
    runtime: 'codex',
    runId: 'plan-run-001',
  });
  const events = readFileSync(join(root, '.planr/provenance.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  const planEvent = events.find(({ operation }) => operation === 'decomposed');
  assert.equal(planEvent.correlation.correlation_id, 'corr-001');
});

test('missing origin is compatible while tamper and foreign SPEC identity fail closed', () => {
  const { root, specDir, origin } = fixture();
  const originPath = join(specDir, 'operating-origin.json');
  unlinkSync(originPath);
  assert.equal(
    preparePlan({ projectRoot: root, feature: 'retention-workflow' }).operatingOrigin,
    null,
  );
  completePlan({
    projectRoot: root,
    feature: 'retention-workflow',
    runtime: 'codex',
    runId: 'plan-no-origin',
  });
  const noOriginEvent = JSON.parse(
    readFileSync(join(root, '.planr/provenance.jsonl'), 'utf8').trim(),
  );
  assert.equal(Object.hasOwn(noOriginEvent, 'correlation'), false);
  assert.equal(
    prepareShip({ projectRoot: root, feature: 'retention-workflow', humanReviewConfirmed: true })
      .operatingOrigin,
    null,
  );
  const foreign = structuredClone(origin);
  foreign.spec.specId = 'SPEC-999';
  writeOrigin(specDir, foreign);
  assert.throws(
    () => preparePlan({ projectRoot: root, feature: 'retention-workflow' }),
    (error) => error.code === 'E_OPERATING_ORIGIN_INVALID',
  );
  writeFileSync(
    originPath,
    `${JSON.stringify({ ...origin, originHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' })}\n`,
  );
  assert.throws(
    () => preparePlan({ projectRoot: root, feature: 'retention-workflow' }),
    (error) => error.code === 'E_OPERATING_ORIGIN_INVALID',
  );
});

test('origin custody rejects directory-prefix, slug, SPEC bytes, and symbolic-file substitution', () => {
  const prefix = fixture({ directory: 'SPEC-020-evil', slug: 'retention-workflow' });
  assert.throws(
    () => preparePlan({ projectRoot: prefix.root, feature: 'evil' }),
    (error) => error.code === 'E_OPERATING_ORIGIN_INVALID',
  );

  const slugMismatch = fixture();
  const mismatchText = readFileSync(slugMismatch.specPath, 'utf8').replace(
    'slug: "retention-workflow"',
    'slug: "foreign-workflow"',
  );
  writeFileSync(slugMismatch.specPath, mismatchText);
  const mismatch = structuredClone(slugMismatch.origin);
  mismatch.spec.contentHash = `sha256:${createHash('sha256').update(mismatchText, 'utf8').digest('hex')}`;
  writeOrigin(slugMismatch.specDir, mismatch);
  assert.throws(
    () => preparePlan({ projectRoot: slugMismatch.root, feature: 'retention-workflow' }),
    (error) => error.code === 'E_OPERATING_ORIGIN_INVALID',
  );

  const bytes = fixture();
  writeFileSync(bytes.specPath, `${readFileSync(bytes.specPath, 'utf8')}tampered\n`);
  assert.throws(
    () => preparePlan({ projectRoot: bytes.root, feature: 'retention-workflow' }),
    (error) => error.code === 'E_OPERATING_ORIGIN_INVALID',
  );

  const symbolic = fixture();
  const realOrigin = join(symbolic.specDir, 'origin-real.json');
  writeFileSync(realOrigin, readFileSync(join(symbolic.specDir, 'operating-origin.json')));
  unlinkSync(join(symbolic.specDir, 'operating-origin.json'));
  symlinkSync(realOrigin, join(symbolic.specDir, 'operating-origin.json'));
  assert.throws(
    () => preparePlan({ projectRoot: symbolic.root, feature: 'retention-workflow' }),
    (error) => error.code === 'E_OPERATING_ORIGIN_INVALID',
  );
});

test('story and task sidecars cannot override the one parent SPEC origin', () => {
  const { root, specDir, origin } = fixture();
  const forged = { ...origin, correlationId: 'corr-forged' };
  writeFileSync(join(specDir, 'stories/operating-origin.json'), JSON.stringify(forged));
  writeFileSync(join(specDir, 'tasks/operating-origin.json'), JSON.stringify(forged));
  const planned = preparePlan({ projectRoot: root, feature: 'retention-workflow' });
  assert.equal(planned.operatingOrigin.correlationId, origin.correlationId);
});
