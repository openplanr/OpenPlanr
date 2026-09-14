import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  SourceMapBuilder,
  compileComposedV1,
  compileMarkdownV1,
  loadComposedSkill,
  owner,
  sha256Bytes,
  validateSourceMap,
} from '../../packages/skill-runtime/src/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const example = join(root, 'examples', 'skills', 'minimal-composed');
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/gu, '\n');

function assertFrozenRange(range) {
  assert.equal(Object.isFrozen(range), true, 'range object must be frozen');
  assert.equal(Object.isFrozen(range.owner), true, 'range.owner must be frozen');
  // Object.isFrozen alone does not prove a write throws; ESM strict semantics do.
  assert.throws(() => { range.startByte = 999; }, TypeError);
  assert.throws(() => { range.owner.ownerKind = 'tampered'; }, TypeError);
}

test('SourceMapBuilder.build returns a frozen array of frozen ranges independent of the builder', () => {
  const builder = new SourceMapBuilder();
  builder.append('alpha', owner('template', 'a.md', '1.0.0', `sha256:${'0'.repeat(64)}`));
  builder.append('beta', owner('source', 'b.md', '1.0.0', `sha256:${'1'.repeat(64)}`));
  const first = builder.build();
  assert.equal(Object.isFrozen(first), true);
  for (const range of first) assertFrozenRange(range);

  // A later append() after build() must not mutate the previously returned map.
  const lengthBefore = first.length;
  builder.append('gamma', owner('template', 'a.md', '1.0.0', `sha256:${'0'.repeat(64)}`));
  const second = builder.build();
  assert.equal(first.length, lengthBefore);
  assert.notEqual(first, second);
  assert.equal(second.length, lengthBefore + 1);
});

test('SourceMapBuilder clones caller-owned owner data before retaining it', () => {
  const supplied = {
    ownerKind: 'source',
    pointer: 'mutable.md',
    version: '1.0.0',
    digest: `sha256:${'2'.repeat(64)}`,
    nested: { mutable: true },
  };
  const builder = new SourceMapBuilder();
  builder.append('owned', supplied);
  supplied.pointer = 'forged.md';
  supplied.nested.mutable = false;
  const map = builder.build();
  assert.equal(map[0].owner.pointer, 'mutable.md');
  assert.equal(Object.hasOwn(map[0].owner, 'nested'), false);
  assertFrozenRange(map[0]);
});

test('compileComposedV1 returns genuinely frozen source-map ranges and owners', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const result = compileComposedV1({ skillSource, skillSourceCustody, modules, hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'), readSource });
  assert.equal(Object.isFrozen(result.primary.sourceMap), true);
  assert.equal(Object.isFrozen(result.references), true);
  for (const range of result.primary.sourceMap) assertFrozenRange(range);
  for (const reference of result.references) {
    assert.equal(Object.isFrozen(reference.sourceMap), true);
    for (const range of reference.sourceMap) assertFrozenRange(range);
  }
});

test('markdown-v1 host tokens are attributed to the compiler, not a host-profile', () => {
  const legacyMarkdown = `---\nname: planr-legacy-map\ndescription: Legacy compiler source-map fixture.\n---\n\nInvoke {{WORKFLOW_PREFIX}}ship.\n`;
  const compiled = compileMarkdownV1({
    skillId: 'planr-legacy-map',
    canonicalBytes: legacyMarkdown,
    host: 'claude-code',
    supportPaths: [],
    readSource: read,
    sourcePath: 'fixtures/legacy/planr-legacy-map/SKILL.md',
  });
  const kinds = new Set(compiled.sourceMap.map((range) => range.owner.ownerKind));
  assert.equal(kinds.has('compiler'), true, 'HOST_SUBSTITUTIONS-derived bytes must be ownerKind compiler');
  assert.equal(kinds.has('host-profile'), false, 'markdown-v1 has no authored host-profile document');
  const compilerOwned = compiled.sourceMap.find((range) => range.owner.ownerKind === 'compiler');
  assert.match(compilerOwned.owner.pointer, /render-primitives\.mjs#\/HOST_SUBSTITUTIONS\//u);
});

test('markdown-v1 include sources and CRLF transforms retain exact owners on every host', () => {
  const canonical = '---\r\nname: planr-map\r\ndescription: Include source-map fixture.\r\nallowed-tools: "Read"\r\n---\r\n\r\n<!-- openplanr:include:start references/context.md -->\r\nold\r\n<!-- openplanr:include:end -->\r\n';
  const included = '# Included context\r\n\r\nRead the exact source.\r\n';
  const cursorTemplate = read('packages/skill-runtime/templates/cursor-rule.md');
  for (const host of ['claude-code', 'codex', 'cursor', 'pipeline']) {
    const compiled = compileMarkdownV1({
      skillId: 'planr-map',
      canonicalBytes: canonical,
      host,
      cursorTemplate,
      supportPaths: [],
      readSource: (path) => {
        assert.equal(path, 'references/context.md');
        return included;
      },
      sourcePath: 'skills/planr-map/SKILL.md',
    });
    assert.equal(compiled.bytes.includes('\r'), false, host);
    assert.doesNotThrow(() => validateSourceMap(compiled.sourceMap, compiled.byteLength), host);
    assert.ok(compiled.sourceMap.some((range) => range.owner.pointer === 'references/context.md'), `${host} include source`);
    assert.ok(compiled.sourceMap.some((range) => range.owner.pointer.includes('crlf-to-lf')), `${host} LF transform`);
    assert.ok(compiled.sourceMap.some((range) => range.owner.pointer.includes('INCLUDE_COMMENT')), `${host} include comment`);
  }
});

test('composed-v1 hardcoded host substitutions report compiler ownership', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const result = compileComposedV1({ skillSource, skillSourceCustody, modules, hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'), readSource });
  const kinds = new Set(result.primary.sourceMap.map((range) => range.owner.ownerKind));
  assert.equal(kinds.has('host-profile'), false);
  assert.equal(kinds.has('compiler'), true);
  const compilerOwned = result.primary.sourceMap.find((range) => range.owner.pointer.includes('HOST_SUBSTITUTIONS'));
  assert.ok(compilerOwned);
});

test('composed skill identity bytes point to the exact authored skill.json bytes', () => {
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const result = compileComposedV1({
    skillSource,
    skillSourceCustody,
    modules,
    hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'),
    readSource,
  });
  const identityRange = result.primary.sourceMap.find((range) => range.owner.pointer === 'skill.json#/skillId');
  assert.ok(identityRange, 'rendered skill id must retain its authored source owner');
  assert.equal(identityRange.owner.digest, skillSourceCustody.digest);
  assert.equal(identityRange.owner.digest, sha256Bytes(readFileSync(join(example, 'skill.json'), 'utf8')));
  assert.notEqual(identityRange.owner.digest, skillSource.documentDigest, 'authored bytes and canonical Protocol document are distinct custody domains');
});
