import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const failureExpectations = {
  failure: { status: /failed \(7\)/u, output: /synthetic prerequisite failed/u },
  signal: { status: /failed \(signal SIGTERM\)/u, output: /synthetic signalled host/u },
  timeout: { status: /300000ms limit.*ETIMEDOUT/su, output: /synthetic stalled host/u },
};
for (const mode of ['success', 'failure', 'signal', 'timeout']) {
  test(`model evaluator handles ${mode} without a paid model call`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'model-eval-process-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      const executable = join(bin, 'codex');
      writeFileSync(
        executable,
        `#!${process.execPath}\n` +
          `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.EVAL_ARGS, JSON.stringify(args));
if (process.env.EVAL_MODE === 'failure') { console.error('synthetic prerequisite failed'); process.exit(7); }
if (process.env.EVAL_MODE === 'signal') { console.error('synthetic signalled host'); process.kill(process.pid, 'SIGTERM'); setTimeout(() => process.exit(0), 10_000); }
else if (process.env.EVAL_MODE === 'timeout') { console.error('synthetic stalled host'); process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 10_000); }
else {
 const cases = JSON.parse(fs.readFileSync(process.env.EVAL_CORPUS, 'utf8')).cases;
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify({results: cases.map(c => ({id:c.id, skillId:c.expectedSkillId ?? null, reason:'fixture'}))}));
 console.log(JSON.stringify({usage:{input_tokens:1,output_tokens:1}}));
}
`,
      );
      chmodSync(executable, 0o755);
      const preload = join(dir, 'clock.cjs');
      // Records the production spawn options, then shortens the deadline so the stall stays fast.
      writeFileSync(
        preload,
        `
const fs = require('node:fs');
const child = require('node:child_process');
const original = child.spawnSync;
child.spawnSync = (command, args, options) => {
  if (command !== 'codex') return original(command, args, options);
  fs.writeFileSync(process.env.EVAL_OPTIONS, JSON.stringify({ timeout: options.timeout, killSignal: options.killSignal }));
  const timeout = process.env.EVAL_MODE === 'timeout' ? 1500 : options.timeout;
  return original(command, args, { ...options, timeout });
};
require('node:module').syncBuiltinESMExports();
`,
      );
      const optionsPath = join(dir, 'options.json');
      const output = join(dir, 'result.json');
      const argsPath = join(dir, 'args.json');
      const run = spawnSync(
        process.execPath,
        [
          '--require',
          preload,
          join(root, 'scripts/skills/evaluate-model-release.mjs'),
          '--output',
          output,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH}`,
            EVAL_MODE: mode,
            EVAL_ARGS: argsPath,
            EVAL_OPTIONS: optionsPath,
            EVAL_CORPUS: join(root, 'evaluation/skills/routing-corpus.json'),
          },
        },
      );
      assert.ifError(run.error);
      assert.deepEqual(JSON.parse(readFileSync(optionsPath, 'utf8')), {
        timeout: 300000,
        killSignal: 'SIGKILL',
      });
      const args = JSON.parse(readFileSync(argsPath, 'utf8'));
      assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
      if (mode === 'success') {
        assert.equal(run.status, 0, run.stderr);
        assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'pass');
      } else {
        assert.notEqual(run.status, 0);
        assert.match(run.stderr, failureExpectations[mode].status);
        assert.match(run.stderr, failureExpectations[mode].output);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
