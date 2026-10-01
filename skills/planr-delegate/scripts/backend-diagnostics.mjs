// Local probes are diagnostics; native CLI execution remains authoritative.
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AdapterError } from './adapters/generic.mjs';

async function localProbeToken(profile, env) {
  const direct = env.LM_STUDIO_API_KEY ?? env.LM_API_TOKEN ?? env.ANTHROPIC_AUTH_TOKEN;
  if (
    typeof direct === 'string' &&
    direct.length > 0 &&
    direct.length < 4096 &&
    !/[\r\n]/u.test(direct)
  )
    return direct;
  if (profile.kind !== 'claude' || !profile.configDir) return null;
  try {
    const path = join(profile.configDir, 'settings.json');
    if ((await stat(path)).size > 64 * 1024)
      throw new AdapterError(
        'E_PROFILE_SIZE',
        'Local authentication settings exceed the inspection limit.',
      );
    const settings = JSON.parse(
      await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).then(async (handle) => {
        try {
          return await handle.readFile('utf8');
        } finally {
          await handle.close();
        }
      }),
    );
    const token = settings?.env?.LM_API_TOKEN ?? settings?.env?.ANTHROPIC_AUTH_TOKEN;
    return typeof token === 'string' &&
      token.length > 0 &&
      token.length < 4096 &&
      !/[\r\n]/u.test(token)
      ? token
      : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(
      'E_PROFILE_CONFIG_READ',
      'Local authentication settings could not be read.',
      { cause: error.code ?? error.name },
    );
  }
}

async function boundedJson(response) {
  if (!response.ok || !response.body)
    throw new AdapterError('E_BACKEND_RESPONSE', 'Backend did not return a model JSON response.', {
      httpStatus: response.status,
    });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new AdapterError(
          'E_BACKEND_RESPONSE_SIZE',
          'Backend model metadata exceeds the inspection limit.',
        );
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
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
  { fetchImpl = fetch, timeoutMs = 2000, env = process.env } = {},
) {
  const selectedModel =
    profile.argv[0] === '--model' || profile.argv[0] === '-m' ? profile.argv[1] : null;
  if (profile.destination.class !== 'local') {
    return { status: 'not-checked', modelStatus: 'not-checked', selectedModel, visibleModels: [] };
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    throw new AdapterError(
      'E_PROFILE_INVALID',
      'Backend probe timeout must be at most five seconds.',
    );
  }
  const token = await localProbeToken(profile, env);
  let response;
  try {
    response = await fetchImpl(new URL('/v1/models', profile.destination.origin), {
      method: 'GET',
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch (error) {
    return {
      status: 'unreachable',
      modelStatus: 'unknown',
      selectedModel,
      visibleModels: [],
      diagnostic: { code: 'E_BACKEND_UNREACHABLE', cause: error.code ?? error.name },
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      status: 'authentication-required',
      modelStatus: 'unknown',
      selectedModel,
      visibleModels: [],
    };
  }
  if (!response.ok || !response.body) {
    return { status: 'reachable', modelStatus: 'unverified', selectedModel, visibleModels: [] };
  }
  let parsed;
  try {
    parsed = await boundedJson(response);
  } catch (error) {
    return {
      status: 'reachable',
      modelStatus: 'unverified',
      selectedModel,
      visibleModels: [],
      diagnostic: { code: error.code, ...error.details },
    };
  }
  if (!Array.isArray(parsed?.data)) {
    return { status: 'reachable', modelStatus: 'unverified', selectedModel, visibleModels: [] };
  }
  const visibleModels = parsed.data
    .map((entry) => entry?.id)
    .filter((id) => typeof id === 'string' && id.length <= 256)
    .slice(0, 32);
  let loadStatus = 'unverified';
  let contextLength = null;
  let diagnostic;
  if (selectedModel && visibleModels.includes(selectedModel)) {
    try {
      const nativeResponse = await fetchImpl(
        new URL('/api/v1/models', profile.destination.origin),
        {
          method: 'GET',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        },
      );
      const native = await boundedJson(nativeResponse);
      if (Array.isArray(native?.models)) {
        const model = native.models.find(
          (entry) =>
            entry?.key === selectedModel ||
            entry?.loaded_instances?.some((instance) => instance?.id === selectedModel),
        );
        if (model && Array.isArray(model.loaded_instances)) {
          loadStatus = model.loaded_instances.length ? 'loaded' : 'not-loaded';
          const capacities = model.loaded_instances
            .map((instance) => instance?.config?.context_length)
            .filter((value) => Number.isSafeInteger(value) && value > 0 && value <= 4_194_304);
          if (capacities.length === model.loaded_instances.length && capacities.length)
            contextLength = Math.min(...capacities);
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
      ? visibleModels.includes(selectedModel)
        ? 'visible'
        : 'not-listed'
      : 'unspecified',
    loadStatus,
    contextLength,
    visibleModels,
    ...(diagnostic ? { diagnostic } : {}),
  };
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
