/** Explicit, allowlisted environments for every child process delegation starts. */

/** A portable environment variable name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const BASE_NAMES = Object.freeze([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'TZ',
  'LANG',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  // Windows needs these to start any process and to find the user profile.
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramData',
  'HOMEDRIVE',
  'HOMEPATH',
]);
const BASE_PREFIXES = Object.freeze(['LC_', 'XDG_']);

// Each native CLI receives only the configuration and routing variables the adapters read to
// compute its destination, so the preview matches what the child sees. Credentials pass only
// when the profile names them in `allowedEnv`.
const ENGINE_NAMES = Object.freeze({
  claude: [
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ],
  codex: ['CODEX_HOME', 'OPENAI_BASE_URL'],
  cursor: ['CURSOR_API_ENDPOINT'],
  generic: [],
});
// Claude Code on Bedrock or Vertex reads the cloud provider's region, project and profile names.
const CLAUDE_PROVIDER_NAMES = Object.freeze({
  CLAUDE_CODE_USE_BEDROCK: ['AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_PROFILE'],
  CLAUDE_CODE_USE_VERTEX: [
    'CLOUD_ML_REGION',
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'GOOGLE_CLOUD_PROJECT',
  ],
});

function copyNames(output, source, names) {
  for (const name of names) if (typeof source[name] === 'string') output[name] = source[name];
}

function copyPrefixes(output, source, prefixes) {
  for (const [name, value] of Object.entries(source))
    if (typeof value === 'string' && prefixes.some((prefix) => name.startsWith(prefix)))
      output[name] = value;
}

function enabled(value) {
  return typeof value === 'string' && value !== '' && value !== '0' && value !== 'false';
}

/** Locale, paths, terminal, proxy and certificate settings every child needs to run. */
export function baseEnvironment(source = process.env) {
  const output = {};
  copyNames(output, source, BASE_NAMES);
  copyPrefixes(output, source, BASE_PREFIXES);
  return output;
}

/** The base environment plus explicit overrides, such as `GIT_INDEX_FILE`, for one git call. */
export function gitEnvironment(overrides = {}, source = process.env) {
  return { ...baseEnvironment(source), ...overrides };
}

/** The environment for one agent: base, the routing names its adapter reads, and the profile's `allowedEnv`. */
export function agentEnvironment(profile, source = process.env) {
  const output = baseEnvironment(source);
  copyNames(output, source, ENGINE_NAMES[profile.kind] ?? []);
  if (profile.kind === 'claude')
    for (const [selector, names] of Object.entries(CLAUDE_PROVIDER_NAMES))
      if (enabled(source[selector])) copyNames(output, source, names);
  copyNames(output, source, profile.allowedEnv ?? []);
  if (profile.configDir && profile.kind === 'claude') output.CLAUDE_CONFIG_DIR = profile.configDir;
  if (profile.configDir && profile.kind === 'codex') output.CODEX_HOME = profile.configDir;
  return output;
}

/** The environment for one parent-selected check: base plus the names the check lists in `env`. */
export function checkEnvironment(check, source = process.env) {
  const output = baseEnvironment(source);
  copyNames(output, source, check.env ?? []);
  return output;
}
