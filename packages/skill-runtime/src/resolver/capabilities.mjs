import { SkillRuntimeError } from '../errors.mjs';

export const CAPABILITY_STATES = Object.freeze(['available', 'unavailable', 'denied']);
export const RESOLUTION_STATUSES = Object.freeze([
  'completed',
  'unavailable',
  'denied',
  'cancelled',
  'blocked',
]);

const STATUS_SET = new Set(CAPABILITY_STATES);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function fail(code, message, details = {}) {
  throw new SkillRuntimeError(code, message, details);
}

function identifierList(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    fail('E_SKILL_CAPABILITY_INPUT_INVALID', `${label} must be an array of capability IDs.`, { label });
  }
  const unique = [...new Set(value)];
  if (unique.length !== value.length) {
    fail('E_SKILL_CAPABILITY_INPUT_INVALID', `${label} contains a duplicate capability ID.`, { label });
  }
  return unique;
}

function normalizeReport(runtimeCapabilities, capabilityId) {
  const reported = runtimeCapabilities[capabilityId];
  if (reported === undefined) {
    return { state: 'unavailable', source: 'runtime-report:missing' };
  }
  const state = typeof reported === 'string' ? reported : reported?.state;
  const source = typeof reported === 'object' && reported !== null
    ? reported.source ?? `runtime-report:${capabilityId}`
    : `runtime-report:${capabilityId}`;
  if (!STATUS_SET.has(state) || typeof source !== 'string' || source.length === 0) {
    fail(
      'E_SKILL_CAPABILITY_REPORT_INVALID',
      `Runtime capability ${capabilityId} must report available, unavailable, or denied with an optional source.`,
      { capabilityId, reported },
    );
  }
  return { state, source };
}

function diagnostic(status, hostProfileId, requiredResults) {
  if (status === 'completed') {
    return {
      code: 'I_SKILL_CAPABILITIES_RESOLVED',
      message: `Required capabilities are available for ${hostProfileId}.`,
      repair: null,
    };
  }
  const affected = requiredResults.filter(({ state }) => state === status).map(({ capabilityId }) => capabilityId);
  return {
    code: status === 'denied' ? 'E_SKILL_CAPABILITY_DENIED' : 'E_SKILL_CAPABILITY_UNAVAILABLE',
    message: `${affected.join(', ')} ${affected.length === 1 ? 'is' : 'are'} ${status} for ${hostProfileId}.`,
    repair: status === 'denied'
      ? 'Use another declared fallback or enable the capability through the host.'
      : 'Use another declared fallback or run on a host that reports the capability.',
  };
}

/**
 * Resolve actual runtime capability state within a Protocol host-profile
 * ceiling. Runtime reports can narrow a declaration, but cannot add one.
 */
export function resolveCapabilities({
  hostProfile,
  runtimeCapabilities = {},
  required = [],
  optional = [],
} = {}) {
  if (!hostProfile || typeof hostProfile !== 'object' || Array.isArray(hostProfile)) {
    fail('E_SKILL_HOST_PROFILE_INVALID', 'A Protocol host profile is required.');
  }
  if (!runtimeCapabilities || typeof runtimeCapabilities !== 'object' || Array.isArray(runtimeCapabilities)) {
    fail('E_SKILL_CAPABILITY_INPUT_INVALID', 'runtimeCapabilities must be keyed by capability ID.');
  }

  const declaredCapabilities = identifierList(hostProfile.runtimeCapabilities ?? [], 'hostProfile.runtimeCapabilities');
  const requiredCapabilities = identifierList(required, 'required');
  const optionalCapabilities = identifierList(optional, 'optional');
  const overlap = requiredCapabilities.filter((capabilityId) => optionalCapabilities.includes(capabilityId));
  if (overlap.length) {
    fail('E_SKILL_CAPABILITY_INPUT_INVALID', 'A capability cannot be both required and optional.', { overlap });
  }

  const declared = new Set(declaredCapabilities);
  const resolveOne = (capabilityId, requirement) => {
    if (!declared.has(capabilityId)) {
      return {
        capabilityId,
        requirement,
        state: 'unavailable',
        declared: false,
        source: `host-profile:${hostProfile.hostProfileId ?? 'unknown'}`,
      };
    }
    const report = normalizeReport(runtimeCapabilities, capabilityId);
    return { capabilityId, requirement, state: report.state, declared: true, source: report.source };
  };

  const requiredResults = requiredCapabilities.map((capabilityId) => resolveOne(capabilityId, 'required'));
  const optionalResults = optionalCapabilities.map((capabilityId) => resolveOne(capabilityId, 'optional'));
  const status = requiredResults.some(({ state }) => state === 'denied')
    ? 'denied'
    : requiredResults.some(({ state }) => state === 'unavailable')
      ? 'unavailable'
      : 'completed';
  const hostProfileId = hostProfile.hostProfileId ?? 'unknown';

  return freeze({
    status,
    host: hostProfile.host ?? null,
    hostProfileId,
    hostProfileVersion: hostProfile.hostProfileVersion ?? null,
    declaredCapabilities,
    required: requiredResults,
    optional: optionalResults,
    diagnostic: diagnostic(status, hostProfileId, requiredResults),
  });
}
