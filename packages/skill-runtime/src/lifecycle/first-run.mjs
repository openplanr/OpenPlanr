import { freezeJson } from './internal.mjs';

/** Return concise, non-blocking guidance for a lifecycle's first local start. */
export function firstRunGuidance({ environment, settings } = {}) {
  if (!environment || typeof environment !== 'object') {
    throw new TypeError('environment is required for first-run guidance.');
  }
  if (!settings || typeof settings !== 'object') {
    throw new TypeError('settings are required for first-run guidance.');
  }
  const messages = environment.firstRun
    ? [
        environment.stateAvailable
          ? `Optional skill state stays in ${environment.runtimePath} and is ignored locally.`
          : 'This run will continue without persisted skill state.',
        Object.values(settings).some(Boolean)
          ? 'Only explicitly configured optional features are active.'
          : 'Optional data and background features are off.',
      ]
    : [];
  return freezeJson({
    status: 'completed',
    firstRun: environment.firstRun === true,
    messages,
  });
}
