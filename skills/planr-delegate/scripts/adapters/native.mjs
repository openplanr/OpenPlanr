// Native harnesses own execution policy. This layer records their observable turn.
import { readFile, stat } from 'node:fs/promises';
import { assertCredentialFreeText } from '../context.mjs';
import { AdapterError, destinationFromEndpoint, parseJson } from './generic.mjs';

export const NATIVE_CAPABILITIES = Object.freeze({
  implementation: true,
  nativeEvents: true,
  exactResume: true,
});
export const NATIVE_EXECUTION_POLICY = Object.freeze({
  configuration: 'trusted-native',
  permissions: 'native-managed',
  extensions:
    'Trusted native hooks, plugins and MCP may execute code or contact additional services. OpenPlanr does not sandbox these extensions.',
});
export const NATIVE_MANAGED_DESTINATION = Object.freeze({
  class: 'native-managed',
  origin: 'native-managed',
});

export async function readNativeConfig(path) {
  try {
    if ((await stat(path)).size > 64 * 1024) return null;
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    // Config diagnostics never replace the harness's own configuration loader.
    return null;
  }
}

export function knownDestination(endpoint) {
  if (!endpoint) return NATIVE_MANAGED_DESTINATION;
  try {
    return destinationFromEndpoint(endpoint);
  } catch {
    return NATIVE_MANAGED_DESTINATION;
  }
}

export function failureCode(text) {
  if (/Jinja Exception|System message must be at the beginning|chat template/iu.test(text))
    return 'E_ADAPTER_MODEL_TEMPLATE';
  if (/permission|requires approval|approval required|not allowed|denied by/iu.test(text))
    return 'E_ADAPTER_PERMISSION';
  if (
    /unauthorized|authentication|login required|not logged in|invalid.*(?:key|token)/iu.test(text)
  )
    return 'E_ADAPTER_AUTHENTICATION';
  if (/quota|rate.?limit|usage limit|credit/iu.test(text)) return 'E_ADAPTER_QUOTA';
  if (/model.*(?:not found|unavailable|not loaded)/iu.test(text))
    return 'E_ADAPTER_MODEL_UNAVAILABLE';
  return 'E_ADAPTER_EXIT';
}

export function nativeTurn({
  terminal,
  sessionId,
  expectedSessionId,
  exitCode,
  summary,
  usage,
  errorText = '',
  model,
}) {
  if (!sessionId && !terminal?.success) {
    const error = new AdapterError(
      failureCode(errorText),
      'Native execution failed before its session could be confirmed.',
    );
    if (expectedSessionId) error.sessionId = expectedSessionId;
    throw error;
  }
  if (!sessionId || (expectedSessionId && sessionId !== expectedSessionId))
    throw new AdapterError('E_ADAPTER_SESSION', 'The native turn has no matching exact session.');
  if (!terminal) {
    const error = new AdapterError(
      exitCode ? failureCode(errorText) : 'E_ADAPTER_RESULT',
      'Native execution ended without terminal evidence. Inspect the retained exact session.',
    );
    error.sessionId = sessionId;
    throw error;
  }
  const warnings = [];
  let text = typeof summary === 'string' ? summary : '';
  if (!text.trim())
    warnings.push('Native execution completed without a summary. Review the observed changes.');
  text = Buffer.from(text).subarray(0, 4000).toString('utf8');
  try {
    assertCredentialFreeText(text, { code: 'E_ADAPTER_RESULT', label: 'Native summary' });
  } catch {
    text = '';
    warnings.push('Native summary omitted because it contained credential material.');
  }
  const successful = exitCode === 0 && terminal.success;
  return {
    status: successful ? 'completed' : 'blocked',
    sessionId,
    summary: successful ? text || 'Native turn completed.' : 'Native execution needs attention.',
    completionEvidence: 'native-terminal',
    terminalEvidence: terminal.type,
    ...(exitCode || !terminal.success ? { diagnosticCode: failureCode(errorText || text) } : {}),
    ...(usage
      ? {
          usage: Object.fromEntries(
            Object.entries(usage).filter(
              ([key, value]) =>
                /^(?:input_tokens|output_tokens|cached_input_tokens|cache_read_input_tokens|cache_creation_input_tokens)$/u.test(
                  key,
                ) &&
                Number.isFinite(value) &&
                value >= 0,
            ),
          ),
        }
      : {}),
    ...(model ? { observedModel: model } : {}),
    warnings,
  };
}

export function nativeObserver(expectedSessionId, onSessionId, onActivity, observe) {
  let sessionId = null;
  return {
    async onLine(line) {
      try {
        const event = parseJson(line);
        if (!event || typeof event !== 'object' || Array.isArray(event))
          throw new AdapterError('E_ADAPTER_RESULT', 'Native CLI emitted an invalid event.');
        const id = event.session_id ?? (event.type === 'thread.started' ? event.thread_id : null);
        if (id) {
          if (
            typeof id !== 'string' ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id) ||
            (sessionId && sessionId !== id) ||
            (expectedSessionId && expectedSessionId !== id)
          )
            throw new AdapterError('E_ADAPTER_SESSION', 'Native CLI emitted a different session.');
          if (!sessionId) {
            sessionId = id;
            await onSessionId?.(id);
          }
        }
        const progress = await observe(event);
        await onActivity?.(progress);
      } catch (error) {
        if (sessionId && error instanceof AdapterError) error.sessionId = sessionId;
        throw error;
      }
    },
    session() {
      return sessionId;
    },
  };
}
