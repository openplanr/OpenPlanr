import type { PlanningArtifactStatus } from './planning-model.js';

/*
 * The hash router carries no query string, so a status picked on Overview reaches List
 * through this one-shot hand-off instead of the URL.
 */
let pending: PlanningArtifactStatus | null = null;

export function requestListStatus(status: PlanningArtifactStatus): void {
  pending = status;
}

/** The requested status, consumed once by the next List mount. */
export function takeListStatus(): PlanningArtifactStatus | null {
  const status = pending;
  pending = null;
  return status;
}
