import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  AdapterError,
  CAPABILITIES,
  destinationFromEndpoint,
  extractTerminalJsonObject,
  invokeProcess,
  normalizeResult,
  parseJson,
} from './generic.mjs';

async function readConfig(path) {
  try {
    if ((await stat(path)).size > 64 * 1024) {
      throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex config exceeds the inspection limit.');
    }
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex config could not be inspected.');
  }
}

function tomlString(source, key, section = '') {
  let active = '';
  for (const line of source.split(/\r?\n/u)) {
    const heading = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (heading) {
      active = heading[1].replace(
        /"([^"]+)"|'([^']+)'/gu,
        (_match, double, single) => double ?? single,
      );
      continue;
    }
    if (active !== section) continue;
    const setting = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2\s*(?:#.*)?$/u.exec(line);
    if (setting?.[1] === key) return setting[3];
  }
  return undefined;
}

function ancestorDirectories(cwd) {
  if (!cwd || !isAbsolute(cwd)) {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Codex worktree directory is required to inspect project config.',
    );
  }
  const directories = [];
  for (let cursor = resolve(cwd); ; cursor = dirname(cursor)) {
    directories.push(cursor);
    if (cursor === dirname(cursor)) break;
  }
  return directories;
}

function uniqueScalar(values, label) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length > 1) {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      `Codex ${label} conflicts across configuration layers.`,
    );
  }
  return unique[0];
}

export async function resolveCodexDestination(_profile, env, cwd) {
  const root = env.CODEX_HOME ?? join(env.HOME ?? '', '.codex');
  if (!isAbsolute(root)) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex configuration directory is unknown.');
  }
  const paths = [
    join(root, 'config.toml'),
    ...ancestorDirectories(cwd).map((path) => join(path, '.codex', 'config.toml')),
  ];
  const configs = (await Promise.all([...new Set(paths)].map(readConfig))).filter(
    (value) => value !== null,
  );
  if (env.CODEX_PROFILE) {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Codex environment profile override is not inspectable.',
    );
  }
  const selectedProfile = uniqueScalar(
    configs.map((config) => tomlString(config, 'profile')),
    'profile selection',
  );
  if (
    selectedProfile &&
    !configs.some((config) => config.includes(`[profiles.${selectedProfile}]`))
  ) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Selected Codex profile is not inspectable.');
  }
  const provider = uniqueScalar(
    configs.flatMap((config) => [
      tomlString(config, 'model_provider'),
      selectedProfile
        ? tomlString(config, 'model_provider', `profiles.${selectedProfile}`)
        : undefined,
    ]),
    'model provider',
  );
  const providerUrls = provider
    ? configs.map((config) => tomlString(config, 'base_url', `model_providers.${provider}`))
    : [];
  if (provider && provider !== 'openai' && !providerUrls.some(Boolean)) {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Selected Codex provider has no inspectable base_url.',
    );
  }
  const endpoints = [
    ...providerUrls,
    ...configs.flatMap((config) => [
      tomlString(config, 'openai_base_url'),
      selectedProfile
        ? tomlString(config, 'openai_base_url', `profiles.${selectedProfile}`)
        : undefined,
    ]),
    env.OPENAI_BASE_URL,
  ].filter(Boolean);
  if (!endpoints.length) {
    // Signed-in Codex uses the ChatGPT backend; API-key auth uses OpenAI API.
    // Inspect auth mode only, never return tokens or auth source bytes.
    let authentication = null;
    try {
      authentication = JSON.parse(await readFile(join(root, 'auth.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new AdapterError(
          'E_DESTINATION_UNKNOWN',
          'Codex authentication mode could not be inspected.',
        );
    }
    const apiKey = Boolean(
      env.OPENAI_API_KEY ||
        authentication?.auth_mode === 'apikey' ||
        authentication?.OPENAI_API_KEY,
    );
    endpoints.push(apiKey ? 'https://api.openai.com' : 'https://chatgpt.com/backend-api/codex');
  }
  const destinations = endpoints.map(destinationFromEndpoint);
  if (
    destinations.some(
      (candidate) =>
        candidate.class !== destinations[0].class || candidate.origin !== destinations[0].origin,
    )
  ) {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Codex configuration layers disagree on data destination.',
    );
  }
  return destinations[0];
}

function safeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
  const usage = {};
  for (const field of fields) {
    if (Number.isSafeInteger(value[field]) && value[field] >= 0) usage[field] = value[field];
  }
  return Object.keys(usage).length ? usage : null;
}

const MAX_IDENTICAL_COMMANDS = 5;
const MAX_COMMANDS_PER_TURN = 120;

// Streaming state is bounded independently of total command output. An identical
// command is a loop even when its result contains changing elapsed-time text.
function codexEvents(onSessionId, expectedSessionId, onActivity) {
  let sessionId;
  let message;
  let completed = false;
  let usage = null;
  let previousCommand = null;
  let identicalCommands = 0;
  let commandCount = 0;
  const annotate = (error) => {
    if (sessionId) error.sessionId = sessionId;
    if (completed) {
      error.usage ??= usage;
      error.completionEvidence ??= 'turn-completed-invalid-final';
    }
    return error;
  };
  return {
    async observe(line) {
      try {
        const event = parseJson(line);
        if (!event || typeof event !== 'object' || Array.isArray(event))
          throw new AdapterError('E_ADAPTER_RESULT', 'Codex returned an invalid event.');
        if (event.type === 'thread.started') {
          const id = event.thread_id;
          if (
            typeof id !== 'string' ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id) ||
            (sessionId && sessionId !== id) ||
            (expectedSessionId && expectedSessionId !== id)
          )
            throw new AdapterError(
              'E_ADAPTER_SESSION',
              'Codex emitted a different or invalid session identifier.',
            );
          sessionId = id;
          await onSessionId?.(id);
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          if (typeof event.item.text !== 'string' || Buffer.byteLength(event.item.text) > 64 * 1024)
            throw new AdapterError('E_ADAPTER_RESULT', 'Codex final message exceeded its limit.');
          message = event.item.text;
        }
        if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
          commandCount += 1;
          const fingerprint = createHash('sha256').update(String(event.item.command)).digest('hex');
          identicalCommands = fingerprint === previousCommand ? identicalCommands + 1 : 1;
          previousCommand = fingerprint;
          if (identicalCommands >= MAX_IDENTICAL_COMMANDS || commandCount > MAX_COMMANDS_PER_TURN)
            throw new AdapterError(
              'E_ADAPTER_STALLED',
              'Codex repeated a completed command or exceeded its command budget.',
            );
        } else if (event.type === 'item.completed' && event.item?.type === 'file_change') {
          previousCommand = null;
          identicalCommands = 0;
        }
        if (event.type === 'turn.completed') {
          completed = true;
          usage = safeUsage(event.usage);
        }
        if (event.type === 'turn.failed')
          throw new AdapterError('E_ADAPTER_RESULT', 'Codex reported a failed turn.');
        await onActivity?.();
      } catch (error) {
        throw annotate(error);
      }
    },
    finish() {
      try {
        if (completed && sessionId && !message) {
          const error = new AdapterError(
            'E_ADAPTER_NO_FINAL',
            'Codex completed without a final agent message.',
          );
          error.usage = usage;
          error.completionEvidence = 'turn-completed-no-final';
          throw error;
        }
        if (!completed || !sessionId || !message)
          throw new AdapterError(
            'E_ADAPTER_RESULT',
            'Codex did not return a complete structured result.',
          );
        return {
          ...normalizeResult({ ...extractTerminalJsonObject(message), sessionId }),
          usage,
          completionEvidence: 'turn-completed-with-final',
        };
      } catch (error) {
        throw annotate(error);
      }
    },
  };
}

async function executionOverrides(env, cwd) {
  const root = env.CODEX_HOME ?? join(env.HOME ?? '', '.codex');
  const paths = [
    join(root, 'config.toml'),
    ...ancestorDirectories(cwd).map((directory) => join(directory, '.codex', 'config.toml')),
  ];
  const configs = (await Promise.all([...new Set(paths)].map(readConfig))).filter(Boolean);
  const servers = new Map();
  for (const config of configs) {
    const names = new Set();
    for (const line of config.split(/\r?\n/u)) {
      const match =
        /^\s*\[mcp_servers\.(?:"([^"\\]+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\.[^\]]+)?\]\s*(?:#.*)?$/u.exec(
          line,
        );
      if (match) names.add(match[1] ?? match[2] ?? match[3]);
      else if (/^\s*(?:\[|mcp_servers\s*=).*mcp_servers/u.test(line))
        throw new AdapterError(
          'E_ADAPTER_CONFIG',
          'Codex MCP configuration uses an uninspectable table form.',
        );
    }
    for (const name of names) {
      const section = `mcp_servers.${name}`;
      const command = tomlString(config, 'command', section);
      const url = tomlString(config, 'url', section);
      const transports = servers.get(name) ?? new Set();
      if (command !== undefined) transports.add('stdio');
      if (url !== undefined) transports.add('http');
      servers.set(name, transports);
    }
  }
  if ([...servers.values()].some((transports) => transports.size !== 1))
    throw new AdapterError(
      'E_ADAPTER_CONFIG',
      'Codex MCP server transport is missing or conflicts across configuration layers.',
    );
  // Codex splits override paths on dots without decoding quoted segments. A
  // nonempty TOML map preserves literal server names. Inert matching transports
  // also make ancestor entries valid when this configDir does not load them.
  // An empty map alone merges without removing existing servers.
  const disabledServers = [...servers]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, transports]) =>
        `${JSON.stringify(name)}={enabled=false,${transports.has('stdio') ? 'command=""' : 'url="http://127.0.0.1:9/mcp"'}}`,
    );
  const settings = [
    'approval_policy="never"',
    'sandbox_mode="workspace-write"',
    'notify=[]',
    'web_search="disabled"',
    ...(disabledServers.length ? [`mcp_servers={${disabledServers.join(',')}}`] : []),
  ];
  return settings.flatMap((value) => ['-c', value]);
}

export const codexAdapter = Object.freeze({
  kind: 'codex',
  async probe({ profile, cwd, env, signal, timeoutMs }) {
    const destination = await resolveCodexDestination(profile, env, cwd);
    const output = await invokeProcess(profile.executable, [...profile.argv, 'exec', '--help'], {
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10_000, 10_000),
      maxOutputBytes: 128 * 1024,
    });
    if (!['--json', 'resume', '--sandbox'].every((flag) => output.includes(flag))) {
      throw new AdapterError(
        'E_ADAPTER_INCOMPATIBLE',
        'Codex executable lacks tools, JSON events, or exact resume.',
      );
    }
    return { capabilities: CAPABILITIES, destination };
  },
  async run({ profile, cwd, prompt, onSessionId, onActivity, onProcess, env, signal, timeoutMs }) {
    const events = codexEvents(onSessionId, undefined, onActivity);
    await invokeProcess(
      profile.executable,
      [
        ...profile.argv,
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        ...(await executionOverrides(env, cwd)),
        '-',
      ],
      {
        cwd,
        env,
        input: prompt,
        signal,
        timeoutMs,
        onProcess,
        onStdoutLine: events.observe,
        retainStdout: false,
        maxOutputBytes: 8 * 1024 * 1024,
      },
    );
    return events.finish();
  },
  async resume({
    profile,
    cwd,
    prompt,
    sessionId,
    onSessionId,
    onActivity,
    onProcess,
    env,
    signal,
    timeoutMs,
  }) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new AdapterError('E_ADAPTER_SESSION', 'Exact Codex session identifier is required.');
    }
    const events = codexEvents(onSessionId, sessionId, onActivity);
    await invokeProcess(
      profile.executable,
      [
        ...profile.argv,
        'exec',
        'resume',
        '--json',
        ...(await executionOverrides(env, cwd)),
        sessionId,
        '-',
      ],
      {
        cwd,
        env,
        input: prompt,
        signal,
        timeoutMs,
        onProcess,
        onStdoutLine: events.observe,
        retainStdout: false,
        maxOutputBytes: 8 * 1024 * 1024,
      },
    );
    return events.finish();
  },
});
