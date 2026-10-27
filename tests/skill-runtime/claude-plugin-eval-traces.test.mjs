import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { claudeEvalArgs, collectRunTraces } from '../../scripts/skills/evaluate-claude-plugin.mjs';

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-eval-traces-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function trace(root, name, content) {
  const path = join(root, 'sandbox', name, 'out', 'trace.jsonl');
  mkdirSync(dirname(path), { recursive: true });
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
  const report = collectRunTraces({ result, outputDir, tempRoots: [join(root, 'sandbox')] });
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.kept, []);
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
  const report = collectRunTraces({ result, outputDir: join(root, 'out'), tempRoots: [root] });
  assert.deepEqual(report.copied, []);
  assert.deepEqual(
    report.missing.map(({ run }) => run),
    ['ship-versus-land/with-1', 'ship-versus-land/with-2'],
  );
  assert.match(report.missing[0].reason, /does not exist/u);
  assert.match(report.missing[1].reason, /no tracePath/u);
});

test('a copied run sandbox is removed only when it sits directly in a temporary root', (t) => {
  const root = scratch(t);
  const removable = trace(root, 'a', 'with-1\n');
  const sandbox = dirname(dirname(removable));
  mkdirSync(join(sandbox, 'sealed', 'inner'), { recursive: true });
  chmodSync(join(sandbox, 'sealed'), 0o000);
  chmodSync(sandbox, 0o500);
  const outside = join(root, 'elsewhere', 'deep', 'b', 'out', 'trace.jsonl');
  mkdirSync(dirname(outside), { recursive: true });
  writeFileSync(outside, 'with-2\n');
  const result = {
    cases: [
      { name: 'spec-vague', arms: { with: [{ tracePath: removable }, { tracePath: outside }] } },
    ],
  };
  const report = collectRunTraces({
    result,
    outputDir: join(root, 'results'),
    tempRoots: [join(root, 'sandbox'), join(root, 'elsewhere')],
  });
  assert.equal(report.copied.length, 2);
  assert.equal(existsSync(sandbox), false);
  assert.equal(existsSync(outside), true);
  assert.deepEqual(
    report.kept.map(({ run }) => run),
    ['spec-vague/with-2'],
  );
  assert.match(report.kept[0].reason, /is not directly inside/u);
});

test('a trace outside a sandbox out/ folder keeps its directory, even directly in a temp root', (t) => {
  const root = scratch(t);
  const tracePath = join(root, 'sandbox', 'a', 'trace.jsonl');
  mkdirSync(dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, 'with-1\n');
  const report = collectRunTraces({
    result: { cases: [{ name: 'spec-vague', arms: { with: [{ tracePath }] } }] },
    outputDir: join(root, 'results'),
    tempRoots: [root],
  });
  assert.equal(report.copied.length, 1);
  assert.equal(existsSync(tracePath), true);
  assert.match(report.kept[0].reason, /not in a sandbox out\/ folder/u);
});

test('each eval call runs one tagged group with no baseline arm and grants only its tools', () => {
  const args = (grants) =>
    claudeEvalArgs({ outputDir: 'out', tag: 'grant-edit-write', grants, maxCostUsd: 7.5 });
  const writer = args(['Edit', 'Write']);
  assert.deepEqual(writer.slice(writer.indexOf('--ablation'), writer.indexOf('--ablation') + 2), [
    '--ablation',
    'none',
  ]);
  assert.deepEqual(writer.slice(writer.indexOf('--tag'), writer.indexOf('--tag') + 4), [
    '--tag',
    'grant-edit-write',
    '--allow-tools',
    'Edit',
  ]);
  assert.equal(writer[writer.indexOf('--max-cost-usd') + 1], '7.50');
  assert.ok(!args([]).includes('--allow-tools'));
});
