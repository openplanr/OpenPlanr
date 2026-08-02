import { describe, expect, it } from 'vitest';
import {
  minimalSubprocessEnvironment,
  SAFE_ENV_KEYS,
} from '../../src/services/operate/subprocess-env.js';

/**
 * Regression: the subprocess allowlist was POSIX-only. On Windows the omission
 * of PATHEXT left the loader unable to resolve a bare `git` to `git.exe`, so
 * `resolveOperatingProject` reported "requires a Git worktree" inside a
 * perfectly valid repository. Evidence collection and the lock service shared
 * the same list.
 */
describe('operating subprocess environment', () => {
  it('carries what the host platform needs to start a process at all', () => {
    expect(SAFE_ENV_KEYS).toContain('PATH');
    if (process.platform === 'win32') {
      // Without these Windows cannot resolve or load the executable.
      expect(SAFE_ENV_KEYS).toEqual(
        expect.arrayContaining(['PATHEXT', 'SystemRoot', 'ComSpec', 'USERPROFILE']),
      );
    } else {
      expect(SAFE_ENV_KEYS).toEqual(expect.arrayContaining(['HOME', 'LANG']));
    }
  });

  it('never forwards credential, proxy, or git-config overrides', () => {
    const forbidden = [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GIT_ASKPASS',
      'SSH_AUTH_SOCK',
      'http_proxy',
      'HTTPS_PROXY',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_COUNT',
      'NODE_OPTIONS',
    ];
    for (const key of forbidden) expect(SAFE_ENV_KEYS).not.toContain(key);
  });

  it('includes only allowlisted keys plus explicit extras', () => {
    const previous = process.env.OPERATE_ENV_LEAK_PROBE;
    process.env.OPERATE_ENV_LEAK_PROBE = 'must-not-propagate';
    try {
      const environment = minimalSubprocessEnvironment({ GIT_TERMINAL_PROMPT: '0' });
      expect(environment.OPERATE_ENV_LEAK_PROBE).toBeUndefined();
      expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
      for (const key of Object.keys(environment)) {
        if (key === 'GIT_TERMINAL_PROMPT') continue;
        expect(SAFE_ENV_KEYS).toContain(key);
      }
    } finally {
      if (previous === undefined) delete process.env.OPERATE_ENV_LEAK_PROBE;
      else process.env.OPERATE_ENV_LEAK_PROBE = previous;
    }
  });
});
