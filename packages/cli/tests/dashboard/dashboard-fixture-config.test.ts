import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cliRoot = fileURLToPath(new URL('../..', import.meta.url));

it('loads the fixture config with the real Vite runner without opening a listener', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { Server } from 'node:net';
    import { loadConfigFromFile } from 'vite';
    Server.prototype.listen = function () {
      throw new Error('Config loading must not open a listener.');
    };
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      'vite.dashboard.fixture.config.ts', process.cwd(), 'error', undefined, 'runner',
    );
    assert.ok(loaded);
    assert.ok(loaded.config.root.endsWith('/tests/e2e/fixtures'));
    const fixture = loaded.config.plugins.find(plugin => plugin?.name === 'openplanr-dashboard-owner-fixture');
    assert.equal(typeof fixture?.configureServer, 'function');
    console.log(JSON.stringify({ loader: 'runner', listening: false }));
  `,
    ],
    { cwd: cliRoot, encoding: 'utf8', timeout: 30_000 },
  );
  expect(JSON.parse(output.trim())).toEqual({ loader: 'runner', listening: false });
});
