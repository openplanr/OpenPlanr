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
      active = heading[1];
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
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex worktree directory is required to inspect project config.');
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
    throw new AdapterError('E_DESTINATION_UNKNOWN', `Codex ${label} conflicts across configuration layers.`);
  }
  return unique[0];
}

export async function resolveCodexDestination(_profile, env, cwd) {
  const root = env.CODEX_HOME ?? join(env.HOME ?? '', '.codex');
  if (!isAbsolute(root)) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex configuration directory is unknown.');
  }
  const paths = [join(root, 'config.toml'), ...ancestorDirectories(cwd).map((path) => join(path, '.codex', 'config.toml'))];
  const configs = (await Promise.all([...new Set(paths)].map(readConfig))).filter((value) => value !== null);
  if (env.CODEX_PROFILE) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex environment profile override is not inspectable.');
  }
  const selectedProfile = uniqueScalar(configs.map((config) => tomlString(config, 'profile')), 'profile selection');
  if (selectedProfile && !configs.some((config) => config.includes(`[profiles.${selectedProfile}]`))) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Selected Codex profile is not inspectable.');
  }
  const provider = uniqueScalar(configs.flatMap((config) => [
    tomlString(config, 'model_provider'),
    selectedProfile ? tomlString(config, 'model_provider', `profiles.${selectedProfile}`) : undefined,
  ]), 'model provider');
  const providerUrls = provider ? configs.map((config) => tomlString(config, 'base_url', `model_providers.${provider}`)) : [];
  if (provider && !providerUrls.some(Boolean)) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Selected Codex provider has no inspectable base_url.');
  }
  const endpoints = [
    ...providerUrls,
    ...configs.flatMap((config) => [
      tomlString(config, 'openai_base_url'),
      selectedProfile ? tomlString(config, 'openai_base_url', `profiles.${selectedProfile}`) : undefined,
    ]),
    env.OPENAI_BASE_URL,
  ].filter(Boolean);
  if (!endpoints.length) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex effective endpoint is unknown; configure a provider base_url before enrollment.');
  }
  const destinations = endpoints.map(destinationFromEndpoint);
  if (destinations.some((candidate) => candidate.class !== destinations[0].class || candidate.origin !== destinations[0].origin)) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Codex configuration layers disagree on data destination.');
  }
  return destinations[0];
}

function safeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
  const usage = {};
  for (const field of fields) {
    if (Number.isSafeInteger(value[field]) && value[field] >= 0)
      usage[field] = value[field];
  }
  return Object.keys(usage).length ? usage : null;
}

function parseCodexEvents(output, expectedSessionId) {
  let sessionId;
  let message;
  let completed = false;
  let usage = null;
  try {
    for (const line of output.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      const event = parseJson(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new AdapterError('E_ADAPTER_RESULT', 'Codex returned an invalid event.');
      }
      if (event.type === 'thread.started') {
        if (typeof event.thread_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(event.thread_id) || (sessionId && sessionId !== event.thread_id)) {
          throw new AdapterError('E_ADAPTER_SESSION', 'Codex emitted an invalid or inconsistent session identifier.');
        }
        sessionId = event.thread_id;
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        message = event.item.text;
      }
      if (event.type === 'turn.completed') {
        completed = true;
        usage = safeUsage(event.usage);
      }
      if (event.type === 'turn.failed') {
        throw new AdapterError('E_ADAPTER_RESULT', 'Codex reported a failed turn.');
      }
    }
    if (completed && sessionId && !message) {
      const error = new AdapterError('E_ADAPTER_NO_FINAL', 'Codex completed without a final agent message.');
      error.usage = usage;
      error.completionEvidence = 'turn-completed-no-final';
      throw error;
    }
    if (!completed || !sessionId || !message) {
      throw new AdapterError('E_ADAPTER_RESULT', 'Codex did not return a complete structured result.');
    }
    if (expectedSessionId && expectedSessionId !== sessionId) {
      throw new AdapterError('E_ADAPTER_SESSION', 'Codex resumed a different session.');
    }
    return { ...normalizeResult({ ...extractTerminalJsonObject(message), sessionId }),
      usage, completionEvidence: 'turn-completed-with-final' };
  } catch (error) {
    if (error instanceof AdapterError) {
      if (sessionId) error.sessionId = sessionId;
      if (completed) {
        error.usage ??= usage;
        error.completionEvidence ??= 'turn-completed-invalid-final';
      }
    }
    throw error;
  }
}

const MAX_IDENTICAL_COMMANDS = 5;
const MAX_COMMANDS_PER_TURN = 120;

function sessionObserver(onSessionId, expectedSessionId, onActivity) {
  let seen;
  let previousCommand = null;
  let identicalCommands = 0;
  let commandCount = 0;
  return async (line) => {
    const event = parseJson(line);
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new AdapterError('E_ADAPTER_RESULT', 'Codex emitted an invalid event.');
    }
    if (event.type === 'thread.started') {
      const id = event.thread_id;
      if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id) ||
        (seen && seen !== id) || (expectedSessionId && expectedSessionId !== id)) {
        throw new AdapterError('E_ADAPTER_SESSION', 'Codex emitted a different or invalid session identifier.');
      }
      seen = id;
      await onSessionId?.(id);
    }
    if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
      commandCount += 1;
      // Hash only the observable command and result. Never persist source, output, or credentials.
      const fingerprint = createHash('sha256').update(JSON.stringify([
        event.item.command, event.item.aggregated_output, event.item.exit_code,
      ])).digest('hex');
      identicalCommands = fingerprint === previousCommand ? identicalCommands + 1 : 1;
      previousCommand = fingerprint;
      if (identicalCommands >= MAX_IDENTICAL_COMMANDS || commandCount > MAX_COMMANDS_PER_TURN) {
        const error = new AdapterError('E_ADAPTER_STALLED', 'Codex repeated a completed command or exceeded its command budget.');
        error.sessionId = seen;
        throw error;
      }
    } else if (event.type === 'item.completed' && event.item?.type === 'file_change') {
      previousCommand = null;
      identicalCommands = 0;
    }
    await onActivity?.();
  };
}

export const codexAdapter = Object.freeze({
  kind: 'codex',
  async probe({ profile, cwd, env, signal, timeoutMs }) {
    const destination = await resolveCodexDestination(profile, env, cwd);
    const output = await invokeProcess(profile.executable, [...profile.argv, 'exec', '--help'], {
      env, signal,
      timeoutMs: Math.min(timeoutMs ?? 10_000, 10_000),
      maxOutputBytes: 128 * 1024,
    });
    if (!['--json', 'resume', '--sandbox'].every((flag) => output.includes(flag))) {
      throw new AdapterError('E_ADAPTER_INCOMPATIBLE', 'Codex executable lacks tools, JSON events, or exact resume.');
    }
    return { capabilities: CAPABILITIES, destination };
  },
  async run({ profile, cwd, prompt, onSessionId, onActivity, env, signal, timeoutMs }) {
    const output = await invokeProcess(profile.executable, [...profile.argv, 'exec', '--json', '--sandbox', 'workspace-write', '-'], {
      cwd, env, input: prompt, signal, timeoutMs, onStdoutLine: sessionObserver(onSessionId, undefined, onActivity),
    });
    return parseCodexEvents(output);
  },
  async resume({ profile, cwd, prompt, sessionId, onSessionId, onActivity, env, signal, timeoutMs }) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new AdapterError('E_ADAPTER_SESSION', 'Exact Codex session identifier is required.');
    }
    const output = await invokeProcess(profile.executable, [...profile.argv, 'exec', 'resume', '--json', '-c', 'sandbox_mode="workspace-write"', sessionId, '-'], {
      cwd, env, input: prompt, signal, timeoutMs, onStdoutLine: sessionObserver(onSessionId, sessionId, onActivity),
    });
    return parseCodexEvents(output, sessionId);
  },
});
