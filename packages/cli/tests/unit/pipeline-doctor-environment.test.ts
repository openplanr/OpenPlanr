import { describe, expect, it } from 'vitest';
import { pipelineDoctorEnvironment } from '../../src/services/runtime-manager/doctor.js';

describe('pipelineDoctorEnvironment', () => {
  it('keeps system basics and doctor settings and drops unrelated credentials', () => {
    const env = pipelineDoctorEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/a',
        LC_ALL: 'C',
        XDG_CONFIG_HOME: '/home/a/.config',
        OPENPLANR_STRICT_ECOSYSTEM: '1',
        OPENPLANR_HOME: '/old',
        PLANR_HOME: '/stale',
        FOO_TOKEN: 'secret',
        OPENAI_API_KEY: 'secret',
        GITHUB_TOKEN: 'secret',
        NODE_OPTIONS: '--require x',
      },
      '/resolved/.planr',
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/a',
      LC_ALL: 'C',
      XDG_CONFIG_HOME: '/home/a/.config',
      OPENPLANR_STRICT_ECOSYSTEM: '1',
      PLANR_HOME: '/resolved/.planr',
    });
  });
});
