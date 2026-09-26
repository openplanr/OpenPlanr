import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  SkillRuntimeError,
  compileComposedV1,
  loadComposedSkill,
  resolveModuleGraph,
  sha256Bytes,
} from '../../packages/skill-runtime/src/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const example = join(root, 'examples', 'skills', 'minimal-composed');

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: 'Expected function to throw.' });
}

function tempSkill() {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-custody-'));
  const target = join(dir, 'skill');
  cpSync(example, target, { recursive: true });
  return target;
}

const byteHash = (buffer) => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;

test('custody hashes exact on-disk bytes, including CRLF, never an LF-normalized copy', () => {
  const dir = tempSkill();
  try {
    const modulePath = join(dir, 'modules', 'hello-intro.md');
    const lf = readFileSync(modulePath, 'utf8').replace(/\r\n/gu, '\n');
    const crlf = lf.replace(/\n/gu, '\r\n');
    writeFileSync(modulePath, crlf);

    const rawBytes = readFileSync(modulePath);
    assert.ok(rawBytes.includes(0x0d), 'the fixture must actually contain CR bytes');
    const byteExactDigest = byteHash(rawBytes);
    const lfDigest = byteHash(Buffer.from(lf, 'utf8'));
    // Non-vacuous: the two digests genuinely differ, so a normalized hash could
    // not accidentally satisfy the byte-exact assertion below.
    assert.notEqual(byteExactDigest, lfDigest);

    const { modules } = loadComposedSkill({ skillDir: dir });
    const helloIntro = modules.find((module) => module.moduleId === 'hello-intro');
    assert.equal(helloIntro.source.digest, byteExactDigest);
    assert.equal(sha256Bytes(crlf), byteExactDigest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tampered source bytes fail compilation with a stale-digest diagnostic', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } =
    loadComposedSkill({ skillDir: example });
  const hostProfile = hostProfilesByKey.get('minimal-claude-code@1.0.0');
  assert.doesNotThrow(() =>
    compileComposedV1({ skillSource, skillSourceCustody, modules, hostProfile, readSource }),
  );

  const tamperingReadSource = (path) =>
    path.endsWith('hello-intro.md') ? `${readSource(path)}\nInjected line.\n` : readSource(path);
  const error = caught(() =>
    compileComposedV1({
      skillSource,
      skillSourceCustody,
      modules,
      hostProfile,
      readSource: tamperingReadSource,
    }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_SOURCE_DIGEST_STALE');
  assert.equal(error.details.path, 'modules/hello-intro.md');
  assert.notEqual(error.details.expected, error.details.actual);
});

test('a substituted readSource at render time is caught after custody is established (TOCTOU)', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } =
    loadComposedSkill({ skillDir: example });
  const hostProfile = hostProfilesByKey.get('minimal-claude-code@1.0.0');
  // Custody is established once (legitimate digests), then a different readSource
  // returns substituted bytes for the same template path at render time.
  const substituteTemplate = (path) =>
    path === skillSource.template.path
      ? `${readSource(path)}\nUnowned trailer.\n`
      : readSource(path);
  const error = caught(() =>
    compileComposedV1({
      skillSource,
      skillSourceCustody,
      modules,
      hostProfile,
      readSource: substituteTemplate,
    }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_SOURCE_DIGEST_STALE');
  assert.equal(error.details.path, skillSource.template.path);
});

test('a supported but unselected host profile is rejected before any source read', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } =
    loadComposedSkill({ skillDir: example });
  const forged = {
    ...hostProfilesByKey.get('minimal-claude-code@1.0.0'),
    hostProfileId: 'forged-codex',
    host: 'codex',
  };
  let reads = 0;
  const error = caught(() =>
    compileComposedV1({
      skillSource,
      skillSourceCustody,
      modules,
      hostProfile: forged,
      readSource: (path) => {
        reads += 1;
        return readSource(path);
      },
    }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_HOST_PROFILE_UNDECLARED');
  assert.equal(reads, 0);
});

test('the selected host-profile source is verified even though its prose is not emitted', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } =
    loadComposedSkill({ skillDir: example });
  const hostProfile = hostProfilesByKey.get('minimal-claude-code@1.0.0');
  const error = caught(() =>
    compileComposedV1({
      skillSource,
      skillSourceCustody,
      modules,
      hostProfile,
      readSource: (path) =>
        path === hostProfile.source.path ? `${readSource(path)}\nTampered.\n` : readSource(path),
    }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_SOURCE_DIGEST_STALE');
  assert.equal(error.details.path, hostProfile.source.path);
});

test('a tampered routed source fails even though it is outside the primary body', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } =
    loadComposedSkill({ skillDir: example });
  const routed = modules.find((module) => module.moduleId === 'hello-reference');
  const error = caught(() =>
    compileComposedV1({
      skillSource,
      skillSourceCustody,
      modules,
      hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'),
      readSource: (path) =>
        path === routed.source.path
          ? `${readSource(path)}\nTampered routed source.\n`
          : readSource(path),
    }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_SOURCE_DIGEST_STALE');
  assert.equal(error.details.path, routed.source.path);
});

test('compilation snapshots every selected source exactly once', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } =
    loadComposedSkill({ skillDir: example });
  const counts = new Map();
  const countedRead = (path) => {
    counts.set(path, (counts.get(path) ?? 0) + 1);
    return readSource(path);
  };
  compileComposedV1({
    skillSource,
    skillSourceCustody,
    modules,
    hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'),
    readSource: countedRead,
  });
  assert.ok([...counts.values()].every((count) => count === 1));
  assert.deepEqual([...counts.keys()].sort(), [
    'SKILL.md.tmpl',
    'modules/hello-intro.md',
    'modules/hello-reference.md',
    'profiles/claude-code.md',
    'skill.json',
  ]);
});

test('graph resolution enforces standards-compliant exact SemVer at the module edge', () => {
  const { skillSource, modules } = loadComposedSkill({ skillDir: example });
  assert.doesNotThrow(() => resolveModuleGraph({ skillSource, modules }));
  for (const malformed of ['1.0.0-alpha..1', '01.0.0', '1.0.0-', '1.0.0+', '1.0.0-01']) {
    const floated = {
      ...skillSource,
      modules: [
        { moduleId: 'hello-intro', moduleVersion: malformed, digest: `sha256:${'a'.repeat(64)}` },
      ],
    };
    const error = caught(() => resolveModuleGraph({ skillSource: floated, modules }));
    assert.ok(error instanceof SkillRuntimeError, malformed);
    assert.equal(error.code, 'E_SKILL_MODULE_VERSION_FLOATING', malformed);
  }
});
