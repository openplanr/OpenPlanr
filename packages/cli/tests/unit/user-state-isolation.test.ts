import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planrHome, userHome } from '../../lib/planr-home.mjs';

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

describe('test user-state isolation', () => {
  it('resolves every user-state root inside the per-run temporary home', () => {
    const isolated = process.env.OPENPLANR_TEST_ISOLATED_HOME;
    expect(isolated, 'the suite setup must create an isolated home').toBeTruthy();
    expect(homedir()).not.toBe(userInfo().homedir);
    for (const [name, root] of Object.entries({
      homedir: homedir(),
      planrHome: planrHome(),
      userHome: userHome(),
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? '',
    })) {
      expect(inside(isolated ?? '', root), `${name} is ${root}`).toBe(true);
    }
  });
});
