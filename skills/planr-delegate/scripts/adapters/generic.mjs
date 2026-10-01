import { execFile as execFileCallback, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { processIdentity, processIdentityState } from '../run-record.mjs';

export const ADAPTER_PROTOCOL = 'openplanr.delegate.adapter';
export const ADAPTER_VERSION = 1;
export const CAPABILITIES = Object.freeze({
  implementation: true,
  structuredResult: true,
  exactResume: true,
});

export class AdapterError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    if (details) this.details = details;
  }
}

// Cancel the entire detached process group, including commands launched by the
// engine. Verify the leader identity first so recovery never kills a reused PID.
export async function terminateProcessGroup(identity, { graceMs = 100 } = {}) {
  if (!identity?.pid) return;
  const state = await processIdentityState(identity);
  if (state === 'reused') return;
  if (state === 'unknown')
    throw new AdapterError(
      'E_ADAPTER_PROCESS_IDENTITY',
      'Delegate process identity cannot be verified for cancellation.',
    );
  const target = process.platform === 'win32' ? identity.pid : -(identity.pgid ?? identity.pid);
  const send = async (signal) => {
    try {
      process.kill(target, signal);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      if (error.code === 'EPERM' && process.platform !== 'win32') {
        // macOS can report EPERM for a group consisting only of zombies.
        // Ignore it only after proving there are no live writers in that group.
        const { stdout } = await promisify(execFileCallback)('ps', ['-axo', 'pgid=,stat='], {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        });
        const members = stdout
          .trim()
          .split('\n')
          .map((line) => line.trim().split(/\s+/u))
          .filter(([group]) => Number(group) === -target);
        if (members.every(([, status]) => status.startsWith('Z'))) return;
      }
      throw error;
    }
  };
  await send('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  const after = await processIdentityState(identity);
  if (after !== 'reused') await send('SIGKILL');
}

// Task text uses stdin; each line is bounded and observed with stream backpressure.
export function invokeProcess(executable, args, options = {}) {
  const {
    cwd,
    env,
    input = '',
    signal,
    timeoutMs = 120_000,
    maxOutputBytes = 1024 * 1024,
    withExitCode = false,
    captureStderr = false,
    onStdoutLine,
    onProcess,
    retainStdout = true,
  } = options;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
    throw new AdapterError('E_ADAPTER_ARGUMENTS', 'Adapter arguments must be an array of strings.');
  if (
    timeoutMs !== null &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4 * 3_600_000)
  )
    throw new AdapterError('E_ADAPTER_TIMEOUT', 'Adapter timeout is outside the allowed range.');
  if (!retainStdout && typeof onStdoutLine !== 'function')
    throw new AdapterError('E_ADAPTER_ARGUMENTS', 'Streaming output requires a line observer.');
  if (
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 8 * 1024 * 1024
  )
    throw new AdapterError(
      'E_ADAPTER_OUTPUT_LIMIT',
      'Adapter output limit is outside the allowed range.',
    );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    const decoder = new StringDecoder('utf8');
    let pendingLine = '';
    let lineWork = Promise.resolve();
    let bytes = 0;
    let failure = null;
    let identity = null;
    let launchWork = Promise.resolve();
    let spawnedResolve;
    const spawned = new Promise((resolve) => {
      spawnedResolve = resolve;
    });
    let stopping = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const stop = (error) => {
      failure ??= error;
      stopping ??= (async () => {
        if (!(await spawned)) return;
        await launchWork;
        if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
        const leader = identity ?? (await processIdentity(child.pid));
        if (leader) await terminateProcessGroup({ ...leader, pgid: child.pid });
      })();
      // Drain after cancellation so an engine waiting on a full pipe can exit.
      child.stdout.resume();
    };
    const consumeLines = async (text, final = false) => {
      if (!onStdoutLine || failure) return;
      pendingLine += text;
      const lines = pendingLine.split(/\r?\n/u);
      const tail = lines.pop();
      pendingLine = final ? '' : tail;
      if (final && tail) lines.push(tail);
      for (const line of lines) {
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > maxOutputBytes)
          throw new AdapterError('E_ADAPTER_OUTPUT_LIMIT', 'Adapter event exceeded its limit.');
        await onStdoutLine(line);
      }
      if (Buffer.byteLength(pendingLine) > maxOutputBytes)
        throw new AdapterError('E_ADAPTER_OUTPUT_LIMIT', 'Adapter event exceeded its limit.');
    };
    const abort = () => stop(new AdapterError('E_ADAPTER_CANCELLED', 'Adapter run was cancelled.'));
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(
            () => stop(new AdapterError('E_ADAPTER_TIMEOUT', 'Adapter exceeded its time limit.')),
            timeoutMs,
          );
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => {
      spawnedResolve(false);
      const reported = new AdapterError('E_ADAPTER_LAUNCH', 'Adapter executable could not start.');
      reported.details = { reason: error.code ?? 'unknown' };
      finish(reported);
    });
    child.on('spawn', () => {
      launchWork = (async () => {
        identity = await processIdentity(child.pid);
        // Very short commands can exit before inspection; their spawned group is
        // still owned and must be drained before candidate acceptance.
        identity ??= { pid: child.pid, started: new Date().toISOString(), source: 'owned-spawn' };
        if (identity) {
          identity = { ...identity, pgid: child.pid };
          await onProcess?.(identity);
        }
        if (signal?.aborted) abort();
        if (!failure) child.stdin.end(input);
      })().catch(stop);
      spawnedResolve(true);
    });
    child.stdout.on('data', (chunk) => {
      if (retainStdout) bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        stop(new AdapterError('E_ADAPTER_OUTPUT_LIMIT', 'Adapter output exceeded its limit.'));
        return;
      }
      if (retainStdout) stdout.push(chunk);
      child.stdout.pause();
      const text = decoder.write(chunk);
      lineWork = lineWork
        .then(async () => {
          await launchWork;
          await consumeLines(text);
        })
        .catch(stop)
        .finally(() => child.stdout.resume());
    });
    if (captureStderr) {
      child.stderr.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxOutputBytes)
          stop(new AdapterError('E_ADAPTER_OUTPUT_LIMIT', 'Adapter output exceeded its limit.'));
        else stderr.push(chunk);
      });
    } else child.stderr.resume();
    child.on('exit', () => {
      stopping ??= launchWork.then(() => (identity ? terminateProcessGroup(identity) : undefined));
    });
    child.on('close', (code, exitSignal) => {
      void (async () => {
        await launchWork;
        await lineWork;
        await consumeLines(decoder.end(), true);
        if (stopping) await stopping;
        else if (identity) await terminateProcessGroup(identity);
        const output = Buffer.concat([...stdout, ...stderr]).toString('utf8');
        if (failure) {
          failure.details = {
            ...failure.details,
            output: output.slice(-4096),
            exitCode: code,
            signal: exitSignal,
          };
          finish(failure);
          return;
        }
        if (code !== 0 && !withExitCode) {
          const error = new AdapterError('E_ADAPTER_EXIT', 'Adapter exited unsuccessfully.');
          error.details = { exitCode: code, signal: exitSignal, output: output.slice(-4096) };
          finish(error);
        } else {
          finish(null, withExitCode ? { output, exitCode: code, signal: exitSignal } : output);
        }
      })().catch((error) => {
        error.processTerminationConfirmed = false;
        error.ownedProcess = identity;
        finish(error);
      });
    });
    // EPIPE is expected if an engine exits before consuming stdin; other errors
    // are surfaced rather than silently discarding broken communication.
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') stop(error);
    });
    if (signal?.aborted) abort();
  });
}

export function parseJson(text, code = 'E_ADAPTER_RESULT') {
  try {
    return JSON.parse(text);
  } catch {
    throw new AdapterError(code, 'Adapter returned malformed structured output.');
  }
}

export function extractTerminalJsonObject(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 64 * 1024) {
    throw new AdapterError('E_ADAPTER_RESULT', 'Agent final result is missing or oversized.');
  }
  const trimmed = text.trim();
  try {
    return parseJson(trimmed);
  } catch {
    // Some tool-capable agents insist on a final Markdown JSON fence. Accept
    // only one terminal fence, with no other object or fence in the preface.
    const fenced = trimmed.match(/^([\s\S]*?)```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/u);
    if (fenced) {
      const [, prefix, body] = fenced;
      if (
        Buffer.byteLength(prefix, 'utf8') > 4096 ||
        /[{}[\]]|```/u.test(prefix) ||
        body.includes('```')
      ) {
        throw new AdapterError(
          'E_ADAPTER_RESULT',
          'Agent did not return one terminal JSON object.',
        );
      }
      const value = parseJson(body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AdapterError('E_ADAPTER_RESULT', 'Agent terminal result must be one object.');
      }
      return value;
    }
    // A short narrative may precede one complete terminal object. The
    // remainder must parse in full; a second object fails closed.
    const first = trimmed.indexOf('{');
    const prefix = trimmed.slice(0, first);
    if (first < 1 || first > 4096 || /[{}[\]`]/u.test(prefix)) {
      throw new AdapterError('E_ADAPTER_RESULT', 'Agent did not return one terminal JSON object.');
    }
    const value = parseJson(trimmed.slice(first));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AdapterError('E_ADAPTER_RESULT', 'Agent terminal result must be one object.');
    }
    return value;
  }
}

export function validateDestination(value) {
  if (!value || !['local', 'external'].includes(value.class) || typeof value.origin !== 'string') {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Adapter did not report a usable data destination.',
    );
  }
  let url;
  try {
    url = new URL(value.origin);
  } catch {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Adapter reported an invalid data destination.',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Adapter reported an unsafe data destination.');
  }
  if (value.class === 'local' && !loopback) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Local destination must be a loopback origin.');
  }
  if (value.class === 'external' && loopback) {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'External destination cannot be loopback.');
  }
  return { class: value.class, origin: url.origin };
}

export function destinationFromEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AdapterError('E_DESTINATION_UNKNOWN', 'Effective data endpoint is invalid.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AdapterError(
      'E_DESTINATION_UNKNOWN',
      'Effective data endpoint contains credentials or query data.',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return validateDestination({
    class: local ? 'local' : 'external',
    origin: url.origin,
  });
}

export function normalizeResult(value) {
  if (!value || !['completed', 'blocked', 'question'].includes(value.status)) {
    throw new AdapterError('E_ADAPTER_RESULT', 'Adapter did not return a terminal status.');
  }
  if (
    typeof value.sessionId !== 'string' ||
    !value.sessionId.trim() ||
    value.sessionId.length > 256
  ) {
    throw new AdapterError(
      'E_ADAPTER_RESULT',
      'Adapter did not return an exact session identifier.',
    );
  }
  if (
    value.status === 'question' &&
    (typeof value.question?.text !== 'string' || !value.question.text.trim())
  ) {
    throw new AdapterError('E_ADAPTER_RESULT', 'Adapter question is missing its text.');
  }
  if (value.status === 'blocked' && (typeof value.summary !== 'string' || !value.summary.trim())) {
    throw new AdapterError('E_ADAPTER_RESULT', 'Adapter blocker is missing its reason.');
  }
  return {
    status: value.status,
    sessionId: value.sessionId,
    summary: typeof value.summary === 'string' ? value.summary : '',
    ...(value.status === 'question'
      ? {
          question: {
            text: value.question.text,
            ...(Array.isArray(value.question.options)
              ? {
                  options: value.question.options
                    .filter((item) => typeof item === 'string')
                    .slice(0, 8),
                }
              : {}),
          },
        }
      : {}),
    checks: Array.isArray(value.checks)
      ? value.checks.filter((item) => typeof item === 'string')
      : [],
    issues: Array.isArray(value.issues)
      ? value.issues.filter((item) => typeof item === 'string')
      : [],
  };
}

function protocolOutput(value, operation) {
  if (value?.protocol !== ADAPTER_PROTOCOL || value.version !== ADAPTER_VERSION) {
    throw new AdapterError(
      'E_ADAPTER_INCOMPATIBLE',
      `Adapter ${operation} requires a version 1 wrapper.`,
    );
  }
  return value;
}

function packet(operation, fields) {
  return JSON.stringify({
    protocol: ADAPTER_PROTOCOL,
    version: ADAPTER_VERSION,
    operation,
    ...fields,
  });
}

export const genericAdapter = Object.freeze({
  kind: 'generic',
  async probe({ profile, cwd, env, signal, timeoutMs }) {
    const output = await invokeProcess(profile.executable, [...profile.argv, '--planr-probe'], {
      cwd,
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10_000, 10_000),
      maxOutputBytes: 16 * 1024,
    });
    const result = protocolOutput(parseJson(output, 'E_ADAPTER_INCOMPATIBLE'), 'probe');
    if (!Object.keys(CAPABILITIES).every((key) => result.capabilities?.[key] === true)) {
      throw new AdapterError(
        'E_ADAPTER_INCOMPATIBLE',
        'Adapter needs a tool-capable version 1 wrapper with structured result and exact resume.',
      );
    }
    return {
      capabilities: CAPABILITIES,
      destination: validateDestination(result.destination),
    };
  },
  async run({ profile, cwd, prompt, capsulePath, env, signal, timeoutMs, onProcess }) {
    const output = await invokeProcess(profile.executable, [...profile.argv, '--planr-run'], {
      cwd,
      env,
      signal,
      timeoutMs,
      onProcess,
      input: packet('run', { prompt, cwd, ...(capsulePath ? { capsulePath } : {}) }),
    });
    return normalizeResult(protocolOutput(parseJson(output), 'run'));
  },
  async resume({
    profile,
    cwd,
    prompt,
    capsulePath,
    sessionId,
    env,
    signal,
    timeoutMs,
    onProcess,
  }) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new AdapterError(
        'E_ADAPTER_SESSION',
        'Exact session identifier is required for resume.',
      );
    }
    const output = await invokeProcess(profile.executable, [...profile.argv, '--planr-resume'], {
      cwd,
      env,
      signal,
      timeoutMs,
      onProcess,
      input: packet('resume', { prompt, cwd, sessionId, ...(capsulePath ? { capsulePath } : {}) }),
    });
    const result = normalizeResult(protocolOutput(parseJson(output), 'resume'));
    if (result.sessionId !== sessionId) {
      throw new AdapterError('E_ADAPTER_SESSION', 'Adapter resumed a different session.');
    }
    return result;
  },
});
