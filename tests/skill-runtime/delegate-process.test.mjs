import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const adapter = new URL('../../skills/planr-delegate/scripts/adapters/generic.mjs', import.meta.url)
  .href;

for (const trigger of ['abort', 'exit']) {
  test(`termination denial is observed before delayed stream completion (${trigger})`, {
    skip: process.platform === 'win32',
  }, () => {
    const script = `
      import assert from 'node:assert/strict';
      import { invokeProcess, terminateProcessGroup } from ${JSON.stringify(adapter)};
      const trigger = ${JSON.stringify(trigger)};
      const controller = new AbortController();
      const originalKill = process.kill;
      const unhandled = [];
      process.on('unhandledRejection', (error) => unhandled.push(error.code));
      let identity;
      let releaseLine;
      const lineGate = new Promise((resolve) => { releaseLine = resolve; });
      process.kill = (pid, signal) => {
        if (pid < 0) {
          // Release stream processing on the next turn, after rejection observation.
          setImmediate(() => {
            if (trigger === 'abort') originalKill(identity.pid, 'SIGKILL');
            releaseLine();
          });
          throw Object.assign(new Error('fixture termination denial'), { code: 'EACCES' });
        }
        return originalKill(pid, signal);
      };
      try {
        const command = trigger === 'abort'
          ? "console.log('ready'); setTimeout(() => process.exit(0), 5000);"
          : "console.log('ready');";
        await assert.rejects(invokeProcess(process.execPath, ['-e', command], {
          signal: controller.signal,
          timeoutMs: 5000,
          onProcess: (value) => { identity = value; },
          onStdoutLine: async () => {
            if (trigger === 'abort') controller.abort();
            await lineGate;
          },
        }), (error) => {
          assert.equal(error.code, 'EACCES');
          assert.equal(error.processTerminationConfirmed, false);
          assert.deepEqual(error.ownedProcess, identity);
          return true;
        });
        assert.deepEqual(unhandled, []);
      } finally {
        process.kill = originalKill;
        if (identity) await terminateProcessGroup(identity);
      }
    `;
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ['--input-type=module', '-'], {
        input: script,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });
}
