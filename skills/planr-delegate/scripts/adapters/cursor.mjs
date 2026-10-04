import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capsuleDirectory } from './capsule.mjs';
import { AdapterError, invokeProcess, parseJson } from './generic.mjs';
import {
  createNativeProgress,
  knownDestination,
  NATIVE_CAPABILITIES,
  NATIVE_EXECUTION_POLICY,
  nativeFailure,
  nativeTurn,
} from './native.mjs';

export const CURSOR_EXECUTION_POLICY = NATIVE_EXECUTION_POLICY;

function executionConfiguration(env) {
  return { destination: knownDestination(env.CURSOR_API_ENDPOINT) };
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

function streamObserver(cwd, expectedSessionId, onSessionId, onActivity, directory) {
  let sessionId = null;
  let terminal = null;
  let finalText = null;
  let model = null;
  const rejectedCommands = new Set();
  const commandByCall = new Map();
  const progress = createNativeProgress('cursor', { cwd, capsuleDirectory: directory });
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
      if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string')
        model = event.model;
      if (event.type === 'tool_call') {
        finalText = null;
        const call = event.tool_call?.shellToolCall;
        const id = event.tool_call?.toolCallId;
        if (call?.args?.command && id) commandByCall.set(id, call.args);
        const operation = commandByCall.get(id);
        const command = call?.result?.rejected?.command ?? operation?.command;
        const directory = call?.result?.rejected?.workingDirectory ?? operation?.workingDirectory;
        let location = resolve(cwd, directory || '.');
        if (command) {
          try {
            location = await realpath(location);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        const key = command ? JSON.stringify([command, location]) : id;
        if (call?.result?.rejected) rejectedCommands.add(key ?? 'shell');
        if (call?.result?.success && key) rejectedCommands.delete(key);
        if (event.subtype === 'completed') commandByCall.delete(id);
      }
      if (event.type === 'assistant') finalText = assistantText(event);
      if (event.type === 'result') terminal = event;
      const permission =
        rejectedCommands.size > 0 ||
        /permission|approval|denied/iu.test(
          JSON.stringify(event.error ?? (event.is_error ? event.result : '')),
        );
      await onActivity?.({
        ...progress(event),
        phase: permission ? 'attention' : 'native-execution',
        ...(permission ? { code: 'E_ADAPTER_PERMISSION' } : {}),
      });
    },
    result(exitCode, errorOutput = '') {
      try {
        const result = nativeTurn({
          terminal: terminal
            ? {
                type: 'result',
                success: terminal.is_error === false && terminal.subtype === 'success',
              }
            : null,
          sessionId,
          expectedSessionId,
          exitCode,
          summary: finalText ?? terminal?.result,
          errorText: `${JSON.stringify({ error: terminal?.error ?? '', result: terminal?.is_error ? terminal?.result : '', api_error_status: terminal?.api_error_status })}\n${errorOutput}`,
          usage: terminal?.usage,
          model,
        });
        if (rejectedCommands.size || terminal?.permission_denials?.length) {
          result.status = 'blocked';
          result.diagnosticCode = 'E_ADAPTER_PERMISSION';
        }
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

  const observer = streamObserver(cwd, sessionId, onSessionId, onActivity, directory);
  const { exitCode, output } = await invokeProcess(
    profile.executable,
    [
      ...(profile.argv.length ? ['--model', profile.argv[1]] : []),
      '--print',
      '--output-format',
      'stream-json',
      '--trust',
      '--workspace',
      cwd,
      '--add-dir',
      directory,
      ...(sessionId ? ['--resume', sessionId] : []),
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
      retainStdout: false,
      onStdoutLine: observer.onLine,
    },
  ).catch(nativeFailure);
  return observer.result(exitCode, output);
}

export const cursorAdapter = Object.freeze({
  kind: 'cursor',
  async probe({ profile, cwd, env, signal, timeoutMs }) {
    const { destination } = executionConfiguration(env);
    const options = {
      cwd,
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10000, 10000),
      maxOutputBytes: 128 * 1024,
    };
    const help = await invokeProcess(profile.executable, ['--help'], options);
    if (
      !['--print', '--output-format', 'stream-json', '--resume', '--workspace', '--add-dir'].every(
        (flag) => help.includes(flag),
      )
    )
      throw new AdapterError(
        'E_ADAPTER_INCOMPATIBLE',
        'Cursor CLI lacks structured print, exact resume or capsule access; update the native agent CLI.',
      );
    const output = await invokeProcess(profile.executable, ['status', '--format', 'json'], {
      ...options,
      maxOutputBytes: 16 * 1024,
    });
    const auth = parseJson(output, 'E_ADAPTER_AUTHENTICATION');
    if (auth.isAuthenticated !== true)
      throw new AdapterError(
        'E_ADAPTER_AUTHENTICATION',
        'Run agent login in your normal terminal, then preview the same Cursor profile again.',
      );
    return {
      capabilities: NATIVE_CAPABILITIES,
      destination,
      executionPolicy: CURSOR_EXECUTION_POLICY,
    };
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
