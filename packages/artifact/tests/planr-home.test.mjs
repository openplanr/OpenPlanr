import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';

// The warning is once per process, so every case runs in a fresh Node process whose environment
// carries only the variables under test.
const helper = new URL('../lib/artifact/internal/planr-home.mjs', import.meta.url).href;
const home = join('/', 'users', 'reviewer');

function resolveIn(variables) {
  const script = `
    const helper = await import(${JSON.stringify(helper)});
    const copy = await import(${JSON.stringify(`${helper}?second-copy`)});
    const first = {
      planrHome: helper.planrHome(),
      userHome: helper.userHome(),
      configured: helper.configuredPlanrHome() ?? null,
    };
    const again = { planrHome: copy.planrHome(), userHome: copy.userHome() };
    process.stdout.write(JSON.stringify({ ...first, again }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...variables },
  });
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout), stderr: result.stderr };
}

test('PLANR_HOME alone names the state directory and prints nothing', () => {
  const resolved = resolveIn({ PLANR_HOME: join('/', 'state', 'planr') });
  assert.equal(resolved.planrHome, join('/', 'state', 'planr'));
  assert.equal(resolved.configured, join('/', 'state', 'planr'));
  assert.equal(resolved.userHome, home);
  assert.equal(resolved.stderr, '');
});

test('OPENPLANR_HOME alone still resolves to its .planr directory and warns once', () => {
  const legacy = join('/', 'sandbox');
  const resolved = resolveIn({ OPENPLANR_HOME: legacy });
  assert.equal(resolved.planrHome, join(legacy, '.planr'));
  assert.equal(resolved.configured, join(legacy, '.planr'));
  assert.equal(resolved.userHome, legacy);
  assert.deepEqual(resolved.again, { planrHome: join(legacy, '.planr'), userHome: legacy });
  assert.equal(
    resolved.stderr,
    `Warning: OPENPLANR_HOME is deprecated; set PLANR_HOME=${join(legacy, '.planr')} instead.\n`,
  );
});

test('PLANR_HOME wins over a different OPENPLANR_HOME and the warning names both', () => {
  const current = join('/', 'state', 'planr');
  const legacy = join('/', 'sandbox');
  const resolved = resolveIn({ PLANR_HOME: current, OPENPLANR_HOME: legacy });
  assert.equal(resolved.planrHome, current);
  assert.equal(resolved.userHome, home);
  assert.equal(
    resolved.stderr,
    `Warning: PLANR_HOME=${current} and OPENPLANR_HOME=${legacy} name different OpenPlanr homes; using PLANR_HOME. OPENPLANR_HOME is deprecated; unset it.\n`,
  );
});

test('an OPENPLANR_HOME that agrees with PLANR_HOME is ignored with a deprecation warning', () => {
  const legacy = join('/', 'sandbox');
  const resolved = resolveIn({ PLANR_HOME: join(legacy, '.planr'), OPENPLANR_HOME: legacy });
  assert.equal(resolved.planrHome, join(legacy, '.planr'));
  assert.equal(resolved.userHome, home);
  assert.equal(
    resolved.stderr,
    'Warning: OPENPLANR_HOME is deprecated and ignored because PLANR_HOME is set; unset OPENPLANR_HOME.\n',
  );
});

test('with neither variable, or only blank ones, the state directory is ~/.planr', () => {
  for (const variables of [{}, { PLANR_HOME: '  ', OPENPLANR_HOME: '' }]) {
    const resolved = resolveIn(variables);
    assert.equal(resolved.planrHome, join(home, '.planr'));
    assert.equal(resolved.configured, null);
    assert.equal(resolved.userHome, home);
    assert.equal(resolved.stderr, '');
  }
});
