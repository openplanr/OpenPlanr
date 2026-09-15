import { DEFAULT_LIFECYCLE_SETTINGS } from './consent.mjs';
import { prepareLifecycleEnvironment } from './environment.mjs';
import { freezeJson } from './internal.mjs';
import { readStateJson, writeStateJson } from './storage.mjs';

export const LIFECYCLE_CONFIGURATION_PATH = '.planr/runtime/skill-runtime.json';

const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_LIFECYCLE_SETTINGS));

export function normalizeLifecycleConfiguration(configured = {}) {
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new TypeError('lifecycle configuration must be an object.');
  }
  const unknown = Object.keys(configured).filter((key) => !SETTING_KEYS.includes(key));
  if (unknown.length > 0) throw new TypeError(`Unknown lifecycle setting: ${unknown.sort()[0]}.`);
  const settings = { ...DEFAULT_LIFECYCLE_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (configured[key] === undefined) continue;
    if (typeof configured[key] !== 'boolean') throw new TypeError(`${key} must be a boolean.`);
    settings[key] = configured[key];
  }
  return freezeJson(settings);
}

/** Read local configuration; malformed state falls back safely without blocking work. */
export function loadLifecycleConfiguration({ projectRoot } = {}) {
  let document;
  try {
    document = readStateJson(projectRoot, LIFECYCLE_CONFIGURATION_PATH);
  } catch (error) {
    return freezeJson({
      status: 'partial',
      source: 'default',
      settings: { ...DEFAULT_LIFECYCLE_SETTINGS },
      notice: 'Used default lifecycle settings because local configuration was unreadable.',
      issue: error instanceof Error ? error.message : String(error),
    });
  }
  if (document === null) {
    return freezeJson({
      status: 'completed',
      source: 'default',
      settings: { ...DEFAULT_LIFECYCLE_SETTINGS },
      notice: 'Used default lifecycle settings.',
    });
  }
  try {
    if (document.kind !== 'skill-runtime-configuration' || document.version !== '1.0.0') {
      throw new TypeError('Local lifecycle configuration has an unsupported format.');
    }
    return freezeJson({
      status: 'completed',
      source: LIFECYCLE_CONFIGURATION_PATH,
      settings: normalizeLifecycleConfiguration(document.settings),
      notice: 'Loaded project-local lifecycle settings.',
    });
  } catch (error) {
    return freezeJson({
      status: 'partial',
      source: 'default',
      settings: { ...DEFAULT_LIFECYCLE_SETTINGS },
      notice: 'Used default lifecycle settings because local configuration was incompatible.',
      issue: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Store an explicit project-local configuration; this never records consent. */
export function saveLifecycleConfiguration({ projectRoot, settings } = {}) {
  const normalized = normalizeLifecycleConfiguration(settings);
  const environment = prepareLifecycleEnvironment({ projectRoot });
  if (!environment.stateAvailable || !environment.runtimeIgnored) {
    return freezeJson({
      status: 'partial',
      path: null,
      settings: normalized,
      notice: 'Used the settings in memory because a safe ignored path was unavailable.',
    });
  }
  try {
    writeStateJson(environment.projectRoot, LIFECYCLE_CONFIGURATION_PATH, {
      kind: 'skill-runtime-configuration',
      version: '1.0.0',
      settings: normalized,
    });
  } catch {
    return freezeJson({
      status: 'partial',
      path: null,
      settings: normalized,
      notice: 'Used the settings in memory because local state could not be written safely.',
    });
  }
  return freezeJson({
    status: 'completed',
    path: LIFECYCLE_CONFIGURATION_PATH,
    settings: normalized,
    notice: 'Saved project-local lifecycle settings.',
  });
}
