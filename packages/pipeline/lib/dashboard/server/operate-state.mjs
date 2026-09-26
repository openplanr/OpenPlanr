/** Access-safe Operate experience cache, live patch history and lazily resolved gateways. */

import { buildOperateExperienceTransportView } from './operate.mjs';

const MAX_OPERATE_PATCH_HISTORY = 256;

export const supportsOperateSession = (gateway) =>
  gateway !== null &&
  typeof gateway?.issueSession === 'function' &&
  typeof gateway?.assertSessionBinding === 'function';
export const supportsGovernedAction = (gateway) =>
  supportsOperateSession(gateway) &&
  typeof gateway?.preview === 'function' &&
  typeof gateway?.assertPreviewBinding === 'function' &&
  typeof gateway?.confirm === 'function';

export function createOperateState({
  getOperatingExperience,
  getOperatingCommandGateway,
  getOperatingPlanningGateway,
}) {
  let operatingCommandGatewayResolved = false;
  let operatingCommandGateway = null;
  const resolveOperatingCommandGateway = () => {
    if (!operatingCommandGatewayResolved) {
      operatingCommandGatewayResolved = true;
      try {
        operatingCommandGateway =
          typeof getOperatingCommandGateway === 'function' ? getOperatingCommandGateway() : null;
      } catch {
        // Capability discovery is optional. A broken provider remains safely unavailable.
        operatingCommandGateway = null;
      }
    }
    return operatingCommandGateway;
  };
  let operatingPlanningGatewayResolved = false;
  let operatingPlanningGateway = null;
  const resolveOperatingPlanningGateway = () => {
    if (!operatingPlanningGatewayResolved) {
      operatingPlanningGateway =
        typeof getOperatingPlanningGateway === 'function' ? getOperatingPlanningGateway() : null;
      operatingPlanningGatewayResolved = true;
    }
    return operatingPlanningGateway;
  };
  const operatePatchHistory = [];
  let currentExperience = null;
  const readExperience = () => {
    try {
      const next = getOperatingExperience();
      const safe = next?.view
        ? Object.freeze({ ...next, view: buildOperateExperienceTransportView(next.view) })
        : next;
      currentExperience = safe;
      return safe;
    } catch {
      const refused = Object.freeze({
        available: true,
        readOnly: true,
        status: 'invalid',
        view: null,
        reasonCodes: ['OPERATE_PROJECTION_INVALID'],
        recovery: 'Refresh the validated access-safe snapshot through OpenPlanr.',
      });
      currentExperience = refused;
      return refused;
    }
  };
  const ensureExperience = () => currentExperience ?? readExperience();

  return Object.freeze({
    clients: new Set(),
    patchHistory: operatePatchHistory,
    readExperience,
    ensureExperience,
    /** Adopt the watcher-observed read as the current experience. */
    replaceExperience: (next) => {
      currentExperience = next;
    },
    /** Keep a live patch for checkpoint replay, bounded to the most recent entries. */
    rememberPatch: (patch) => {
      operatePatchHistory.push(patch);
      if (operatePatchHistory.length > MAX_OPERATE_PATCH_HISTORY) operatePatchHistory.shift();
    },
    resolveCommandGateway: resolveOperatingCommandGateway,
    resolvePlanningGateway: resolveOperatingPlanningGateway,
  });
}
