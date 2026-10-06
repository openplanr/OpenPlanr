// Native harnesses own execution policy. This layer records their observable turn.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { assertCredentialFreeText } from '../context.mjs';
import {
  AdapterError,
  destinationFromEndpoint,
  parseJson,
  validateDestination,
} from './generic.mjs';

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
  if (/model.*(?:not found|unavailable|not loaded|unloaded)/iu.test(text))
    return 'E_ADAPTER_MODEL_UNAVAILABLE';
  return 'E_ADAPTER_EXIT';
}

const NATIVE_REASONS = Object.freeze([
  [/model.*unloaded/iu, 'Model is unloaded.'],
  [/model.*not loaded/iu, 'Model is not loaded.'],
  [/model.*not found/iu, 'Model was not found.'],
  [/model.*unavailable/iu, 'Model is unavailable.'],
  [/not logged in/iu, 'Native CLI reported that it is not logged in.'],
  [/login required/iu, 'Native CLI requires login.'],
  [/unauthorized|authentication/iu, 'Native CLI reported an authentication failure.'],
  [/invalid.*(?:key|token)/iu, 'Native CLI rejected its configured credential.'],
  [
    /permission|requires approval|approval required|not allowed|denied by/iu,
    'Native permission requires attention.',
  ],
  [/quota|rate.?limit|usage limit|credit/iu, 'Native provider reported a quota or rate limit.'],
  [
    /Jinja Exception|System message must be at the beginning|chat template/iu,
    'Native backend rejected its chat template.',
  ],
]);

// Native output may echo prompts, commands or credentials. Retain recognized
// reasons and numeric status only; never persist arbitrary native error text.
export function nativeDiagnostic(text = '', exitCode) {
  const inspected = typeof text === 'string' ? text.slice(-64 * 1024) : '';
  const reason = NATIVE_REASONS.find(([pattern]) => pattern.test(inspected))?.[1];
  const status =
    /(?:api_error_status|status_code|http_status)["'\\\s:=]+([1-5]\d{2})\b|\bHTTP(?:\/\d(?:\.\d)?)?[\s:]+([1-5]\d{2})\b/iu.exec(
      inspected,
    );
  return {
    ...(reason ? { reason } : {}),
    ...(status ? { httpStatus: Number(status[1] ?? status[2]) } : {}),
    ...(Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? { exitCode } : {}),
  };
}

export function nativeFailure(error) {
  if (error instanceof AdapterError) {
    const details = nativeDiagnostic(error.details?.output, error.details?.exitCode);
    error.details = { nativeDiagnostic: details };
  }
  throw error;
}

export function safeNativeDiagnostic(value, destination) {
  const details = {
    ...(NATIVE_REASONS.some(([, reason]) => reason === value?.reason)
      ? { reason: value.reason }
      : {}),
    ...(Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
      ? { httpStatus: value.httpStatus }
      : {}),
    ...(Number.isInteger(value?.exitCode) && value.exitCode >= 0 && value.exitCode <= 255
      ? { exitCode: value.exitCode }
      : {}),
  };
  const known = knownDestination(destination?.origin);
  if (known.class !== 'native-managed') details.destination = known;
  return details;
}

const ROUTING_SOURCE =
  /^(?:parent environment|user settings|project settings|project local settings|managed file settings|managed fragment settings(?: \d{1,2})?)(?:: (?:ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|policyHelper))?$/u;

function safeRoutingDestination(value) {
  if (value?.class === 'native-managed' && value.origin === 'native-managed')
    return { class: 'native-managed', origin: 'native-managed' };
  try {
    return validateDestination(value);
  } catch {
    return null;
  }
}

function safeRoutingDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const result = {};
  for (const key of ['declaredDestination', 'effectiveDestination']) {
    const destination = safeRoutingDestination(details[key]);
    if (destination) result[key] = destination;
  }
  if (typeof details.source === 'string' && ROUTING_SOURCE.test(details.source))
    result.source = details.source;
  if (
    details.routing &&
    ['observed', 'native-managed', 'ambiguous'].includes(details.routing.state)
  ) {
    const sources = Array.isArray(details.routing.sources)
      ? details.routing.sources
          .filter((source) => typeof source === 'string' && ROUTING_SOURCE.test(source))
          .slice(0, 128)
      : [];
    const candidates = Array.isArray(details.routing.candidates)
      ? details.routing.candidates.slice(0, 64).flatMap((candidate) => {
          const destination = safeRoutingDestination(candidate);
          return destination &&
            typeof candidate.source === 'string' &&
            ROUTING_SOURCE.test(candidate.source)
            ? [{ source: candidate.source, ...destination }]
            : [];
        })
      : [];
    result.routing = {
      state: details.routing.state,
      sources,
      candidates,
      coverage: 'environment-and-file-settings',
    };
  }
  return result;
}

export function safeAdapterDetails(details, destination) {
  return {
    ...safeRoutingDetails(details),
    native: safeNativeDiagnostic(
      details?.nativeDiagnostic ?? nativeDiagnostic(details?.output, details?.exitCode),
      destination,
    ),
  };
}

function observablePath(value, roots) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    [...value].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    return null;
  try {
    assertCredentialFreeText(value, { code: 'E_ADAPTER_RESULT', label: 'Native path' });
  } catch {
    return null;
  }
  for (const [scope, root] of roots) {
    if (!root) continue;
    const path = relative(resolve(root), resolve(roots[0][1], value));
    if (path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
      return { scope, path: path.split(sep).join('/') };
  }
  return null;
}

function observedTool(name, state, input, roots) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u.test(name)) return null;
  try {
    assertCredentialFreeText(name, { code: 'E_ADAPTER_RESULT', label: 'Native tool name' });
  } catch {
    return null;
  }
  const files = [
    input?.file_path,
    input?.filePath,
    input?.path,
    input?.target_file,
    ...(Array.isArray(input?.changes)
      ? input.changes.slice(0, 6).map((change) => change?.path)
      : []),
  ]
    .map((value) => observablePath(value, roots))
    .filter(Boolean);
  return { name, state, ...(files.length ? { files: files.slice(0, 6) } : {}) };
}

function claudeToolBlocks(event) {
  if (event.type === 'stream_event' && event.event?.type === 'content_block_start')
    return [event.event.content_block];
  if (!Array.isArray(event.message?.content)) return [];
  return event.message.content.filter((block) => ['tool_use', 'tool_result'].includes(block?.type));
}

function claudeProgressBlock(event, block, roots, calls) {
  if (block?.type === 'tool_use') {
    const tool = observedTool(block.name, 'started', block.input, roots);
    if (tool && typeof block.id === 'string' && block.id.length <= 200) calls.set(block.id, tool);
    if (calls.size > 128) calls.delete(calls.keys().next().value);
    return tool;
  }
  if (event.type !== 'user' || block?.type !== 'tool_result' || !calls.has(block.tool_use_id))
    return null;
  const tool = { ...calls.get(block.tool_use_id), state: block.is_error ? 'failed' : 'completed' };
  calls.delete(block.tool_use_id);
  return tool;
}

function claudeProgressTool(event, roots, calls) {
  return claudeToolBlocks(event)
    .map((block) => claudeProgressBlock(event, block, roots, calls))
    .filter(Boolean);
}

function codexProgressTool(event, roots) {
  const item = event.item;
  if (!item) return null;
  const states = { 'item.started': 'started', 'item.completed': 'completed' };
  let state = states[event.type] ?? 'updated';
  if (
    state === 'completed' &&
    ((Number.isInteger(item.exit_code) && item.exit_code !== 0) || item.status === 'failed')
  )
    state = 'failed';
  const names = {
    command_execution: 'Command',
    file_change: 'FileChange',
    mcp_tool_call: item.tool,
  };
  return observedTool(names[item.type], state, item.type === 'file_change' ? item : null, roots);
}

function cursorProgressTool(event, roots) {
  if (event.type !== 'tool_call') return null;
  const key = [
    'readToolCall',
    'writeToolCall',
    'editToolCall',
    'shellToolCall',
    'globToolCall',
    'grepToolCall',
  ].find((key) => event.tool_call?.[key]);
  if (!key) return null;
  const call = event.tool_call[key];
  const state = call.result?.rejected
    ? 'failed'
    : event.subtype === 'completed'
      ? 'completed'
      : 'started';
  return observedTool(key.replace('ToolCall', ''), state, call.args, roots);
}

const OBSERVED_EVENTS = new Set([
  'system',
  'assistant',
  'user',
  'result',
  'stream_event',
  'tool_call',
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'item.started',
  'item.updated',
  'item.completed',
  'error',
]);

// Progress describes observed events, not an inferred agent state. Tool inputs,
// command output and arbitrary messages are excluded from the persisted record.
export function createNativeProgress(engine, { cwd, capsuleDirectory } = {}) {
  const roots = [
    ['worktree', cwd ?? '.'],
    ['capsule', capsuleDirectory],
  ];
  const calls = new Map();
  const observers = {
    claude: claudeProgressTool,
    codex: codexProgressTool,
    cursor: cursorProgressTool,
  };
  const observeTool = Object.hasOwn(observers, engine) ? observers[engine] : null;
  let events = 0,
    toolEvents = 0,
    latestTool = null;
  return (event) => {
    const observed = observeTool?.(event, roots, calls);
    const tools = Array.isArray(observed) ? observed : observed ? [observed] : [];
    events++;
    for (const tool of tools) {
      toolEvents++;
      latestTool = { ...tool, observedAt: new Date().toISOString() };
    }
    return {
      event: OBSERVED_EVENTS.has(event.type) ? event.type : 'unknown',
      eventCount: events,
      toolEventCount: toolEvents,
      ...(latestTool ? { latestTool } : {}),
    };
  };
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
  const diagnostic = nativeDiagnostic(errorText, exitCode);
  if (!sessionId && !terminal?.success) {
    const error = new AdapterError(
      failureCode(errorText),
      'Native execution failed before its session could be confirmed.',
      { nativeDiagnostic: diagnostic },
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
      { nativeDiagnostic: diagnostic },
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
    ...(exitCode || !terminal.success
      ? {
          diagnosticCode: failureCode(errorText || text),
          nativeDiagnostic: nativeDiagnostic(errorText || text, exitCode),
        }
      : {}),
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
