// Local probes are diagnostics; native CLI execution remains authoritative.

import { readClaudeSettingsEnvironment, resolveClaudeRouting } from './adapters/claude.mjs';
import { AdapterError, validateDestination } from './adapters/generic.mjs';

async function localProbeToken(profile, env, cwd) {
  const sources = [{ source: 'parent environment', env }];
  if (profile.kind === 'claude')
    sources.push(...(await readClaudeSettingsEnvironment(profile, env, cwd)));
  for (const name of ['LM_STUDIO_API_KEY', 'LM_API_TOKEN', 'ANTHROPIC_AUTH_TOKEN']) {
    const candidates = sources.filter(
      (source) => source.env[name] !== undefined && source.env[name] !== '',
    );
    if (!candidates.length) continue;
    const values = candidates.map((source) => source.env[name]);
    if (
      values.some(
        (value) => typeof value !== 'string' || value.length >= 4096 || /[\r\n]/u.test(value),
      ) ||
      new Set(values).size !== 1
    )
      throw new AdapterError(
        'E_BACKEND_AUTH_CONFIG',
        'Local metadata authentication could not be confirmed.',
        {
          sources: candidates.map((source) => `${source.source}: ${name}`),
        },
      );
    return values[0];
  }
  return null;
}

async function withinDeadline(operation, signal) {
  if (signal.aborted)
    throw new AdapterError('E_BACKEND_TIMEOUT', 'Local model metadata inspection timed out.');
  let abort;
  const deadline = new Promise((_, reject) => {
    abort = () =>
      reject(new AdapterError('E_BACKEND_TIMEOUT', 'Local model metadata inspection timed out.'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function boundedJson(response, signal) {
  if (!response.ok || !response.body)
    throw new AdapterError('E_BACKEND_RESPONSE', 'Backend did not return a model JSON response.', {
      httpStatus: response.status,
    });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await withinDeadline(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        void reader.cancel().catch(() => {});
        throw new AdapterError(
          'E_BACKEND_RESPONSE_SIZE',
          'Backend model metadata exceeds the inspection limit.',
        );
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(
      'E_BACKEND_RESPONSE',
      'Backend model metadata could not be parsed or read.',
      { cause: error.code ?? error.name },
    );
  }
}

export async function inspectLocalBackend(
  profile,
  { fetchImpl = fetch, timeoutMs = 2000, env = process.env, cwd } = {},
) {
  const selectedModel =
    profile.argv[0] === '--model' || profile.argv[0] === '-m' ? profile.argv[1] : null;
  if (profile.destination.class !== 'local') {
    return { status: 'not-checked', modelStatus: 'not-checked', selectedModel, visibleModels: [] };
  }
  validateDestination(profile.destination);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    throw new AdapterError(
      'E_PROFILE_INVALID',
      'Backend probe timeout must be at most five seconds.',
    );
  }
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  try {
    let token;
    try {
      if (profile.kind === 'claude') {
        const resolved = await resolveClaudeRouting(profile, env, cwd);
        if (
          resolved.destination.class !== 'local' ||
          resolved.destination.origin !== profile.destination.origin
        )
          throw new AdapterError(
            'E_DESTINATION_CHANGED',
            'Local metadata routing differs from the prepared destination.',
            {
              effectiveDestination: resolved.destination,
              routing: resolved.routing,
            },
          );
      }
      token = await localProbeToken(profile, env, cwd);
    } catch (error) {
      return {
        status: 'not-checked',
        modelStatus: 'unverified',
        selectedModel,
        visibleModels: [],
        diagnostic: { code: error.code ?? 'E_BACKEND_AUTH_CONFIG', ...error.details },
      };
    }
    const readModels = async (path) => {
      const response = await withinDeadline(
        fetchImpl(new URL(path, profile.destination.origin), {
          method: 'GET',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          signal,
          redirect: 'error',
        }),
        signal,
      );
      return {
        response,
        parsed: response.ok && response.body ? await boundedJson(response, signal) : null,
      };
    };
    let response;
    let parsed;
    try {
      ({ response, parsed } = await readModels('/v1/models'));
    } catch (error) {
      return {
        status: error.code?.startsWith('E_BACKEND_RESPONSE') ? 'reachable' : 'unreachable',
        modelStatus: error.code?.startsWith('E_BACKEND_RESPONSE') ? 'unverified' : 'unknown',
        selectedModel,
        visibleModels: [],
        diagnostic: {
          code: error.code ?? 'E_BACKEND_UNREACHABLE',
          cause: error.name,
          ...error.details,
        },
        metadataLatencyMs: Math.round(performance.now() - startedAt),
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        status: 'authentication-required',
        modelStatus: 'unknown',
        selectedModel,
        visibleModels: [],
        diagnostic: { code: 'E_BACKEND_AUTHENTICATION', httpStatus: response.status },
        metadataLatencyMs: Math.round(performance.now() - startedAt),
      };
    }
    const listedModels = (Array.isArray(parsed?.data) ? parsed.data : [])
      .map((entry) => entry?.id)
      .filter(
        (id) =>
          typeof id === 'string' &&
          id.length <= 256 &&
          [...id].every((character) => character.codePointAt(0) >= 32),
      );
    let modelListed = selectedModel ? listedModels.includes(selectedModel) : false;
    let listingSupported = Array.isArray(parsed?.data);
    const visibleModels = listedModels.slice(0, 32);
    let loadStatus = 'unverified';
    let contextLength = null;
    let diagnostic;
    if (selectedModel) {
      try {
        const { response: nativeResponse, parsed: native } = await readModels('/api/v1/models');
        if (!nativeResponse.ok)
          throw new AdapterError(
            'E_BACKEND_NATIVE_UNAVAILABLE',
            'Native model metadata is unavailable.',
            { httpStatus: nativeResponse.status },
          );
        if (Array.isArray(native?.models)) {
          listingSupported = true;
          const model = native.models.find(
            (entry) =>
              entry?.key === selectedModel ||
              entry?.loaded_instances?.some((instance) => instance?.id === selectedModel),
          );
          if (model && Array.isArray(model.loaded_instances)) {
            modelListed = true;
            const instances =
              model.key === selectedModel
                ? model.loaded_instances
                : model.loaded_instances.filter((instance) => instance?.id === selectedModel);
            loadStatus = instances.length ? 'loaded' : 'not-loaded';
            const capacities = instances
              .map((instance) => instance?.config?.context_length)
              .filter((value) => Number.isSafeInteger(value) && value > 0 && value <= 4_194_304);
            if (capacities.length === instances.length && capacities.length)
              contextLength = Math.min(...capacities);
            if (!visibleModels.includes(selectedModel)) visibleModels.unshift(selectedModel);
            visibleModels.splice(32);
          }
        }
      } catch (error) {
        diagnostic = {
          code: error.code ?? 'E_BACKEND_NATIVE_UNAVAILABLE',
          cause: error.code ? undefined : error.name,
          ...error.details,
        };
      }
    }
    return {
      status: 'reachable',
      selectedModel,
      modelStatus: selectedModel
        ? modelListed
          ? 'visible'
          : listingSupported
            ? 'not-listed'
            : 'unverified'
        : 'unspecified',
      loadStatus,
      contextLength,
      visibleModels,
      metadataLatencyMs: Math.round(performance.now() - startedAt),
      ...(diagnostic ? { diagnostic } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function profileReadiness(destination, backend) {
  if (destination.class !== 'local') {
    return {
      state: 'unverified',
      dispatchable: true,
      nextAction: 'External provider health is not checked by this probe.',
    };
  }
  if (backend.status === 'unreachable') {
    return {
      state: 'server-unreachable',
      dispatchable: false,
      nextAction: 'Start the selected local model server and probe again.',
    };
  }
  if (backend.status === 'authentication-required') {
    return {
      state: 'authentication-required',
      dispatchable: false,
      nextAction:
        'Provide the local server token through an allowed environment variable, then probe again.',
    };
  }
  if (backend.modelStatus === 'not-listed') {
    return {
      state: 'model-unavailable',
      dispatchable: false,
      nextAction: 'Make the selected model available or explicitly select a different model.',
    };
  }
  if (backend.loadStatus === 'not-loaded') {
    return {
      state: 'model-not-loaded',
      dispatchable: false,
      nextAction: 'Load the selected model in its local runtime and probe again.',
    };
  }
  if (backend.loadStatus === 'loaded') return { state: 'ready', dispatchable: true };
  return {
    state: 'unverified',
    dispatchable: true,
    nextAction: 'Model load state could not be confirmed; dispatch may still fail.',
  };
}
