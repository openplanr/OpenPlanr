import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  resolveLocalFilesystemEvidenceV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

function write(root, path, bytes = 'private bytes\n') {
  const target = join(root, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, 'utf8');
}

function resolve(root, path) {
  const valid = fixture('evidence-filesystem-valid.json');
  const provider = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers.find(
    ({ providerId }) => providerId === 'local-filesystem-evidence-provider',
  );
  const resolver = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.find(
    ({ resolverId }) => resolverId === 'local-filesystem-evidence-resolver',
  );
  return resolveLocalFilesystemEvidenceV2(
    {
      ...valid.candidate,
      locator: { ...valid.candidate.locator, path },
    },
    {
      provider,
      resolver,
      capabilities: ['evidence.filesystem.read'],
      filesystemRoots: [
        {
          ...valid.sourceRoot,
          rootPath: root,
          sourceContract: { id: 'repository-architecture', version: '1.0.0' },
        },
      ],
    },
  );
}

test('screened repository research refuses private runtime, VCS, dependency, and secret paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'operate-repository-privacy-'));
  try {
    const forbidden = [
      ['.git/config', 'SENSITIVITY_BLOCKED'],
      ['.planr/operate/state/runtime.json', 'SENSITIVITY_BLOCKED'],
      ['.planr/operate/packets/pkt_private/input.json', 'SENSITIVITY_BLOCKED'],
      ['.planr/operate/archive/2026-08-21/events.jsonl', 'SENSITIVITY_BLOCKED'],
      ['.planr/operate-v2/state/runtime.json', 'SENSITIVITY_BLOCKED'],
      ['.planr/operate-legacy/state/runtime.json', 'SENSITIVITY_BLOCKED'],
      ['node_modules/private-package/index.js', 'SENSITIVITY_BLOCKED'],
      ['.env.local', 'SECRET_DETECTED'],
      ['config/credentials.json', 'SECRET_DETECTED'],
      ['keys/service-account.pem', 'SECRET_DETECTED'],
    ];
    for (const [path, code] of forbidden) {
      write(root, path);
      const result = resolve(root, path);
      assert.equal(result.status, 'rejected', path);
      assert.equal(result.error.code, code, path);
      assert.equal(JSON.stringify(result).includes('private bytes'), false, path);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('screened repository research detects common token formats while public planning files remain readable', () => {
  const root = mkdtempSync(join(tmpdir(), 'operate-repository-privacy-'));
  try {
    write(
      root,
      '.planr/specs/SPEC-024-operate-hardening/overview.md',
      '# Public planning context\n',
    );
    const planning = resolve(root, '.planr/specs/SPEC-024-operate-hardening/overview.md');
    assert.equal(planning.status, 'resolved');
    assert.equal(
      Buffer.from(planning.capture.contentBase64, 'base64').toString('utf8'),
      '# Public planning context\n',
    );

    for (const [path, bytes] of [
      ['notes/aws.txt', `temporary ASIA${'A'.repeat(16)} credential\n`],
      ['notes/google.txt', `temporary AIza${'A'.repeat(35)} credential\n`],
      ['notes/npm.txt', `temporary npm_${'a'.repeat(36)} credential\n`],
      ['notes/slack.txt', `temporary xoxb-${'a'.repeat(20)} credential\n`],
      ['notes/stripe.txt', `temporary sk_live_${'a'.repeat(24)} credential\n`],
    ]) {
      write(root, path, bytes);
      const result = resolve(root, path);
      assert.equal(result.status, 'rejected', path);
      assert.equal(result.error.code, 'SECRET_DETECTED', path);
      assert.equal(JSON.stringify(result).includes(bytes.trim()), false, path);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
