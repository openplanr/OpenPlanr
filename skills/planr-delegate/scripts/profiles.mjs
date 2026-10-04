import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { claudeAdapter } from './adapters/claude.mjs';
import { codexAdapter } from './adapters/codex.mjs';
import { cursorAdapter } from './adapters/cursor.mjs';
import {
  AdapterError,
  CAPABILITIES,
  genericAdapter,
  validateDestination,
} from './adapters/generic.mjs';

import { inspectLocalBackend, profileReadiness } from './backend-diagnostics.mjs';

export { inspectLocalBackend, profileReadiness } from './backend-diagnostics.mjs';

export { AdapterError };
export const PROFILE_VERSION = 2;
export const PROFILE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const PROFILE_RENEWAL_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PROFILE_BYTES = 16 * 1024;
// Claude's macOS keychain lookup uses USER as its account identity. It is not a credential.
const BASE_ENV = ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL'];
const ADAPTERS = Object.freeze({
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  generic: genericAdapter,
});
const PROFILE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const FORBIDDEN_ENV = /^(?:NODE_OPTIONS|BASH_ENV|ENV|LD_PRELOAD|DYLD_.+|ELECTRON_RUN_AS_NODE)$/u;
const BUILTIN_ARG = /^(?:--model|-m)$/u;

function profileDirectory(directory) {
  return directory ?? join(homedir(), '.config', 'openplanr', 'delegate', 'profiles');
}

function profilePath(name, directory) {
  if (!PROFILE_NAME.test(name))
    throw new AdapterError('E_PROFILE_NAME', 'Profile name is invalid.');
  return join(profileDirectory(directory), `${name}.json`);
}

async function checkPrivateDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new AdapterError(
      'E_PROFILE_PERMISSIONS',
      'Profile directory must be private to the current user.',
    );
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
  const { kind, executable, configDir } = input;
  const name = input.name ?? `native-${kind}`;
  const argv = input.argv ?? (input.model ? ['--model', input.model] : []);
  const allowedEnv = input.allowedEnv ?? [];
  const workingDirectory = input.workingDirectory ?? 'worktree';
  profilePath(name);
  if (!ADAPTERS[kind]) throw new AdapterError('E_PROFILE_INVALID', 'Unsupported adapter kind.');
  if (
    typeof executable !== 'string' ||
    !executable ||
    executable.includes('\0') ||
    executable.includes('\n') ||
    executable.length > 512
  ) {
    throw new AdapterError('E_PROFILE_INVALID', 'Executable must be one path or command name.');
  }
  if (
    !Array.isArray(argv) ||
    argv.length > 32 ||
    argv.some(
      (arg) =>
        typeof arg !== 'string' || arg.includes('\0') || arg.includes('\n') || arg.length > 256,
    )
  ) {
    throw new AdapterError('E_PROFILE_INVALID', 'Adapter argv must be a bounded string array.');
  }
  if (
    argv.some((arg) =>
      /(?:api[-_]?key|access[-_]?token|auth[-_]?token|password|secret|credential)/iu.test(arg),
    )
  ) {
    throw new AdapterError(
      'E_PROFILE_INVALID',
      'Adapter argv must not carry credentials. Use an allowed environment name.',
    );
  }
  if (
    kind !== 'generic' &&
    (argv.length > 2 || (argv.length && (!BUILTIN_ARG.test(argv[0]) || argv.length !== 2)))
  ) {
    throw new AdapterError('E_PROFILE_INVALID', 'Built-in adapter argv may only select a model.');
  }
  if (
    !Array.isArray(allowedEnv) ||
    allowedEnv.length > 64 ||
    allowedEnv.some(
      (key) => typeof key !== 'string' || !ENV_NAME.test(key) || FORBIDDEN_ENV.test(key),
    )
  ) {
    throw new AdapterError('E_PROFILE_INVALID', 'Allowed environment names are invalid.');
  }
  if (workingDirectory !== 'worktree') {
    throw new AdapterError(
      'E_PROFILE_INVALID',
      'Delegation only supports a worktree working directory.',
    );
  }
  if (
    configDir !== undefined &&
    ((kind !== 'claude' && kind !== 'codex') ||
      typeof configDir !== 'string' ||
      !isAbsolute(configDir))
  ) {
    throw new AdapterError(
      'E_PROFILE_INVALID',
      'Built-in adapter config directory must be absolute.',
    );
  }
  return {
    name,
    kind,
    executable,
    argv: [...argv],
    allowedEnv: [...new Set(allowedEnv)],
    workingDirectory,
    ...(kind === 'cursor' ? { trustNativeConfiguration: true } : {}),
    ...(configDir ? { configDir } : {}),
    ...(input.destination !== undefined
      ? {
          destination:
            kind !== 'generic' &&
            input.destination?.class === 'native-managed' &&
            input.destination?.origin === 'native-managed'
              ? { class: 'native-managed', origin: 'native-managed' }
              : validateDestination(input.destination),
        }
      : {}),
  };
}

function assertDestination(profile, found) {
  const declared = profile.destination;
  if (!declared || declared.class === 'native-managed') return;
  if (declared.class === found.destination.class && declared.origin === found.destination.origin)
    return;
  throw new AdapterError(
    found.destination.class === 'native-managed'
      ? 'E_DESTINATION_UNKNOWN'
      : 'E_DESTINATION_CHANGED',
    found.destination.class === 'native-managed'
      ? 'The declared destination cannot be confirmed from native routing. Inspect configuration before dispatch.'
      : 'The declared destination differs from observed native routing. Inspect configuration before dispatch.',
    {
      declaredDestination: declared,
      effectiveDestination: found.destination,
      ...(found.routing ? { routing: found.routing } : {}),
      nextAction: 'Reconcile the profile and native routing sources, then prepare a fresh preview.',
    },
  );
}

function validateProfile(input, now = Date.now(), enrollment = false, allowExpired = false) {
  const fields = validateProfileFields(input);
  const generic = fields.kind === 'generic';
  const version = enrollment ? (generic ? 1 : PROFILE_VERSION) : input.version;
  if (![1, 2].includes(version))
    throw new AdapterError('E_PROFILE_INVALID', 'Unsupported private profile version.');
  if (
    generic &&
    !enrollment &&
    (!Number.isSafeInteger(input.expiresAt) || (!allowExpired && input.expiresAt <= now))
  )
    throw new AdapterError('E_PROFILE_EXPIRED', 'Experimental generic enrollment expired.');
  return {
    version,
    ...fields,
    ...(generic
      ? {
          destination: validateDestination(input.destination),
          enrolledAt: enrollment ? now : input.enrolledAt,
          expiresAt: enrollment ? now + PROFILE_LIFETIME_MS : input.expiresAt,
        }
      : {
          ...(fields.destination ? { destination: fields.destination } : {}),
          ...(version === 1 ? { enrolledAt: input.enrolledAt, expiresAt: input.expiresAt } : {}),
        }),
  };
}

export async function enrollProfile(input, { directory, now = Date.now() } = {}) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > Number.MAX_SAFE_INTEGER - PROFILE_LIFETIME_MS
  ) {
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
  const existing = await lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && profile.kind !== 'generic') {
    const prior = JSON.parse(await readFile(path, 'utf8'));
    if (prior.version === 1)
      throw new AdapterError(
        'E_PROFILE_EXISTS',
        'Legacy profiles are preserved. Use a new optional profile name.',
      );
  }
  await ensureDirectory(dirname(path));
  const temp = join(dirname(path), `.${profile.name}-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(serialized);
    await handle.close();
    await rename(temp, path);
  } catch (error) {
    const cleanup = await Promise.allSettled([handle.close(), rm(temp, { force: true })]);
    throw new AdapterError('E_PROFILE_WRITE', 'Private profile could not be stored.', {
      cause: error.code ?? error.name,
      cleanup: cleanup
        .filter((item) => item.status === 'rejected')
        .map((item) => item.reason?.code ?? item.reason?.name),
    });
  }
  return profile;
}

export async function loadProfile(
  name,
  { directory, now = Date.now(), allowExpired = false } = {},
) {
  const path = profilePath(name, directory);
  try {
    await checkPrivateDirectory(dirname(path));
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new AdapterError('E_PROFILE_MISSING', 'Profile is not enrolled.', { name });
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('E_PROFILE_READ', 'Private profile directory could not be inspected.', {
      name,
      cause: error.code ?? error.name,
    });
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new AdapterError('E_PROFILE_MISSING', 'Profile is not enrolled.', { name });
    throw new AdapterError(
      'E_PROFILE_READ',
      'Private profile could not be opened; inspect its permissions and file type.',
      { name, cause: error.code ?? error.name },
    );
  }
  let parsed;
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new AdapterError(
        'E_PROFILE_PERMISSIONS',
        'Profile record must be a private regular file.',
      );
    }
    if (info.size > MAX_PROFILE_BYTES) {
      throw new AdapterError('E_PROFILE_SIZE', 'Profile record exceeds its size limit.');
    }
    parsed = JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('E_PROFILE_INVALID', 'Profile record could not be parsed or read.', {
      cause: error.code ?? error.name,
    });
  } finally {
    await handle.close();
  }
  if (parsed.name !== name)
    throw new AdapterError('E_PROFILE_INVALID', 'Profile record name changed.');
  const profile = validateProfile(parsed, now, false, allowExpired);
  Object.defineProperty(profile, 'recordDigest', { value: profileIdentity(profile) });
  return profile;
}

// Renewal metadata is deliberately excluded; engine, scope and destination changes still invalidate runs.
export function profileIdentity(profile) {
  const fields = validateProfileFields(profile);
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: PROFILE_VERSION,
        name: fields.name,
        kind: fields.kind,
        executable: fields.executable,
        argv: fields.argv,
        allowedEnv: fields.allowedEnv.slice().sort(),
        workingDirectory: fields.workingDirectory,
        configDir: fields.configDir ?? null,
        ...(fields.trustNativeConfiguration ? { trustNativeConfiguration: true } : {}),
        destination: profile.destination ?? { class: 'native-managed', origin: 'native-managed' },
      }),
    )
    .digest('hex');
}

async function canonicalConfigDir(path) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new AdapterError(
      error.code === 'ENOENT' ? 'E_PROFILE_INVALID' : 'E_PROFILE_CONFIG_READ',
      'Adapter config directory could not be inspected.',
      { cause: error.code ?? error.name },
    );
  }
  if (!info.isDirectory())
    throw new AdapterError('E_PROFILE_INVALID', 'Adapter config directory is not a directory.');
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
    status:
      profile.kind === 'generic' ? (profile.expiresAt <= now ? 'expired' : 'enrolled') : 'saved',
    ...(profile.kind === 'generic'
      ? {
          expiresAt: profile.expiresAt,
          renewalRecommended: profile.expiresAt - now <= PROFILE_RENEWAL_WARNING_MS,
        }
      : {}),
    version: profile.version,
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
  if (entries.length > 128)
    throw new AdapterError('E_PROFILE_SIZE', 'Too many enrolled profile records.');
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

export async function inspectEnrolledBackend(profile, { env = process.env, cwd } = {}) {
  return inspectLocalBackend(profile, { env: childEnvironment(profile, env), cwd });
}

// Inspect a candidate before enrollment. No task text, capsule, worktree, or profile write is involved.
export async function previewProfileCandidate(
  nameOrDeclaration,
  { directory, cwd, env = process.env, signal, timeoutMs, now = Date.now() } = {},
) {
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
  if (profile.kind !== 'generic') assertDestination(profile, found);
  if (
    !(
      profile.kind === 'generic' ? Object.keys(CAPABILITIES) : ['implementation', 'exactResume']
    ).every((key) => found.capabilities?.[key] === true)
  ) {
    throw new AdapterError(
      'E_ADAPTER_INCOMPATIBLE',
      'Agent lacks required implementation and exact-resume capabilities.',
    );
  }
  const destination =
    profile.kind === 'generic' ? validateDestination(found.destination) : found.destination;
  const backend = await inspectLocalBackend(
    { ...profile, destination },
    { env: effectiveEnv, cwd },
  );
  return {
    candidate: { ...profile, destination },
    previousDestination: existing?.destination ?? null,
    capabilities: found.capabilities,
    ...(found.executionPolicy ? { executionPolicy: found.executionPolicy } : {}),
    ...(found.routing ? { routing: found.routing } : {}),
    backend,
    readiness:
      profile.kind === 'generic'
        ? profileReadiness(destination, backend)
        : nativeReadiness(destination, backend),
    ...(existing ? { enrollment: profileSummary(existing, now) } : {}),
  };
}

export async function removeProfile(name, { directory } = {}) {
  const path = profilePath(name, directory);
  try {
    await checkPrivateDirectory(dirname(path));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const info = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return false;
  if (!info.isFile())
    throw new AdapterError('E_PROFILE_PERMISSIONS', 'Profile path is not a regular file.');
  await rm(path);
  return true;
}

function childEnvironment(profile, source) {
  const output = profile.kind === 'generic' ? {} : { ...source };
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

export async function discoverNativeEngines(env = process.env) {
  const engines = [];
  for (const [kind, command] of [
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['cursor', 'agent'],
  ]) {
    for (const folder of (env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
      const executable = join(folder, process.platform === 'win32' ? `${command}.exe` : command);
      try {
        await access(executable, constants.X_OK);
        if (!(await stat(executable)).isFile()) continue;
        engines.push({ kind, executable, supported: true });
        break;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) throw error;
      }
    }
  }
  return engines;
}

export function nativeReadiness(destination, backend) {
  const diagnostic = profileReadiness(destination, backend);
  return {
    ...diagnostic,
    dispatchable: true,
    diagnosticOnly: true,
    ...(destination.class === 'native-managed'
      ? {
          state: 'native-managed',
          nextAction: 'Provider routing and authentication are managed by the native CLI.',
        }
      : {}),
  };
}

export async function prepareProfile(choice, options = {}) {
  const {
    directory,
    cwd,
    env = process.env,
    signal,
    timeoutMs,
    engine,
    model,
    configDir,
  } = options;
  let declaration;
  if (typeof choice === 'string')
    declaration = await loadProfile(choice, { directory, allowExpired: true });
  else if (choice) declaration = choice;
  else {
    const available = await discoverNativeEngines(env);
    let selected = engine;
    let saved = null;
    if (!selected) {
      try {
        const selectionPath = join(profileDirectory(directory), '.selection.json');
        const details = await lstat(selectionPath);
        if (!details.isFile() || details.mode & 0o077 || details.size > 64 * 1024)
          throw new AdapterError('E_PROFILE_READ', 'Saved engine choice is unsafe or oversized.');
        saved = JSON.parse(await readFile(selectionPath, 'utf8'));
        if (saved.version !== 2 || !['claude', 'codex', 'cursor'].includes(saved.engine))
          throw new AdapterError('E_PROFILE_READ', 'Saved engine choice is unsupported.');
        selected = saved.engine;
      } catch (error) {
        if (error.code !== 'ENOENT')
          throw new AdapterError('E_PROFILE_READ', 'Saved engine choice cannot be read.');
      }
    }
    const found = selected
      ? available.find((item) => item.kind === selected)
      : available.length === 1
        ? available[0]
        : null;
    if (!found)
      throw new AdapterError(
        available.length ? 'E_ENGINE_AMBIGUOUS' : 'E_ENGINE_UNAVAILABLE',
        selected
          ? 'The selected native CLI is unavailable. Install or select it explicitly.'
          : 'Select one installed native engine.',
        { engines: available.map((item) => item.kind) },
      );
    declaration = saved?.profile
      ? {
          ...(await loadProfile(saved.profile, { directory, allowExpired: true })),
          ...(saved.model ? { argv: ['--model', saved.model] } : {}),
          ...(saved.configDir ? { configDir: saved.configDir } : {}),
        }
      : {
          ...found,
          name: `native-${found.kind}`,
          version: 2,
          ...((model ?? saved?.model) ? { argv: ['--model', model ?? saved.model] } : {}),
          ...((configDir ?? saved?.configDir) ? { configDir: configDir ?? saved.configDir } : {}),
        };
  }
  if (engine && declaration.kind !== engine)
    throw new AdapterError('E_PROFILE_CHANGED', 'Explicit engine and profile disagree.');
  if (declaration.kind === 'generic' && (model !== undefined || configDir !== undefined))
    throw new AdapterError(
      'E_PROFILE_CHANGED',
      'Generic model/configuration options belong to its declared protocol.',
    );
  // Per-run choices override optional saved defaults without rewriting the profile.
  if (declaration.kind !== 'generic')
    declaration = {
      ...declaration,
      ...(model !== undefined ? { argv: ['--model', model] } : {}),
      ...(configDir !== undefined ? { configDir } : {}),
    };
  const fields = validateProfileFields(declaration);
  const native = fields.kind !== 'generic';
  const profile = native ? { ...fields, version: 2 } : validateProfile(declaration);
  if (profile.configDir) profile.configDir = await canonicalConfigDir(profile.configDir);
  const raw = adapterFor(profile.kind);
  const effectiveEnv = childEnvironment(profile, env);
  const found = await raw.probe({ profile, cwd, env: effectiveEnv, signal, timeoutMs });
  if (
    !(native ? ['implementation', 'exactResume'] : Object.keys(CAPABILITIES)).every(
      (key) => found.capabilities?.[key] === true,
    )
  )
    throw new AdapterError(
      'E_ADAPTER_INCOMPATIBLE',
      'Agent lacks implementation or exact continuation.',
    );
  assertDestination(profile, found);
  profile.destination = found.destination;
  Object.defineProperty(profile, 'recordDigest', { value: profileIdentity(profile) });
  async function verifyRouting(args) {
    const current = await raw.probe({ ...args, profile, env: effectiveEnv });
    if (
      current.destination.class !== profile.destination.class ||
      current.destination.origin !== profile.destination.origin
    )
      throw new AdapterError(
        'E_DESTINATION_CHANGED',
        'Observed routing changed after preparation.',
        {
          declaredDestination: profile.destination,
          effectiveDestination: current.destination,
          ...(current.routing ? { routing: current.routing } : {}),
          nextAction: 'Inspect native routing, then prepare a fresh preview.',
        },
      );
  }
  const adapter = Object.freeze({
    kind: raw.kind,
    async run(args) {
      await verifyRouting(args);
      return raw.run({ ...args, profile, env: effectiveEnv });
    },
    async resume(args) {
      await verifyRouting(args);
      return raw.resume({ ...args, profile, env: effectiveEnv });
    },
  });
  return {
    profile,
    destination: found.destination,
    capabilities: found.capabilities,
    adapter,
    ...(found.executionPolicy ? { executionPolicy: found.executionPolicy } : {}),
    ...(found.routing ? { routing: found.routing } : {}),
  };
}

export async function saveEngineChoice(engine, { directory, profile, model, configDir } = {}) {
  if (!['claude', 'codex', 'cursor'].includes(engine)) return;
  const root = profileDirectory(directory);
  await ensureDirectory(root);
  const temp = join(root, `.selection-${randomUUID()}.tmp`);
  await writeFile(
    temp,
    JSON.stringify({
      version: 2,
      engine,
      ...(profile ? { profile } : {}),
      ...(model ? { model } : {}),
      ...(configDir ? { configDir } : {}),
    }),
    { flag: 'wx', mode: 0o600 },
  );
  await rename(temp, join(root, '.selection.json'));
}
