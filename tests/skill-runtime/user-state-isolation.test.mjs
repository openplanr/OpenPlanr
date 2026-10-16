import assert from 'node:assert/strict';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planrHome, userHome } from '../../packages/artifact/lib/artifact/internal/planr-home.mjs';

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

test('the suite resolves every user-state root inside the per-run temporary home', () => {
  const isolated = process.env.OPENPLANR_TEST_ISOLATED_HOME;
  assert.ok(isolated, 'the suite must load tests/support/isolate-user-state.mjs');
  assert.notEqual(homedir(), userInfo().homedir);
  for (const [name, root] of Object.entries({
    homedir: homedir(),
    planrHome: planrHome(),
    userHome: userHome(),
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? '',
  })) {
    assert.ok(inside(isolated, root), `${name} is ${root}`);
  }
});
