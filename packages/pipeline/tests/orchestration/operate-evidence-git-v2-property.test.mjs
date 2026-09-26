import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  dispatchOperateEvidenceResolverV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('Git resolver never converts an invalid range or unrequested ancestry into another resolver outcome', () => {
  const root = mkdtempSync(join(tmpdir(), 'operate-evidence-git-property-'));
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes/evidence.txt'), 'one\ntwo\nthree\n', 'utf8');
    git(root, ['init', '--quiet']);
    git(root, ['add', '.']);
    git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    const revision = git(root, ['rev-parse', 'HEAD']);
    const valid = fixture('evidence-git-valid.json');
    for (let end = 4; end <= 128; end += 7) {
      const candidate = structuredClone(valid.candidate);
      candidate.locator.revision = revision;
      candidate.locator.lines = { start: 1, end };
      const result = dispatchOperateEvidenceResolverV2(
        OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
        candidate,
        {
          scope: valid.scope,
          capabilities: ['evidence.git.read'],
          gitRepositories: [
            {
              ...valid.repository,
              rootPath: root,
              sourceContract: { id: 'repository-architecture', version: '1.0.0' },
            },
          ],
        },
      );
      assert.equal(result.status, 'rejected');
      assert.equal(result.error.code, 'LINE_RANGE_INVALID', `line end ${end}`);
    }
    const noAncestry = structuredClone(valid.candidate);
    noAncestry.locator.revision = revision;
    delete noAncestry.locator.ancestry;
    assert.equal(
      dispatchOperateEvidenceResolverV2(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, noAncestry, {
        scope: valid.scope,
        capabilities: ['evidence.git.read'],
        gitRepositories: [
          {
            ...valid.repository,
            rootPath: root,
            sourceContract: { id: 'repository-architecture', version: '1.0.0' },
          },
        ],
      }).status,
      'resolved',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
