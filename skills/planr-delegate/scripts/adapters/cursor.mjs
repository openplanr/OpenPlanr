import { isAbsolute } from 'node:path';
import { capsuleDirectory } from './capsule.mjs';
import {
  AdapterError,
  CAPABILITIES,
  destinationFromEndpoint,
  extractTerminalJsonObject,
  invokeProcess,
  normalizeResult,
  parseJson,
} from './generic.mjs';

export const CURSOR_EXECUTION_POLICY = Object.freeze({
  configuration: 'trusted-native',
  sandbox: 'enabled',
  approval: 'auto-review',
  extensions:
    'Inherited Cursor hooks, plugins and MCP may execute and make additional network requests under the native configuration.',
});

function executionConfiguration(profile, env) {
  if (profile.trustNativeConfiguration !== true)
    throw new AdapterError(
      'E_ADAPTER_CONFIGURATION',
      'Cursor requires explicit trustNativeConfiguration: true after reviewing its inherited hooks, plugins and MCP.',
    );
  if (!env.HOME || !isAbsolute(env.HOME))
    throw new AdapterError(
      'E_ADAPTER_CONFIGURATION',
      'Cursor requires its normal signed-in home directory.',
    );
  for (const [key, value] of Object.entries(env)) {
    if (value && /^(?:(?:HTTPS?|ALL)_PROXY|https?_proxy|all_proxy|NODE_USE_ENV_PROXY)$/u.test(key))
      throw new AdapterError(
        'E_DESTINATION_UNKNOWN',
        'Cursor proxy routing requires a separately supported configuration.',
        { configurationKey: key },
      );
  }
  const endpoint = env.CURSOR_API_ENDPOINT ?? 'https://api2.cursor.sh';
  const destination = destinationFromEndpoint(endpoint);
  if (new URL(endpoint).pathname !== '/')
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Cursor API endpoint must be an origin.');
  return { destination, endpoint: destination.origin };
}

function checkedSession(id, previous, expected) {
  if (id === undefined) return previous;
  if (
    typeof id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id) ||
    (previous && previous !== id) ||
    (expected && expected !== id)
  )
    throw new AdapterError(
      'E_ADAPTER_SESSION',
      'Cursor emitted a different or invalid session identifier.',
    );
  return id;
}

function assistantText(event) {
  const blocks = event.message?.content;
  if (!Array.isArray(blocks) || blocks.some((b) => b.type !== 'text' || typeof b.text !== 'string'))
    throw new AdapterError('E_ADAPTER_RESULT', 'Cursor assistant message is malformed.');
  const text = blocks.map((b) => b.text).join('');
  if (Buffer.byteLength(text) > 64 * 1024)
    throw new AdapterError('E_ADAPTER_RESULT', 'Cursor final message exceeds its limit.');
  return text;
}

function streamObserver(expectedSessionId, onSessionId, onActivity) {
  let sessionId = null;
  let terminal = null;
  let finalText = null;
  return {
    async onLine(line) {
      const event = parseJson(line);
      if (!event || typeof event !== 'object' || Array.isArray(event))
        throw new AdapterError('E_ADAPTER_RESULT', 'Cursor emitted an invalid event.');
      if (terminal)
        throw new AdapterError(
          'E_ADAPTER_RESULT',
          'Cursor emitted events after its terminal result.',
        );
      const observed = checkedSession(event.session_id, sessionId, expectedSessionId);
      if (!sessionId && observed) {
        sessionId = observed;
        await onSessionId?.(observed);
      }
      // Without partial streaming, each assistant event is one complete message.
      // The result envelope concatenates progress text, so use the last message
      // after the last tool call and require a successful terminal envelope.
      if (event.type === 'tool_call') finalText = null;
      if (event.type === 'assistant') finalText = assistantText(event);
      if (event.type === 'result') terminal = event;
      await onActivity?.();
    },
    result(exitCode) {
      try {
        if (
          !terminal ||
          exitCode !== 0 ||
          terminal.is_error !== false ||
          terminal.subtype !== 'success' ||
          !sessionId ||
          terminal.session_id !== sessionId
        )
          throw new AdapterError(
            exitCode !== 0 ? 'E_ADAPTER_EXIT' : 'E_ADAPTER_RESULT',
            'Cursor did not return a successful structured result.',
          );
        const result = normalizeResult({ ...extractTerminalJsonObject(finalText), sessionId });
        return result;
      } catch (error) {
        if (sessionId && error instanceof AdapterError) error.sessionId = sessionId;
        throw error;
      }
    },
  };
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
}) {
  const directory = await capsuleDirectory(capsulePath);
  const { endpoint } = executionConfiguration(profile, env);
  const observer = streamObserver(sessionId, onSessionId, onActivity);
  const { exitCode } = await invokeProcess(
    profile.executable,
    [
      ...(profile.argv.length ? ['--model', profile.argv[1]] : []),
      '--print',
      '--output-format',
      'stream-json',
      '--auto-review',
      '--sandbox',
      'enabled',
      '--trust',
      '--workspace',
      cwd,
      '--add-dir',
      directory,
      '--endpoint',
      endpoint,
      ...(sessionId ? ['--resume', sessionId] : []),
    ],
    {
      cwd,
      env,
      input: prompt,
      signal,
      timeoutMs,
      onProcess,
      withExitCode: true,
      retainStdout: false,
      onStdoutLine: observer.onLine,
    },
  );
  return observer.result(exitCode);
}

export const cursorAdapter = Object.freeze({
  kind: 'cursor',
  async probe({ profile, cwd, env, signal, timeoutMs }) {
    const { destination, endpoint } = executionConfiguration(profile, env);
    const options = {
      cwd,
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10000, 10000),
      maxOutputBytes: 128 * 1024,
    };
    const help = await invokeProcess(profile.executable, ['--help'], options);
    if (
      ![
        '--print',
        '--output-format',
        'stream-json',
        '--resume',
        '--auto-review',
        '--sandbox',
        '--workspace',
        '--add-dir',
        '--endpoint',
      ].every((flag) => help.includes(flag))
    )
      throw new AdapterError(
        'E_ADAPTER_INCOMPATIBLE',
        'Cursor CLI lacks structured print, exact resume, sandbox or capsule access; update the native agent CLI.',
      );
    const output = await invokeProcess(
      profile.executable,
      ['--endpoint', endpoint, 'status', '--format', 'json'],
      { ...options, maxOutputBytes: 16 * 1024 },
    );
    const auth = parseJson(output, 'E_ADAPTER_AUTHENTICATION');
    if (auth.isAuthenticated !== true)
      throw new AdapterError(
        'E_ADAPTER_AUTHENTICATION',
        'Run agent login in your normal terminal, then preview the same Cursor profile again.',
      );
    return { capabilities: CAPABILITIES, destination, executionPolicy: CURSOR_EXECUTION_POLICY };
  },
  run: execute,
  async resume(args) {
    if (
      typeof args.sessionId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(args.sessionId)
    )
      throw new AdapterError(
        'E_ADAPTER_SESSION',
        'Exact Cursor session identifier is required for resume.',
      );
    return execute(args);
  },
});
