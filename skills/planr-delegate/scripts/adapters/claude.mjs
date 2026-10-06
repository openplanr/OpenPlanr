import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { capsuleDirectory } from './capsule.mjs';
import { AdapterError, destinationFromEndpoint, invokeProcess } from './generic.mjs';
import {
  createNativeProgress,
  knownDestination,
  NATIVE_CAPABILITIES,
  NATIVE_EXECUTION_POLICY,
  nativeFailure,
  nativeObserver,
  nativeTurn,
} from './native.mjs';

const PROVIDER_VARIABLES = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];
const ROUTING_VARIABLES = ['ANTHROPIC_BASE_URL', ...PROVIDER_VARIABLES];

function routingVariables(env) {
  return Object.fromEntries(
    ROUTING_VARIABLES.filter((name) => Object.hasOwn(env, name)).map((name) => [name, env[name]]),
  );
}

// Keeps only routing variables from settings files; callers expose source labels and origins.
async function readClaudeRoutingSettings(profile, env, cwd, options = {}) {
  const managedRoot =
    options.managedRoot ??
    (process.platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode'
      : process.platform === 'win32'
        ? join(env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode')
        : '/etc/claude-code');
  const sources = [
    {
      source: 'user settings',
      path: join(
        profile.configDir || env.CLAUDE_CONFIG_DIR || join(env.HOME ?? '', '.claude'),
        'settings.json',
      ),
    },
    ...(cwd
      ? [
          { source: 'project settings', path: join(cwd, '.claude', 'settings.json') },
          { source: 'project local settings', path: join(cwd, '.claude', 'settings.local.json') },
        ]
      : []),
    {
      source: 'managed file settings',
      path: join(managedRoot, 'managed-settings.json'),
    },
  ];
  try {
    const path = join(managedRoot, 'managed-settings.d');
    if (!(await lstat(path)).isDirectory()) throw new Error('unsafe managed settings directory');
    const entries = (await readdir(path))
      .filter((name) => !name.startsWith('.') && name.endsWith('.json'))
      .sort();
    if (entries.length > 32) throw new Error('too many managed settings fragments');
    sources.push(
      ...entries.map((name, index) => ({
        source: `managed fragment settings ${index + 1}`,
        path: join(path, name),
      })),
    );
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new AdapterError(
        'E_DESTINATION_UNKNOWN',
        'Managed Claude routing settings could not be safely inspected.',
        {
          source: 'managed fragment settings',
          cause: error.code ?? error.name,
          nextAction: 'Inspect managed Claude settings, then prepare a fresh preview.',
        },
      );
  }
  const inspected = [];
  for (const { source, path } of sources) {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 64 * 1024)
        throw new AdapterError(
          'E_DESTINATION_UNKNOWN',
          'Claude routing settings are unsafe or oversized.',
        );
      const buffer = Buffer.alloc(64 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 64 * 1024)
        throw new AdapterError(
          'E_DESTINATION_UNKNOWN',
          'Claude routing settings exceed the inspection limit.',
        );
      const settings = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings))
        throw new AdapterError('E_DESTINATION_UNKNOWN', 'Claude routing settings are malformed.');
      if (
        settings.env !== undefined &&
        (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env))
      )
        throw new AdapterError('E_DESTINATION_UNKNOWN', 'Claude routing environment is malformed.');
      inspected.push({
        source,
        env: routingVariables(settings.env ?? {}),
        ...(settings.policyHelper ? { opaqueRouting: true } : {}),
      });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new AdapterError(
        'E_DESTINATION_UNKNOWN',
        'Claude routing settings could not be safely inspected. Inspect the native configuration before dispatch.',
        {
          source,
          cause: error.code ?? error.name,
          nextAction: 'Inspect Claude settings, then prepare a fresh preview.',
        },
      );
    } finally {
      await handle?.close();
    }
  }
  return inspected;
}

export async function resolveClaudeRouting(profile, env, cwd, options) {
  const settings = await readClaudeRoutingSettings(profile, env, cwd, options);
  const sources = [{ source: 'parent environment', env }, ...settings];
  const candidates = [];
  const providerSources = [];
  const providers = new Set();
  for (const entry of sources) {
    const endpoint = entry.env.ANTHROPIC_BASE_URL;
    if (endpoint !== undefined) {
      let destination;
      try {
        if (typeof endpoint !== 'string') throw new Error('invalid endpoint');
        destination = endpoint === '' ? knownDestination() : destinationFromEndpoint(endpoint);
      } catch {
        throw new AdapterError(
          'E_DESTINATION_UNKNOWN',
          'Claude routing contains an unsafe or invalid endpoint.',
          {
            source: `${entry.source}: ANTHROPIC_BASE_URL`,
            nextAction: 'Inspect the endpoint in this source, then prepare a fresh preview.',
          },
        );
      }
      candidates.push({ source: `${entry.source}: ANTHROPIC_BASE_URL`, ...destination });
    }
    if (entry.opaqueRouting)
      candidates.push({ source: `${entry.source}: policyHelper`, ...knownDestination() });
    for (const name of PROVIDER_VARIABLES) {
      const value = entry.env[name];
      if (value === undefined || value === '' || /^(?:0|false|no|off)$/iu.test(String(value)))
        continue;
      if (!/^(?:1|true|yes|on)$/iu.test(String(value)))
        throw new AdapterError(
          'E_DESTINATION_UNKNOWN',
          'Claude provider routing could not be interpreted.',
          {
            source: `${entry.source}: ${name}`,
            nextAction: 'Inspect native provider selection, then prepare a fresh preview.',
          },
        );
      providerSources.push(`${entry.source}: ${name}`);
      providers.add(name);
    }
  }
  const routing = {
    state: candidates.some((entry) => entry.class !== 'native-managed')
      ? 'observed'
      : 'native-managed',
    sources: [...candidates.map((entry) => entry.source), ...providerSources],
    candidates,
    coverage: 'environment-and-file-settings',
  };
  if (
    new Set(candidates.map((entry) => `${entry.class}:${entry.origin}`)).size > 1 ||
    providers.size > 1 ||
    (providerSources.length && candidates.length)
  )
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Claude routing sources disagree. Native settings precedence can vary by session; inspect the conflicting sources before dispatch.',
      {
        routing: { ...routing, state: 'ambiguous' },
        nextAction: 'Reconcile the named routing sources, then prepare a fresh preview.',
      },
    );
  return {
    destination:
      candidates.length && !providerSources.length
        ? { class: candidates[0].class, origin: candidates[0].origin }
        : knownDestination(),
    routing,
  };
}

export async function resolveClaudeDestination(profile, env, cwd) {
  return (await resolveClaudeRouting(profile, env, cwd)).destination;
}

export function parseClaudeOutput(envelope, expectedSessionId, exitCode = 0, errorOutput = '') {
  return nativeTurn({
    terminal: envelope
      ? { type: 'result', success: envelope.is_error !== true && envelope.subtype === 'success' }
      : null,
    sessionId: envelope?.session_id,
    expectedSessionId,
    exitCode,
    summary: envelope?.result,
    usage: envelope?.usage,
    errorText: `${JSON.stringify({ errors: envelope?.errors ?? [], result: envelope?.is_error ? envelope?.result : '', api_error_status: envelope?.api_error_status })}\n${errorOutput}`,
  });
}

async function execute({
  profile,
  cwd,
  prompt,
  capsulePath,
  sessionId,
  onSessionId,
  onActivity,
  onProcess,
  env,
  signal,
  timeoutMs,
  resume = false,
}) {
  const directory = await capsuleDirectory(capsulePath);
  let terminal = null;
  let model = null;
  const progress = createNativeProgress('claude', { cwd, capsuleDirectory: directory });
  const observer = nativeObserver(sessionId, onSessionId, onActivity, (event) => {
    if (event.type === 'result') {
      if (terminal)
        throw new AdapterError('E_ADAPTER_RESULT', 'Claude emitted multiple terminal results.');
      terminal = event;
    }
    if (event.type === 'system' && event.subtype === 'init') model = event.model ?? null;
    const denied =
      event.type === 'user' &&
      event.message?.content?.some?.(
        (block) =>
          block.type === 'tool_result' &&
          block.is_error &&
          /permission|approval/iu.test(String(block.content)),
      );
    return {
      ...progress(event),
      phase: denied ? 'attention' : event.type === 'result' ? 'completed' : 'native-execution',
      ...(denied ? { code: 'E_ADAPTER_PERMISSION' } : {}),
    };
  });
  const { exitCode, output } = await invokeProcess(
    profile.executable,
    [
      ...profile.argv,
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--add-dir',
      directory,
      ...(sessionId ? [resume ? '--resume' : '--session-id', sessionId] : []),
    ],
    {
      cwd,
      env,
      input: prompt,
      signal,
      timeoutMs: timeoutMs ?? null,
      onProcess,
      withExitCode: true,
      captureStderr: true,
      onStdoutLine: observer.onLine,
      retainStdout: false,
    },
  ).catch(nativeFailure);
  const result = parseClaudeOutput(terminal, sessionId ?? observer.session(), exitCode, output);
  if (model) result.observedModel = model;
  if (terminal?.permission_denials?.length) {
    result.status = 'blocked';
    result.diagnosticCode = 'E_ADAPTER_PERMISSION';
  }
  return result;
}

export const claudeAdapter = Object.freeze({
  kind: 'claude',
  async probe({ profile, cwd, env, signal, timeoutMs }) {
    const output = await invokeProcess(profile.executable, ['--help'], {
      cwd,
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10000, 10000),
      maxOutputBytes: 128 * 1024,
    });
    if (
      !['--print', '--output-format', 'stream-json', '--resume', '--session-id', '--add-dir'].every(
        (flag) => output.includes(flag),
      )
    )
      throw new AdapterError(
        'E_ADAPTER_INCOMPATIBLE',
        'Claude CLI lacks native event streaming or exact resume. Update it.',
      );
    const routing = await resolveClaudeRouting(profile, env, cwd);
    return {
      capabilities: NATIVE_CAPABILITIES,
      ...routing,
      executionPolicy: NATIVE_EXECUTION_POLICY,
    };
  },
  run: execute,
  resume(args) {
    if (!args.sessionId)
      throw new AdapterError('E_ADAPTER_SESSION', 'Exact Claude session is required.');
    return execute({ ...args, resume: true });
  },
});
