import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  SkillRuntimeError,
  assertPortableAsset,
  assertSafeSourcePath,
  checkSkill,
  compileComposedV1,
  composeIncludes,
  evaluateSkill,
  loadComposedSkill,
  sha256,
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

test('assertSafeSourcePath rejects absolute, drive, backslash, and traversal paths at the compiler boundary', () => {
  for (const bad of ['/etc/passwd', 'C:\\Windows\\system32', 'C:/Windows', 'C:secret.md', '\\\\server\\share', 'modules\\secret.md', 'a//b.md', 'a/./b.md']) {
    const error = caught(() => assertSafeSourcePath(bad));
    assert.ok(error instanceof SkillRuntimeError, bad);
    assert.equal(error.code, 'E_SKILL_SOURCE_PATH_INVALID', bad);
  }
  for (const escapedPath of ['../secrets.md', 'modules/../../outside.md', 'a/b/../../../c']) {
    const error = caught(() => assertSafeSourcePath(escapedPath));
    assert.ok(error instanceof SkillRuntimeError, escapedPath);
    assert.equal(error.code, 'E_SKILL_SOURCE_PATH_ESCAPE', escapedPath);
  }
  assert.equal(assertSafeSourcePath('modules/hello-intro.md'), 'modules/hello-intro.md');
});

test('the authoring loader rejects a source beneath a symlinked parent directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-symlink-parent-'));
  const target = join(dir, 'skill');
  const outside = join(dir, 'outside');
  cpSync(example, target, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'intro.md'), '# Escaped through parent symlink\n');
  symlinkSync(outside, join(target, 'linked-modules'), 'dir');
  try {
    const modulesPath = join(target, 'modules.json');
    const modules = JSON.parse(readFileSync(modulesPath, 'utf8'));
    modules.modules[0].source = 'linked-modules/intro.md';
    writeFileSync(modulesPath, `${JSON.stringify(modules, null, 2)}\n`);
    const error = caught(() => loadComposedSkill({ skillDir: target }));
    assert.equal(error.code, 'E_SKILL_SOURCE_SYMLINK');
    assert.equal(error.details.segment, 'linked-modules');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composeIncludes guards untrusted include-marker paths before any readSource call', () => {
  const readSource = () => 'should never be read\n';
  const withEscape = '---\nname: x\ndescription: y\n---\n\n<!-- openplanr:include:start ../evil.md -->\nx\n<!-- openplanr:include:end -->\n';
  const error = caught(() => composeIncludes(withEscape, { sourcePath: 'skills/x/SKILL.md', readSource }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_SOURCE_PATH_ESCAPE');
});

test('compileComposedV1 rejects an absolute template path handed to a permissive readSource', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const hostProfile = hostProfilesByKey.get('minimal-claude-code@1.0.0');
  const escaped = { ...skillSource, template: { path: '/etc/passwd', digest: skillSource.template.digest } };
  const error = caught(() => compileComposedV1({ skillSource: escaped, skillSourceCustody, modules, hostProfile, readSource }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_SOURCE_PATH_INVALID');
});

test('two routed references to the same moduleId at different versions fail with a collision diagnostic', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const hostProfile = hostProfilesByKey.get('minimal-claude-code@1.0.0');
  const reference = modules.find((module) => module.moduleId === 'hello-reference');
  const secondVersion = { ...reference, moduleVersion: '2.0.0' };
  const modulesWithTwo = [...modules, secondVersion];
  const collidingSkill = {
    ...skillSource,
    references: [
      { module: { moduleId: 'hello-reference', moduleVersion: '1.0.0', digest: reference.source.digest }, routed: true },
      { module: { moduleId: 'hello-reference', moduleVersion: '2.0.0', digest: reference.source.digest }, routed: true },
    ],
  };
  const error = caught(() => compileComposedV1({ skillSource: collidingSkill, skillSourceCustody, modules: modulesWithTwo, hostProfile, readSource }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_ROUTED_OUTPUT_COLLISION');
  assert.equal(error.details.path, 'references/hello-reference.md');
  assert.equal(error.details.first, 'hello-reference@1.0.0');
  assert.equal(error.details.second, 'hello-reference@2.0.0');
});

test('an incompatible host profile fails immediately with a clear diagnostic, not deep in rendering', () => {
  const { skillSource, skillSourceCustody, modules, readSource } = loadComposedSkill({ skillDir: example });
  const bogus = {
    hostProfileId: 'bogus', hostProfileVersion: '1.0.0', host: 'jetbrains',
    authorityCeiling: skillSource.authorityCeiling,
    source: { path: 'profiles/claude-code.md', digest: sha256('x') },
    overlayModules: [],
  };
  const error = caught(() => compileComposedV1({ skillSource, skillSourceCustody, modules, hostProfile: bogus, readSource }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_HOST_PROFILE_INCOMPATIBLE');
  assert.equal(error.details.host, 'jetbrains');
  assert.ok(error.details.supported.includes('claude-code'));
});

test('a non-portable composed-v1 asset is rejected by check and evaluate rather than silently passing', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  // Target codex, but a module body embeds a Claude plugin path the codex
  // projection must never carry.
  const codexProfile = {
    ...hostProfilesByKey.get('minimal-claude-code@1.0.0'),
    hostProfileId: 'minimal-codex', host: 'codex',
  };
  const nonPortable = '# Hello\n\nUse ${CLAUDE_PLUGIN_ROOT}/agents to begin.\n';
  const poisonedReadSource = (path) => (
    path.endsWith('hello-intro.md') ? nonPortable : readSource(path)
  );
  // Re-digest the poisoned module so custody does not reject it first; the point is
  // to prove portability catches a byte-valid but non-portable projection.
  const poisonedModules = modules.map((module) => (
    module.moduleId === 'hello-intro'
      ? { ...module, source: { path: module.source.path, digest: sha256(nonPortable) } }
      : module
  ));
  const poisonedSkill = {
    ...skillSource,
    hostProfiles: [{ id: 'minimal-codex', version: '1.0.0' }],
    modules: skillSource.modules.map((ref) => (
      ref.moduleId === 'hello-intro' ? { ...ref, digest: sha256(nonPortable) } : ref
    )),
  };
  const error = caught(() => compileComposedV1({ skillSource: poisonedSkill, skillSourceCustody, modules: poisonedModules, hostProfile: codexProfile, readSource: poisonedReadSource }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_GENERATED_ASSET_NOT_PORTABLE');
});

test('strict foreign-host checks apply to composed assets without changing markdown-v1 compatibility', () => {
  const { hostProfilesByKey } = loadComposedSkill({ skillDir: example });
  const authority = hostProfilesByKey.get('minimal-claude-code@1.0.0').authorityCeiling;
  const foreignCodex = 'Read .codex/stacks, then invoke $planr-secret.\n';
  // Frozen markdown-v1 may contain cross-host explanatory prose.
  assert.doesNotThrow(() => assertPortableAsset('skills/x/SKILL.md', foreignCodex, 'claude-code'));
  const error = caught(() => assertPortableAsset('skills/x/SKILL.md', foreignCodex, 'claude-code', authority));
  assert.equal(error.code, 'E_GENERATED_ASSET_NOT_PORTABLE');
  assert.match(error.details.violation, /Codex/u);

  const matrices = [
    ['codex', '.cursor/stacks/rules.md'],
    ['cursor', '${CLAUDE_PLUGIN_ROOT}/skills'],
    ['pipeline', '.codex/stacks/backend.md'],
  ];
  for (const [host, bytes] of matrices) {
    assert.equal(caught(() => assertPortableAsset('skills/x/SKILL.md', bytes, host, authority)).code, 'E_GENERATED_ASSET_NOT_PORTABLE');
  }
});

test('composed portability rejects undeclared tools, runtime operations, and implicit network access', () => {
  const { hostProfilesByKey } = loadComposedSkill({ skillDir: example });
  const authority = hostProfilesByKey.get('minimal-claude-code@1.0.0').authorityCeiling;
  assert.equal(
    caught(() => assertPortableAsset('skills/x/SKILL.md', 'Call Write(config.json) now.\n', 'claude-code', authority)).code,
    'E_GENERATED_ASSET_TOOL_UNDECLARED',
  );
  assert.equal(
    caught(() => assertPortableAsset('skills/x/SKILL.md', 'Run planr status --md.\n', 'claude-code', authority)).code,
    'E_GENERATED_ASSET_OPERATION_UNDECLARED',
  );
  const artifactAuthority = { ...authority, allowedOperations: ['artifact'] };
  assert.doesNotThrow(() => assertPortableAsset('skills/x/SKILL.md', 'Run planr artifact report.html.\n', 'claude-code', artifactAuthority));
  assert.equal(
    caught(() => assertPortableAsset('skills/x/SKILL.md', 'Run openplanr doctor --json.\n', 'claude-code', artifactAuthority)).code,
    'E_GENERATED_ASSET_OPERATION_UNDECLARED',
  );
  const shellAuthority = { ...authority, allowedTools: [...authority.allowedTools, 'shell'] };
  assert.equal(
    caught(() => assertPortableAsset('skills/x/SKILL.md', 'Run Bash(curl https://example.test).\n', 'claude-code', shellAuthority)).code,
    'E_GENERATED_ASSET_NETWORK_UNDECLARED',
  );
  const scopedShell = { ...authority, externalDataAccess: 'read-only', allowedTools: ['Bash(git:*)'] };
  assert.doesNotThrow(() => assertPortableAsset('skills/x/SKILL.md', 'Run Bash(git status).\n', 'claude-code', scopedShell));
  assert.equal(
    caught(() => assertPortableAsset('skills/x/SKILL.md', 'Run Bash(github status).\n', 'claude-code', scopedShell)).code,
    'E_GENERATED_ASSET_TOOL_UNDECLARED',
  );
});

test('a module cannot use authority available to the host but absent from its own ceiling', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const original = modules.find((module) => module.moduleId === 'hello-intro');
  const bytes = '# Hello\n\nCall Write(config.json).\n';
  const narrowedModules = modules.map((module) => (
    module.moduleId === original.moduleId
      ? { ...module, source: { ...module.source, digest: sha256(bytes) } }
      : module
  ));
  const selectedSkill = {
    ...skillSource,
    modules: skillSource.modules.map((reference) => (
      reference.moduleId === original.moduleId ? { ...reference, digest: sha256(bytes) } : reference
    )),
  };
  const hostProfile = {
    ...hostProfilesByKey.get('minimal-claude-code@1.0.0'),
    authorityCeiling: {
      ...hostProfilesByKey.get('minimal-claude-code@1.0.0').authorityCeiling,
      allowedTools: ['read', 'edit'],
    },
  };
  const error = caught(() => compileComposedV1({
    skillSource: selectedSkill,
    skillSourceCustody,
    modules: narrowedModules,
    hostProfile,
    readSource: (path) => (path === original.source.path ? bytes : readSource(path)),
  }));
  assert.equal(error.code, 'E_GENERATED_ASSET_TOOL_UNDECLARED');
  assert.match(error.details.path, /#module=hello-intro@1\.0\.0$/u);
});

test('checkSkill and evaluateSkill surface a portability violation as a failing diagnostic', () => {
  // Directly drive check/evaluate against a temp skill whose module renders a
  // foreign host plugin path. Loader recomputes digests from disk, so we only need
  // to write the non-portable bytes and target a non-claude host.
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-portability-'));
  const target = join(dir, 'skill');
  cpSync(example, target, { recursive: true });
  try {
    writeFileSync(join(target, 'modules', 'hello-intro.md'), '# Hello\n\nRun /planr-pipeline:hello via ${CLAUDE_PLUGIN_ROOT}.\n');
    writeFileSync(join(target, 'host-profiles.json'), JSON.stringify({
      profiles: [{
        hostProfileId: 'minimal-codex', hostProfileVersion: '1.0.0', host: 'codex',
        description: 'Codex overlay for the portability test.',
        source: 'profiles/claude-code.md', overlayModules: [],
        authorityCeiling: {
          repositoryAccess: 'read-only', externalDataAccess: 'none',
          allowedCapabilities: ['read'], allowedTools: ['read'],
          allowedOperations: ['render'], allowedOutputClasses: ['A'],
          forbiddenEffects: ['network-write', 'external-publish'],
        },
      }],
    }, null, 2));
    writeFileSync(join(target, 'skill.json'), JSON.stringify({
      skillId: 'planr-hello', skillVersion: '1.0.0', sourceFormat: 'composed-v1',
      template: 'SKILL.md.tmpl',
      authorityCeiling: {
        repositoryAccess: 'declared-paths', externalDataAccess: 'read-only',
        allowedCapabilities: ['read', 'write'], allowedTools: ['read', 'edit'],
        allowedOperations: ['compile', 'render'], allowedOutputClasses: ['A', 'B'],
        forbiddenEffects: ['network-write'],
      },
      modules: [{ moduleId: 'hello-intro', moduleVersion: '1.0.0' }],
      references: [{ moduleId: 'hello-reference', moduleVersion: '1.0.0' }],
      hostProfiles: [{ id: 'minimal-codex', version: '1.0.0' }],
    }, null, 2));

    const checked = checkSkill({ skillDir: target });
    assert.equal(checked.ok, false);
    assert.equal(checked.diagnostics[0].code, 'E_GENERATED_ASSET_NOT_PORTABLE');
    const evaluated = evaluateSkill({ skillDir: target });
    assert.equal(evaluated.ok, false);
    assert.equal(evaluated.diagnostics[0].code, 'E_GENERATED_ASSET_NOT_PORTABLE');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
