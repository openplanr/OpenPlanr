import { freezeJson } from './internal.mjs';

export const LIFECYCLE_RUNTIME_VERSION = '0.1.0';
export const LIFECYCLE_PROTOCOL_VERSION = '1.6.0';
export const LIFECYCLE_STATE_VERSION = '1.0.0';

function version(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value)) {
    throw new TypeError(`${label} must be an exact semantic version.`);
  }
  return value;
}

/** Decide whether persisted lifecycle state can be resumed by this runtime. */
export function assessLifecycleCompatibility({
  runtimeVersion = LIFECYCLE_RUNTIME_VERSION,
  protocolVersion = LIFECYCLE_PROTOCOL_VERSION,
  state = null,
} = {}) {
  const activeRuntime = version(runtimeVersion, 'runtimeVersion');
  const activeProtocol = version(protocolVersion, 'protocolVersion');
  if (state === null || state === undefined) {
    return freezeJson({
      status: 'compatible',
      mode: 'fresh',
      compatible: true,
      reasons: [],
      notice: 'No previous local skill state was selected.',
    });
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return freezeJson({
      status: 'fresh',
      mode: 'fresh',
      compatible: false,
      reasons: ['invalid-state'],
      notice: 'Started fresh because previous local skill state was invalid.',
    });
  }

  const reasons = [];
  if (state.stateVersion !== LIFECYCLE_STATE_VERSION) reasons.push('state-version');
  if (state.runtimeVersion !== activeRuntime) reasons.push('runtime-version');
  if (state.protocolVersion !== activeProtocol) reasons.push('protocol-version');
  const compatible = reasons.length === 0;
  return freezeJson({
    status: compatible ? 'compatible' : 'fresh',
    mode: compatible ? 'resume' : 'fresh',
    compatible,
    reasons,
    notice: compatible
      ? 'Previous local skill state is compatible.'
      : 'Started fresh because previous local skill state used an incompatible format.',
  });
}
