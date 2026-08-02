/**
 * Operating Board never inherits the caller's full environment into a
 * subprocess: evidence collection and locking shell out to `git` and `gh`, and
 * a leaked token or proxy override there would cross the read-only boundary.
 *
 * The allowlist has to be platform-aware, though. A POSIX-only list leaves
 * Windows unable to start the process at all — `PATHEXT` is what resolves a
 * bare `git` to `git.exe`, and `SystemRoot`/`ComSpec` are required by the
 * Windows loader and by git's own helper processes. Omitting them surfaces as
 * a spawn failure that reads like "not a Git worktree", not like a
 * misconfigured environment.
 *
 * Nothing here carries credentials: no `GH_TOKEN`, `GIT_ASKPASS`,
 * `SSH_AUTH_SOCK`, `http_proxy`, or `GIT_CONFIG_*`.
 */
const POSIX_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];
const WINDOWS_ENV_KEYS = [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'SystemDrive',
    'ComSpec',
    'WINDIR',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramData',
];
export const SAFE_ENV_KEYS = process.platform === 'win32' ? WINDOWS_ENV_KEYS : POSIX_ENV_KEYS;
/** Build the minimal environment a read-only subprocess needs on this platform. */
export function minimalSubprocessEnvironment(extra = {}) {
    const environment = {};
    for (const key of SAFE_ENV_KEYS) {
        if (process.env[key])
            environment[key] = process.env[key];
    }
    return { ...environment, ...extra };
}
//# sourceMappingURL=subprocess-env.js.map