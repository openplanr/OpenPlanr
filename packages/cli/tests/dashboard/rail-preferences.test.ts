// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserShellAdapters } from '../../../../apps/dashboard/src/app/browser-preferences.js';

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser rail preference adapter', () => {
  it('leaves the route default intact when there is no saved preference', () => {
    expect(createBrowserShellAdapters().railPreference).toMatchObject({
      initialCompact: undefined,
      initialStorageError: false,
    });
  });

  it.each([true, false])('reads saved compact=%s synchronously', (compact) => {
    localStorage.setItem('op-rail-compact:v1', JSON.stringify(compact));
    const preference = createBrowserShellAdapters().railPreference;
    localStorage.setItem('op-rail-compact:v1', JSON.stringify(!compact));
    expect(preference?.initialCompact).toBe(compact);
    expect(preference?.initialStorageError).toBe(false);
  });

  it('persists both choices as exact boolean values under the versioned rail key', () => {
    const preference = createBrowserShellAdapters().railPreference;
    preference?.save(true);
    expect(localStorage.getItem('op-rail-compact:v1')).toBe('true');
    preference?.save(false);
    expect(localStorage.getItem('op-rail-compact:v1')).toBe('false');
    expect(localStorage.length).toBe(1);
  });

  it.each(['yes', '1', 'null', '{}', '"true"', 'TRUE', ''])(
    'reports invalid saved value %j and uses the route default',
    (stored) => {
      localStorage.setItem('op-rail-compact:v1', stored);
      expect(createBrowserShellAdapters().railPreference).toMatchObject({
        initialCompact: undefined,
        initialStorageError: true,
      });
      expect(localStorage.getItem('op-rail-compact:v1')).toBe(stored);
    },
  );

  it('surfaces denied initial reads through the initial error flag', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(createBrowserShellAdapters().railPreference).toMatchObject({
      initialCompact: undefined,
      initialStorageError: true,
    });
  });

  it('propagates a save error to the caller', () => {
    const preference = createBrowserShellAdapters().railPreference;
    const failure = new DOMException('Storage denied', 'QuotaExceededError');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw failure;
    });
    expect(() => preference?.save(true)).toThrow(failure);
    expect(preference?.initialCompact).toBeUndefined();
  });

  it('uses the route default when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(createBrowserShellAdapters().railPreference).toMatchObject({
      initialCompact: undefined,
      initialStorageError: false,
    });
  });
});
