import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectRunTraces } from '../../scripts/skills/evaluate-claude-plugin.mjs';

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-eval-traces-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function trace(root, name, content) {
  const path = join(root, 'sandbox', name, 'trace.jsonl');
  mkdirSync(join(root, 'sandbox', name), { recursive: true });
  writeFileSync(path, content);
  return path;
}

test('each run trace named in the result is copied under traces/<case>/<arm>-<n>.jsonl', (t) => {
  const root = scratch(t);
  const outputDir = join(root, 'out');
  const result = {
    cases: [
      {
        name: 'spec-vague',
        arms: {
          with: [
            { tracePath: trace(root, 'a', 'with-1\n') },
            { tracePath: trace(root, 'b', 'with-2\n') },
          ],
          without: [{ tracePath: trace(root, 'c', 'without-1\n') }],
        },
      },
    ],
  };
  const report = collectRunTraces({ result, outputDir });
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.copied, [
    'traces/spec-vague/with-1.jsonl',
    'traces/spec-vague/with-2.jsonl',
    'traces/spec-vague/without-1.jsonl',
  ]);
  assert.equal(readFileSync(join(outputDir, 'traces/spec-vague/with-2.jsonl'), 'utf8'), 'with-2\n');
  assert.equal(
    readFileSync(join(outputDir, 'traces/spec-vague/without-1.jsonl'), 'utf8'),
    'without-1\n',
  );
});

test('a run whose trace is absent or unnamed is reported, not skipped', (t) => {
  const root = scratch(t);
  const result = {
    cases: [
      {
        name: 'ship-versus-land',
        arms: {
          with: [{ tracePath: join(root, 'gone', 'trace.jsonl') }, { tracePath: null }],
        },
      },
    ],
  };
  const report = collectRunTraces({ result, outputDir: join(root, 'out') });
  assert.deepEqual(report.copied, []);
  assert.deepEqual(
    report.missing.map(({ run }) => run),
    ['ship-versus-land/with-1', 'ship-versus-land/with-2'],
  );
  assert.match(report.missing[0].reason, /does not exist/u);
  assert.match(report.missing[1].reason, /no tracePath/u);
});
