/**
 * Points every user-state location at a per-run temporary home before any test runs.
 * Load it first: `node --import <this file> --test ...`, a vitest setup file, or an import
 * at the top of a test runner, so child processes inherit the same environment.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const MARKER = 'OPENPLANR_TEST_ISOLATED_HOME';

function playwrightCache(realHome) {
  if (process.platform === 'darwin') return join(realHome, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(realHome, 'AppData', 'Local'), 'ms-playwright');
  return join(process.env.XDG_CACHE_HOME ?? join(realHome, '.cache'), 'ms-playwright');
}

if (!process.env[MARKER]) {
  const realHome = userInfo().homedir;
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-test-home-')));
  // Tool caches stay where they are: they are not OpenPlanr state and refetching is slow.
  process.env.npm_config_cache ??= join(realHome, '.npm');
  const browsers = playwrightCache(realHome);
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(browsers))
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  const gitConfig = join(realHome, '.gitconfig');
  if (!process.env.GIT_CONFIG_GLOBAL && existsSync(gitConfig))
    process.env.GIT_CONFIG_GLOBAL = gitConfig;

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // Cleared, not set: the default `~/.planr` now resolves inside `home`, and tests that set
  // their own `OPENPLANR_HOME` keep it, since `PLANR_HOME` would take precedence.
  for (const name of ['PLANR_HOME', 'OPENPLANR_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'])
    delete process.env[name];
  for (const [name, folder] of [
    ['XDG_CONFIG_HOME', '.config'],
    ['XDG_DATA_HOME', join('.local', 'share')],
    ['XDG_STATE_HOME', join('.local', 'state')],
  ]) {
    process.env[name] = join(home, folder);
    mkdirSync(process.env[name], { recursive: true });
  }
  if (process.platform === 'win32') {
    process.env.APPDATA = join(home, 'AppData', 'Roaming');
    mkdirSync(process.env.APPDATA, { recursive: true });
  }
  process.env[MARKER] = home;
  process.on('exit', () => rmSync(home, { recursive: true, force: true, maxRetries: 3 }));
}
