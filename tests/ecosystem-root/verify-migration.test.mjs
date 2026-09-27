import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareDeclarations, compareTokens } from '../../scripts/typescript/verify-migration.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = createRequire(resolve(root, 'packages/artifact/package.json'))('esbuild');

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
