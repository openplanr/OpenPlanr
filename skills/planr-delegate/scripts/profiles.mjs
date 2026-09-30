import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { claudeAdapter } from './adapters/claude.mjs';
import { codexAdapter } from './adapters/codex.mjs';
import {
  AdapterError,
  CAPABILITIES,
  genericAdapter,
  validateDestination,
} from './adapters/generic.mjs';

export { AdapterError };
export const PROFILE_VERSION = 1;
export const PROFILE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const PROFILE_RENEWAL_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PROFILE_BYTES = 16 * 1024;
const BASE_ENV = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
const ADAPTERS = Object.freeze({ claude: claudeAdapter, codex: codexAdapter, generic: genericAdapter });
const PROFILE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const FORBIDDEN_ENV = /^(?:NODE_OPTIONS|BASH_ENV|ENV|LD_PRELOAD|DYLD_.+|ELECTRON_RUN_AS_NODE)$/u;
const BUILTIN_ARG = /^(?:--model|-m)$/u;

function profileDirectory(directory) {
  return directory ?? join(homedir(), '.config', 'openplanr', 'delegate', 'profiles');
}

function profilePath(name, directory) {
  if (!PROFILE_NAME.test(name)) throw new AdapterError('E_PROFILE_NAME', 'Profile name is invalid.');
  return join(profileDirectory(directory), `${name}.json`);
}

async function checkPrivateDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new AdapterError('E_PROFILE_PERMISSIONS', 'Profile directory must be private to the current user.');
  }
  if (process.getuid && info.uid !== process.getuid()) {
    throw new AdapterError('E_PROFILE_PERMISSIONS', 'Profile directory has a different owner.');
  }
}

async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await checkPrivateDirectory(directory);
}

function validateProfileFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AdapterError('E_PROFILE_INVALID', 'Profile declaration must be an object.');
  }
  const { name, kind, executable, argv, allowedEnv, workingDirectory, configDir } = input;
  profilePath(name);
  if (!ADAPTERS[kind]) throw new AdapterError('E_PROFILE_INVALID', 'Unsupported adapter kind.');
  if (typeof executable !== 'string' || !executable || executable.includes('\0') || executable.includes('\n') || executable.length > 512) {
    throw new AdapterError('E_PROFILE_INVALID', 'Executable must be one path or command name.');
  }
  if (!Array.isArray(argv) || argv.length > 32 || argv.some((arg) => typeof arg !== 'string' || arg.includes('\0') || arg.includes('\n') || arg.length > 256)) {
    throw new AdapterError('E_PROFILE_INVALID', 'Adapter argv must be a bounded string array.');
  }
  if (argv.some((arg) => /(?:api[-_]?key|access[-_]?token|auth[-_]?token|password|secret|credential)/iu.test(arg))) {
    throw new AdapterError('E_PROFILE_INVALID', 'Adapter argv must not carry credentials. Use an allowed environment name.');
  }
  if (kind !== 'generic' && (argv.length > 2 || (argv.length && (!BUILTIN_ARG.test(argv[0]) || argv.length !== 2)))) {
    throw new AdapterError('E_PROFILE_INVALID', 'Built-in adapter argv may only select a model.');
  }
  if (!Array.isArray(allowedEnv) || allowedEnv.length > 64 || allowedEnv.some((key) => typeof key !== 'string' || !ENV_NAME.test(key) || FORBIDDEN_ENV.test(key))) {
    throw new AdapterError('E_PROFILE_INVALID', 'Allowed environment names are invalid.');
  }
  if (workingDirectory !== 'worktree') {
    throw new AdapterError('E_PROFILE_INVALID', 'Delegation only supports a worktree working directory.');
  }
  if (configDir !== undefined && ((kind !== 'claude' && kind !== 'codex') || typeof configDir !== 'string' || !isAbsolute(configDir))) {
    throw new AdapterError('E_PROFILE_INVALID', 'Built-in adapter config directory must be absolute.');
  }
  return { name, kind, executable, argv: [...argv], allowedEnv: [...new Set(allowedEnv)], workingDirectory, ...(configDir ? { configDir } : {}) };
}

function validateProfile(input, now = Date.now(), enrollment = false, allowExpired = false) {
  const fields = validateProfileFields(input);
  const destination = validateDestination(input.destination);
  if (!enrollment) {
    if (input.version !== PROFILE_VERSION || !Number.isSafeInteger(input.enrolledAt) || !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= input.enrolledAt || (!allowExpired && input.expiresAt <= now) ||
      input.expiresAt - input.enrolledAt > PROFILE_LIFETIME_MS) {
      throw new AdapterError('E_PROFILE_EXPIRED', 'Profile enrollment expired or is invalid; re-enroll it.');
    }
  }
  return {
    version: PROFILE_VERSION,
    ...fields, destination,
    enrolledAt: enrollment ? now : input.enrolledAt,
    expiresAt: enrollment ? now + PROFILE_LIFETIME_MS : input.expiresAt,
  };
}

export async function enrollProfile(input, { directory, now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - PROFILE_LIFETIME_MS) {
    throw new AdapterError('E_PROFILE_INVALID', 'Enrollment time is invalid.');
  }
  const profile = validateProfile(input, now, true);
  if (profile.configDir) {
    profile.configDir = await canonicalConfigDir(profile.configDir);
  }
  const serialized = JSON.stringify(profile);
  if (Buffer.byteLength(serialized) > MAX_PROFILE_BYTES) {
    throw new AdapterError('E_PROFILE_SIZE', 'Profile exceeds its private record limit.');
  }
  const path = profilePath(profile.name, directory);
  await ensureDirectory(dirname(path));
  const temp = join(dirname(path), `.${profile.name}-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(serialized);
    await handle.close();
    await rename(temp, path);
  } catch {
    await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw new AdapterError('E_PROFILE_WRITE', 'Private profile could not be stored.');
  }
  return profile;
}

export async function loadProfile(name, { directory, now = Date.now(), allowExpired = false } = {}) {
  const path = profilePath(name, directory);
  await checkPrivateDirectory(dirname(path));
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new AdapterError('E_PROFILE_MISSING', 'Profile is not enrolled.');
  }
  let parsed;
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
      throw new AdapterError('E_PROFILE_PERMISSIONS', 'Profile record must be a private regular file.');
    }
    if (info.size > MAX_PROFILE_BYTES) {
      throw new AdapterError('E_PROFILE_SIZE', 'Profile record exceeds its size limit.');
    }
    parsed = JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('E_PROFILE_INVALID', 'Profile record is malformed.');
  } finally {
    await handle.close();
  }
  if (parsed.name !== name) throw new AdapterError('E_PROFILE_INVALID', 'Profile record name changed.');
  const profile = validateProfile(parsed, now, false, allowExpired);
  // Preserve the enrolled record's identity across changes to validation's field order.
  Object.defineProperty(profile, 'recordDigest', {
    value: createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
  });
  return profile;
}

async function canonicalConfigDir(path) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new AdapterError('E_PROFILE_INVALID', 'Adapter config directory does not exist.');
  }
  if (!info.isDirectory()) throw new AdapterError('E_PROFILE_INVALID', 'Adapter config directory is not a directory.');
  return realpath(path);
}

function selectedModel(profile) {
  return profile.argv[0] === '--model' || profile.argv[0] === '-m' ? profile.argv[1] : null;
}

function profileSummary(profile, now) {
  return {
    name: profile.name,
    kind: profile.kind,
    destination: profile.destination,
    selectedModel: selectedModel(profile),
    status: profile.expiresAt <= now ? 'expired' : 'enrolled',
    expiresAt: profile.expiresAt,
    renewalRecommended: profile.expiresAt - now <= PROFILE_RENEWAL_WARNING_MS,
  };
}

// Discovery exposes only enrolled choices, never environment values or config contents.
export async function listProfiles({ directory, now = Date.now() } = {}) {
  const root = profileDirectory(directory);
  let entries;
  try {
    await checkPrivateDirectory(root);
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (entries.length > 128) throw new AdapterError('E_PROFILE_SIZE', 'Too many enrolled profile records.');
  const choices = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    const name = entry.name.slice(0, -5);
    if (!PROFILE_NAME.test(name)) continue;
    try {
      const profile = await loadProfile(name, { directory, now, allowExpired: true });
      choices.push(profileSummary(profile, now));
    } catch (error) {
      choices.push({ name, status: 'unavailable', code: error?.code ?? 'E_PROFILE_INVALID' });
    }
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

async function localProbeToken(profile, env) {
  const direct = env.LM_STUDIO_API_KEY ?? env.LM_API_TOKEN ?? env.ANTHROPIC_AUTH_TOKEN;
  if (typeof direct === 'string' && direct.length > 0 && direct.length < 4096 && !/[\r\n]/u.test(direct))
    return direct;
  if (profile.kind !== 'claude' || !profile.configDir) return null;
  try {
    const path = join(profile.configDir, 'settings.json');
    if ((await stat(path)).size > 64 * 1024) return null;
    const settings = JSON.parse(await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      .then(async (handle) => { try { return await handle.readFile('utf8'); } finally { await handle.close(); } }));
    const token = settings?.env?.LM_API_TOKEN ?? settings?.env?.ANTHROPIC_AUTH_TOKEN;
    return typeof token === 'string' && token.length > 0 && token.length < 4096 && !/[\r\n]/u.test(token)
      ? token : null;
  } catch {
    return null;
  }
}

async function boundedJson(response) {
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export async function inspectLocalBackend(profile, { fetchImpl = fetch, timeoutMs = 2000, env = process.env } = {}) {
  const selectedModel = profile.argv[0] === '--model' || profile.argv[0] === '-m' ? profile.argv[1] : null;
  if (profile.destination.class !== 'local') {
    return { status: 'not-checked', modelStatus: 'not-checked', selectedModel, visibleModels: [] };
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    throw new AdapterError('E_PROFILE_INVALID', 'Backend probe timeout must be at most five seconds.');
  }
  const token = await localProbeToken(profile, env);
  let response;
  try {
    response = await fetchImpl(new URL('/v1/models', profile.destination.origin), {
      method: 'GET',
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch {
    return { status: 'unreachable', modelStatus: 'unknown', selectedModel, visibleModels: [] };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: 'authentication-required', modelStatus: 'unknown', selectedModel, visibleModels: [] };
  }
  if (!response.ok || !response.body) {
    return { status: 'reachable', modelStatus: 'unverified', selectedModel, visibleModels: [] };
  }
  const parsed = await boundedJson(response);
  if (!Array.isArray(parsed?.data)) {
    return { status: 'reachable', modelStatus: 'unverified', selectedModel, visibleModels: [] };
  }
  const visibleModels = parsed.data
    .map((entry) => entry?.id)
    .filter((id) => typeof id === 'string' && id.length <= 256)
    .slice(0, 32);
  let loadStatus = 'unverified';
  let contextLength = null;
  if (selectedModel && visibleModels.includes(selectedModel)) {
    try {
      const nativeResponse = await fetchImpl(new URL('/api/v1/models', profile.destination.origin), {
        method: 'GET',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      });
      const native = await boundedJson(nativeResponse);
      if (Array.isArray(native?.models)) {
        const model = native.models.find((entry) => entry?.key === selectedModel ||
          entry?.loaded_instances?.some((instance) => instance?.id === selectedModel));
        if (model && Array.isArray(model.loaded_instances)) {
          loadStatus = model.loaded_instances.length ? 'loaded' : 'not-loaded';
          const capacities = model.loaded_instances
            .map((instance) => instance?.config?.context_length)
            .filter((value) => Number.isSafeInteger(value) && value > 0 && value <= 4_194_304);
          if (capacities.length === model.loaded_instances.length && capacities.length)
            contextLength = Math.min(...capacities);
        }
      }
    } catch {
      // A non-LM-Studio endpoint has no native loaded-state contract.
    }
  }
  return {
    status: 'reachable',
    selectedModel,
    modelStatus: selectedModel ? (visibleModels.includes(selectedModel) ? 'visible' : 'not-listed') : 'unspecified',
    loadStatus,
    contextLength,
    visibleModels,
  };
}

export function profileReadiness(destination, backend) {
  if (destination.class !== 'local') {
    return { state: 'unverified', dispatchable: true, nextAction: 'External provider health is not checked by this probe.' };
  }
  if (backend.status === 'unreachable') {
    return { state: 'server-unreachable', dispatchable: false, nextAction: 'Start the enrolled local model server and probe again.' };
  }
  if (backend.status === 'authentication-required') {
    return { state: 'authentication-required', dispatchable: false, nextAction: 'Provide the local server token through an allowed environment variable, then probe again.' };
  }
  if (backend.modelStatus === 'not-listed') {
    return { state: 'model-unavailable', dispatchable: false, nextAction: 'Make the selected model available or enroll a different model.' };
  }
  if (backend.loadStatus === 'not-loaded') {
    return { state: 'model-not-loaded', dispatchable: false, nextAction: 'Load the selected model in its local runtime and probe again.' };
  }
  if (backend.loadStatus === 'loaded') return { state: 'ready', dispatchable: true };
  return { state: 'unverified', dispatchable: true, nextAction: 'Model load state could not be confirmed; dispatch may still fail.' };
}

export async function inspectEnrolledBackend(profile, { env = process.env } = {}) {
  return inspectLocalBackend(profile, { env: childEnvironment(profile, env) });
}

// Inspect a candidate before enrollment. No task text, capsule, worktree, or profile write is involved.
export async function previewProfileCandidate(nameOrDeclaration, {
  directory, cwd, env = process.env, signal, timeoutMs, now = Date.now(),
} = {}) {
  const stored = typeof nameOrDeclaration === 'string';
  const existing = stored
    ? await loadProfile(nameOrDeclaration, { directory, now, allowExpired: true })
    : null;
  const declaration = existing ?? nameOrDeclaration;
  const profile = validateProfileFields(declaration);
  if (profile.configDir) profile.configDir = await canonicalConfigDir(profile.configDir);
  const raw = adapterFor(profile.kind);
  const effectiveEnv = childEnvironment(profile, env);
  const found = await raw.probe({ profile, cwd, env: effectiveEnv, signal, timeoutMs });
  if (!Object.keys(CAPABILITIES).every((key) => found.capabilities?.[key] === true)) {
    throw new AdapterError('E_ADAPTER_INCOMPATIBLE', 'Agent lacks required implementation and exact-resume capabilities.');
  }
  const destination = validateDestination(found.destination);
  const backend = await inspectLocalBackend({ ...profile, destination }, { env: effectiveEnv });
  return {
    candidate: { ...profile, destination },
    previousDestination: existing?.destination ?? null,
    capabilities: found.capabilities,
    backend,
    readiness: profileReadiness(destination, backend),
    ...(existing ? { enrollment: profileSummary(existing, now) } : {}),
  };
}

export async function removeProfile(name, { directory } = {}) {
  const path = profilePath(name, directory);
  try { await checkPrivateDirectory(dirname(path)); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const info = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return false;
  if (!info.isFile()) throw new AdapterError('E_PROFILE_PERMISSIONS', 'Profile path is not a regular file.');
  await rm(path);
  return true;
}

function childEnvironment(profile, source) {
  const output = {};
  for (const key of [...BASE_ENV, ...profile.allowedEnv]) {
    if (typeof source[key] === 'string') output[key] = source[key];
  }
  if (profile.configDir && profile.kind === 'claude') output.CLAUDE_CONFIG_DIR = profile.configDir;
  if (profile.configDir && profile.kind === 'codex') output.CODEX_HOME = profile.configDir;
  return output;
}

export function adapterFor(kind) {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new AdapterError('E_PROFILE_INVALID', 'Unsupported adapter kind.');
  return adapter;
}

export async function prepareProfile(nameOrProfile, options = {}) {
  const { directory, cwd, env = process.env, signal, timeoutMs, now = Date.now() } = options;
  let profile;
  if (typeof nameOrProfile === 'string') {
    profile = await loadProfile(nameOrProfile, { directory, now });
  } else {
    const requested = validateProfile(nameOrProfile, now);
    profile = await loadProfile(requested.name, { directory, now });
    if (JSON.stringify(profile) !== JSON.stringify(requested)) {
      throw new AdapterError('E_PROFILE_CHANGED', 'Persisted profile changed; inspect and re-enroll it.');
    }
  }
  const raw = adapterFor(profile.kind);
  const effectiveEnv = childEnvironment(profile, env);
  const verify = async (runCwd = cwd, runSignal = signal, runTimeoutMs = timeoutMs) => {
    const found = await raw.probe({ profile, cwd: runCwd, env: effectiveEnv, signal: runSignal, timeoutMs: runTimeoutMs });
    if (found.destination.class !== profile.destination.class || found.destination.origin !== profile.destination.origin) {
      throw new AdapterError('E_DESTINATION_CHANGED', 'Agent data destination changed; inspect and re-enroll the profile.');
    }
    if (!Object.keys(CAPABILITIES).every((key) => found.capabilities?.[key] === true)) {
      throw new AdapterError('E_ADAPTER_INCOMPATIBLE', 'Agent lacks required implementation and exact-resume capabilities.');
    }
    return found;
  };
  const found = await verify();
  const adapter = Object.freeze({
    kind: raw.kind,
    async run(args) {
      await verify(args.cwd, args.signal, args.timeoutMs);
      return raw.run({ ...args, profile, env: effectiveEnv });
    },
    async resume(args) {
      await verify(args.cwd, args.signal, args.timeoutMs);
      return raw.resume({ ...args, profile, env: effectiveEnv });
    },
  });
  return { profile, destination: found.destination, capabilities: found.capabilities, adapter };
}
