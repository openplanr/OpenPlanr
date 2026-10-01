import { join } from 'node:path';
import { capsuleDirectory } from './capsule.mjs';
import { AdapterError, invokeProcess } from './generic.mjs';
import {
  knownDestination,
  NATIVE_CAPABILITIES,
  NATIVE_EXECUTION_POLICY,
  nativeObserver,
  nativeTurn,
  readNativeConfig,
} from './native.mjs';

export async function resolveClaudeDestination(profile, env, cwd) {
  if (env.ANTHROPIC_BASE_URL) return knownDestination(env.ANTHROPIC_BASE_URL);
  if (
    ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(
      (key) => env[key] && env[key] !== '0',
    )
  )
    return knownDestination();
  const paths = [
    join(
      profile.configDir || env.CLAUDE_CONFIG_DIR || join(env.HOME ?? '', '.claude'),
      'settings.json',
    ),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
  const endpoints = [];
  for (const path of paths) {
    const text = await readNativeConfig(path);
    try {
      const settings = JSON.parse(text);
      if (settings?.env?.ANTHROPIC_BASE_URL) endpoints.push(settings.env.ANTHROPIC_BASE_URL);
    } catch {
      /* The native loader reports configuration errors. */
    }
  }
  return endpoints.length === 1 ? knownDestination(endpoints[0]) : knownDestination();
}

export function parseClaudeOutput(envelope, expectedSessionId, exitCode = 0) {
  return nativeTurn({
    terminal: envelope
      ? { type: 'result', success: envelope.is_error !== true && envelope.subtype === 'success' }
      : null,
    sessionId: envelope?.session_id,
    expectedSessionId,
    exitCode,
    summary: envelope?.result,
    usage: envelope?.usage,
    errorText: JSON.stringify([envelope?.errors ?? [], envelope?.is_error ? envelope?.result : '']),
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
    return denied
      ? { phase: 'attention', code: 'E_ADAPTER_PERMISSION' }
      : { phase: event.type === 'result' ? 'completed' : 'native-execution' };
  });
  const { exitCode } = await invokeProcess(
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
      onStdoutLine: observer.onLine,
      retainStdout: false,
    },
  );
  const result = parseClaudeOutput(terminal, sessionId ?? observer.session(), exitCode);
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
    return {
      capabilities: NATIVE_CAPABILITIES,
      destination: await resolveClaudeDestination(profile, env, cwd),
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
