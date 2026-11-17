// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chromePreferenceKey,
  createBrowserShellAdapters,
  parseChromePreference,
} from '../../../../apps/dashboard/src/app/browser-preferences.js';

const PROJECT = 'project-a';

function storage(projectId = PROJECT) {
  const preference = createBrowserShellAdapters().chromePreference;
  if (!preference) throw new Error('Missing chrome preference adapter');
  return preference.storage(projectId);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser chrome preference adapter', () => {
  it('reads nothing when the project has no saved chrome state', () => {
    expect(storage().get('canvas.chrome.panel.sidebar')).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it('keeps every kit key inside one versioned entry per project', () => {
    storage().set('canvas.chrome.panel.sidebar', { open: true, pinned: true });
    storage().set('canvas.chrome.panel.navigation', { open: false, pinned: false });
    storage('project-b').set('canvas.chrome.panel.sidebar', { open: false, pinned: true });
    expect(localStorage.length).toBe(2);
    expect(JSON.parse(localStorage.getItem(chromePreferenceKey(PROJECT)) ?? 'null')).toEqual({
      'canvas.chrome.panel.sidebar': { open: true, pinned: true },
      'canvas.chrome.panel.navigation': { open: false, pinned: false },
    });
    expect(storage().get('canvas.chrome.panel.sidebar')).toEqual({ open: true, pinned: true });
    expect(storage('project-b').get('canvas.chrome.panel.sidebar')).toEqual({
      open: false,
      pinned: true,
    });
    expect(chromePreferenceKey(PROJECT)).toBe('op-chrome:v1:project-a');
  });

  it.each(['yes', '1', 'null', '[]', '"open"', '{', ''])(
    'reports corrupt saved value %j on read and replaces it on the next write',
    (stored) => {
      localStorage.setItem(chromePreferenceKey(PROJECT), stored);
      expect(() => storage().get('canvas.chrome.panel.sidebar')).toThrow();
      expect(localStorage.getItem(chromePreferenceKey(PROJECT))).toBe(stored);
      storage().set('canvas.chrome.panel.sidebar', { open: false, pinned: true });
      expect(storage().get('canvas.chrome.panel.sidebar')).toEqual({ open: false, pinned: true });
    },
  );

  it('parses an absent entry as empty and rejects non-object entries', () => {
    expect(parseChromePreference(null)).toEqual({});
    expect(() => parseChromePreference('[1]')).toThrow('Invalid chrome preference');
  });

  it('propagates denied reads and writes to the chrome', () => {
    const failure = new DOMException('Storage denied', 'SecurityError');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw failure;
    });
    expect(() => storage().get('canvas.chrome.panel.sidebar')).toThrow(failure);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw failure;
    });
    expect(() =>
      storage().set('canvas.chrome.panel.sidebar', { open: true, pinned: false }),
    ).toThrow(failure);
  });
});
