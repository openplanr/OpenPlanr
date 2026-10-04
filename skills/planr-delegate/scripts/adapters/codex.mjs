import { join } from 'node:path';
import { capsuleDirectory } from './capsule.mjs';
import { AdapterError, invokeProcess } from './generic.mjs';
import {
  createNativeProgress,
  knownDestination,
  NATIVE_CAPABILITIES,
  NATIVE_EXECUTION_POLICY,
  nativeFailure,
  nativeObserver,
  nativeTurn,
  readNativeConfig,
} from './native.mjs';

export async function resolveCodexDestination(profile, env) {
  if (env.OPENAI_BASE_URL) return knownDestination(env.OPENAI_BASE_URL);
  const config = await readNativeConfig(
    join(profile.configDir || env.CODEX_HOME || join(env.HOME ?? '', '.codex'), 'config.toml'),
  );
  // Config profiles, managed settings and automatic routing belong to Codex.
  const top = (config ?? '').split(/^\s*\[/mu)[0];
  const provider = /^\s*model_provider\s*=\s*["']([^"']+)["']/mu.exec(top)?.[1];
  if (!provider) return knownDestination();
  const sections = [
    ...config.matchAll(
      /^\s*\[model_providers\.(?:["']([^"']+)["']|([A-Za-z0-9_-]+))\]\s*([\s\S]*?)(?=^\s*\[|$)/gmu,
    ),
  ];
  const section = sections.find((match) => (match[1] ?? match[2]) === provider);
  const endpoint = section && /^\s*base_url\s*=\s*["']([^"']+)["']/mu.exec(section[3])?.[1];
  return knownDestination(endpoint);
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
  let terminal = null,
    summary = '',
    usage = null,
    errorText = '';
  let blockedByPermission = false;
  const progress = createNativeProgress('codex', { cwd, capsuleDirectory: directory });
  const observer = nativeObserver(sessionId, onSessionId, onActivity, (event) => {
    if (event.type === 'item.completed' && event.item?.type === 'agent_message')
      summary = event.item.text;
    if (['turn.completed', 'turn.failed'].includes(event.type) && terminal)
      throw new AdapterError('E_ADAPTER_RESULT', 'Codex emitted multiple terminal results.');
    if (event.type === 'turn.completed') {
      terminal = { type: event.type, success: true };
      usage = event.usage;
    }
    if (event.type === 'turn.failed') {
      terminal = { type: event.type, success: false };
      errorText = JSON.stringify(event.error ?? '');
    }
    if (event.type === 'error') errorText = event.message ?? event.error?.message ?? '';
    const command = event.item;
    if (
      command?.type === 'command_execution' &&
      command.exit_code &&
      /permission denied|read-only file system|approval required/iu.test(
        command.aggregated_output ?? '',
      )
    )
      blockedByPermission = true;
    const permission = blockedByPermission || /permission|approval|denied/iu.test(errorText);
    return {
      ...progress(event),
      phase: permission ? 'attention' : 'native-execution',
      ...(permission ? { code: 'E_ADAPTER_PERMISSION' } : {}),
    };
  });
  const args = [
    ...profile.argv,
    'exec',
    ...(sessionId ? ['resume'] : []),
    '--json',
    ...(!sessionId ? ['--add-dir', directory] : []),
    ...(sessionId ? [sessionId] : []),
    '-',
  ];
  const { exitCode, output } = await invokeProcess(profile.executable, args, {
    cwd,
    env,
    input: prompt,
    signal,
    timeoutMs: timeoutMs ?? null,
    onProcess,
    onStdoutLine: observer.onLine,
    retainStdout: false,
    withExitCode: true,
    captureStderr: true,
    maxOutputBytes: 8 * 1024 * 1024,
  }).catch(nativeFailure);
  const result = nativeTurn({
    terminal,
    sessionId: observer.session() ?? sessionId,
    expectedSessionId: sessionId,
    exitCode,
    summary,
    usage,
    errorText: `${errorText}\n${output}`,
  });
  if (
    blockedByPermission ||
    /(?:implementation|editing|writing) is blocked[^.\n]{0,180}(?:read.only|only filesystem reads)|(?:cannot|unable to) (?:write|edit)[^.\n]{0,180}read.only/iu.test(
      summary,
    )
  ) {
    result.status = 'blocked';
    result.diagnosticCode = 'E_ADAPTER_PERMISSION';
  }
  return result;
}

export const codexAdapter = Object.freeze({
  kind: 'codex',
  async probe({ profile, env, signal, timeoutMs }) {
    const output = await invokeProcess(profile.executable, ['exec', '--help'], {
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10000, 10000),
      maxOutputBytes: 128 * 1024,
    });
    if (!['--json', 'resume', '--add-dir'].every((flag) => output.includes(flag)))
      throw new AdapterError(
        'E_ADAPTER_INCOMPATIBLE',
        'Codex CLI lacks native events, worktree access or exact resume. Update it.',
      );
    return {
      capabilities: NATIVE_CAPABILITIES,
      destination: await resolveCodexDestination(profile, env),
      executionPolicy: NATIVE_EXECUTION_POLICY,
    };
  },
  run: execute,
  resume(args) {
    if (!args.sessionId)
      throw new AdapterError('E_ADAPTER_SESSION', 'Exact Codex session is required.');
    return execute(args);
  },
});
