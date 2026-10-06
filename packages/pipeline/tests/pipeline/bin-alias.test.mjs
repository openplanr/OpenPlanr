import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin');
const run = (file, args) =>
  spawnSync(process.execPath, [join(bin, file), ...args], { encoding: 'utf8' });

test('planr-pipeline prints one notice and otherwise behaves like openplanr-pipeline', () => {
  for (const args of [['help'], ['__unknown__']]) {
    const current = run('openplanr-pipeline.mjs', args);
    const alias = run('planr-pipeline.mjs', args);
    assert.equal(alias.status, current.status, args.join(' '));
    assert.equal(alias.stdout, current.stdout, args.join(' '));
    assert.equal(
      alias.stderr,
      'planr-pipeline is now openplanr-pipeline. The planr-pipeline command will be removed in the next release.\n' +
        current.stderr,
      args.join(' '),
    );
  }
});
