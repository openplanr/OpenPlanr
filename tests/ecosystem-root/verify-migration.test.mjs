import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classify,
  compareDeclarations,
  compareJavaScript,
  compareTokens,
  compareTrees,
  listSkillBundles,
} from '../../scripts/typescript/verify-migration.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = createRequire(resolve(root, 'packages/artifact/package.json'))('esbuild');

// The shape that renames a bundle local: a block-scoped `check3` beside a top-level `check`.
const bundle = [
  '(() => {',
  '  function check(value) {',
  '    return { ok: value > 0 };',
  '  }',
  '  function createDraft(template, input) {',
  '    if (template) {',
  '      const check3 = check(template.size);',
  '      if (!check3.ok) return check3;',
  '    }',
  '    const scale = 2;',
  '    const offset = 1;',
  '    return Math.max(input * scale, offset);',
  '  }',
  '  globalThis.createDraft = createDraft;',
  '})();',
  '',
].join('\n');
const renamed = bundle.replaceAll('check3', 'check22');
const tierOf = (before, after, options) => compareJavaScript(before, after, esbuild, options);

test('bundle tiers name byte-identical and comment-only pairs', () => {
  assert.deepEqual(tierOf(bundle, bundle), { tier: 'byte-identical' });
  const commented = bundle.replace('    const scale', '    // doubled\n    const scale');
  assert.deepEqual(tierOf(bundle, commented), { tier: 'comment-only' });
});

test('a renamed function-local passes as identifier-normalized and names the rename', () => {
  assert.deepEqual(tierOf(bundle, renamed), {
    tier: 'identifier-normalized',
    renamed: [['check3', 'check22']],
  });
});

test('identifier normalization still fails a changed operator, property or statement order', () => {
  const changes = {
    operator: renamed.replace('input * scale', 'input + scale'),
    property: renamed.replace('check22.ok', 'check22.valid'),
    order: renamed.replace(
      '    const scale = 2;\n    const offset = 1;',
      '    const offset = 1;\n    const scale = 2;',
    ),
  };
  for (const [change, after] of Object.entries(changes)) {
    const result = tierOf(bundle, after);
    assert.equal(result.tier, 'different', change);
    assert.equal(typeof result.firstDifference.token, 'number', change);
  }
  assert.match(tierOf(bundle, changes.operator).firstDifference.after, /input#\d+ \+ scale/u);
});

test('identifier normalization fails a renamed export or script global', () => {
  const esm = { format: 'esm' };
  const inline = 'export function createDraft(size) {\n  return size * 2;\n}\n';
  assert.equal(tierOf(inline, inline.replace('createDraft', 'makeDraft'), esm).tier, 'different');
  assert.equal(
    tierOf(inline, inline.replaceAll('size', 'width'), esm).tier,
    'identifier-normalized',
  );
  const aliased =
    'function draft(size) {\n  return size * 2;\n}\nexport { draft as createDraft };\n';
  assert.equal(
    tierOf(aliased, aliased.replace('as createDraft', 'as makeDraft'), esm).tier,
    'different',
  );
  const global = 'var OpenPlanrDraft = (() => {\n  const size = 2;\n  return size;\n})();\n';
  assert.equal(tierOf(global, global.replace('OpenPlanrDraft', 'OpenPlanrPlan')).tier, 'different');
  assert.equal(tierOf(global, global.replaceAll('size', 'width')).tier, 'identifier-normalized');
});

test('skill migration coverage includes declared scripts, suite launchers and shared runtime chunks', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-skill-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = (path, text) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  put(
    'skills/planr-plan/openplanr.skill.json',
    JSON.stringify({
      resources: [
        { path: 'scripts/handoff.mjs', kind: 'script' },
        { path: 'scripts/runtime/studio.js.part-001', kind: 'asset' },
        { path: 'references/craft.md', kind: 'reference' },
      ],
    }),
  );
  const expected = [
    'dist/plugins/claude/openplanr/runtime/shared-chunk.mjs',
    'dist/plugins/claude/openplanr/skills/plan/scripts/handoff.mjs',
    'packages/cli/lib/host-packages/openai/openplanr/runtime/shared-chunk.mjs',
    'skills/planr-plan/scripts/handoff.mjs',
    'skills/planr-plan/scripts/runtime/studio.js.part-001',
  ];
  for (const path of expected) put(path, 'export const value = 1;\n');
  put('skills/planr-plan/references/craft.md', '# Guidance\n');
  assert.deepEqual(listSkillBundles(directory), expected);
});

test('skill and shared-chunk comparisons retain tiers and flag top-level binding changes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-skill-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const baseTree = join(directory, 'base');
  const headTree = join(directory, 'head');
  for (const tree of [baseTree, headTree]) mkdirSync(tree);
  // This is a comparison-tool fixture, not an installed skill; both trees use the tested tool.
  symlinkSync(join(root, 'node_modules'), join(headTree, 'node_modules'));
  const put = (tree, path, text) => {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  };
  const paths = [
    'dist/plugins/claude/openplanr/skills/plan/scripts/handoff.mjs',
    'dist/plugins/claude/openplanr/runtime/local-chunk.mjs',
    'dist/plugins/claude/openplanr/runtime/top-level-chunk.mjs',
  ];
  for (const path of paths) put(baseTree, path, bundle);
  put(headTree, paths[0], bundle.replace('    const scale', '    // unchanged\n    const scale'));
  put(headTree, paths[1], renamed);
  const topLevel = 'const provider = 1; export { provider as value };\n';
  put(baseTree, paths[2], topLevel);
  put(headTree, paths[2], topLevel.replaceAll('provider', 'client'));
  const result = compareTrees(headTree, baseTree);
  assert.equal(result.skillBundles.length, 3);
  const statuses = new Map(result.skillBundles.map(({ path, status }) => [path, status]));
  assert.equal(statuses.get(paths[0]), 'comment-only');
  assert.equal(statuses.get(paths[1]), 'identifier-normalized');
  assert.equal(statuses.get(paths[2]), 'different');
  assert.ok(result.skillBundles.find(({ path }) => path === paths[2]).firstDifference);
});

test('skill migration collection rejects traversal instead of comparing unrelated files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-skill-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const skill = join(directory, 'skills/planr-plan');
  mkdirSync(skill, { recursive: true });
  writeFileSync(
    join(skill, 'openplanr.skill.json'),
    JSON.stringify({ resources: [{ path: '../outside.mjs', kind: 'script' }] }),
  );
  assert.throws(() => listSkillBundles(directory), /Unsafe skill resource/u);
});

test('identifier normalization fails a reference that resolves to another binding', () => {
  const changes = {
    swapped: renamed.replace('input * scale', 'scale * input'),
    rebound: renamed.replace('input * scale', 'template * scale'),
    captured: renamed.replaceAll('offset', 'Math'),
  };
  for (const [change, after] of Object.entries(changes))
    assert.equal(tierOf(bundle, after).tier, 'different', change);
});

test('a renamed local used as a shorthand property changes the key and fails', () => {
  const shorthand = bundle.replace('return check3;', 'return { check3 };');
  assert.equal(tierOf(shorthand, shorthand.replaceAll('check3', 'check22')).tier, 'different');
});

test('destructuring keeps the property keys it reads and renames only its bindings', () => {
  const destructured = bundle.replace(
    '    const scale = 2;',
    '    const { size: scale, ...rest } = template;\n    const { offset: gap } = rest;',
  );
  assert.deepEqual(
    tierOf(destructured, destructured.replaceAll('rest', 'others').replaceAll('gap', 'spacing')),
    {
      tier: 'identifier-normalized',
      renamed: [
        ['rest', 'others'],
        ['gap', 'spacing'],
      ],
    },
  );
  const shorthand = destructured.replace('size: scale', 'scale');
  assert.equal(tierOf(shorthand, shorthand.replaceAll('scale', 'factor')).tier, 'different');
});

test('identifier normalization does not apply where with or eval makes scope dynamic', () => {
  const dynamic = bundle.replace('const scale = 2;', 'const scale = eval("2");');
  const result = tierOf(dynamic, dynamic.replaceAll('check3', 'check22'));
  assert.equal(result.tier, 'different');
  assert.match(result.reason, /with or a direct eval/u);
});

test('a projected declaration absent at the base is new only for a migrated source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-verify-migration-'));
  try {
    const baseTree = join(directory, 'base');
    const headTree = join(directory, 'head');
    const path = 'packages/pipeline/lib/artifact/ui/panel.d.mts';
    mkdirSync(dirname(join(headTree, path)), { recursive: true });
    mkdirSync(baseTree);
    writeFileSync(join(headTree, path), 'export declare const panel: number;\n');
    const statusOf = (isNewDeclaration) =>
      classify({ root: headTree, baseTree, path, isMigratedDeclaration: false, isNewDeclaration })
        .status;
    assert.equal(statusOf(true), 'new declaration');
    assert.equal(statusOf(false), 'added');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('token identity ignores comments and layout and fails on one changed token', () => {
  const before = 'export function area(w, h) {\n  // width times height\n  return w * h;\n}\n';
  const relaid = '// generated\nexport function area(w, h) { return w * h; }\n';
  assert.equal(compareTokens(before, relaid, esbuild).identical, true);
  const changed = compareTokens(before, 'export function area(w, h) { return w + h; }\n', esbuild);
  assert.equal(changed.identical, false);
  assert.ok(changed.firstDifference.offset > 0);
  assert.match(changed.firstDifference.after, /\+/u);
});

test('ESM normalization ignores where a module places its export keywords', () => {
  const inline = 'export function area(w, h) {\n  return w * h;\n}\n';
  const gathered = 'function area(w, h) {\n  return w * h;\n}\nexport {\n  area\n};\n';
  assert.equal(compareTokens(inline, gathered, esbuild).identical, false);
  assert.equal(compareTokens(inline, gathered, esbuild, { format: 'esm' }).identical, true);
});

const handWritten = [
  'export interface Camera {',
  '  x: number;',
  '  y: number;',
  '  scale: number;',
  '}',
  'export type Hit = { id: string; distance: number };',
  'export declare const LIMIT: number;',
  'export declare function query(camera: Camera, tolerance?: number): Hit[] | null;',
  '',
].join('\n');

function withGenerated(text, run) {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-verify-migration-'));
  try {
    const generatedPath = join(directory, 'index.d.mts');
    writeFileSync(generatedPath, text);
    return run(generatedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a generated declaration that differs only in layout and comments is equivalent', () => {
  const generated = `// generated\n${handWritten.replace('export interface Camera {', '/** The viewport. */\nexport interface Camera {')}`;
  withGenerated(generated, (generatedPath) => {
    const result = compareDeclarations({ root, generatedPath, baseText: handWritten });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(
      result.exports.map(({ name, kind }) => [name, kind]),
      [
        ['Camera', 'type'],
        ['Hit', 'type'],
        ['LIMIT', 'value'],
        ['query', 'value'],
      ],
    );
    assert.equal(result.assertions, 8);
  });
});

test('one changed token in an exported type fails identity and assignability', () => {
  withGenerated(handWritten.replace('scale: number', 'scale: string'), (generatedPath) => {
    const result = compareDeclarations({ root, generatedPath, baseText: handWritten });
    // Camera itself and query, whose parameter is a Camera, fail both relations each.
    assert.deepEqual(result.failures, [
      'type Camera is not mutually assignable between the hand-written and generated declarations',
      'type Camera is not identical between the hand-written and generated declarations',
      'value query is not mutually assignable between the hand-written and generated declarations',
      'value query is not identical between the hand-written and generated declarations',
    ]);
  });
});

test('a missing export and a changed export kind are reported by name', () => {
  const generated = handWritten
    .replace('export declare const LIMIT: number;\n', '')
    .replace('export type Hit =', 'export declare const Hit:');
  withGenerated(generated, (generatedPath) => {
    const result = compareDeclarations({ root, generatedPath, baseText: handWritten });
    assert.ok(result.failures.some((failure) => /omits LIMIT \(value\)/u.test(failure)));
    assert.ok(
      result.failures.some((failure) =>
        /Hit is a type in the hand-written declaration but a value in the generated one/u.test(
          failure,
        ),
      ),
    );
  });
});
