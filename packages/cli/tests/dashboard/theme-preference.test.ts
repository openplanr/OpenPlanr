// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrowserShellAdapters } from '../../../../apps/dashboard/src/app/browser-preferences.js';

const html = readFileSync(resolve(process.cwd(), '../../apps/dashboard/src/index.html'), 'utf8');
const prePaintScript = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];

function runPrePaintScript(): void {
  if (!prePaintScript) throw new Error('index.html has no pre-paint theme script');
  new Function(prePaintScript)();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('first-visit theme', () => {
  it('follows the operating system until a theme is stored', () => {
    runPrePaintScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
    expect(createBrowserShellAdapters().themePreference?.initialChoice).toBe('system');
  });

  it.each(['light', 'dark', 'system'] as const)('keeps a stored %s choice', (choice) => {
    localStorage.setItem('op-theme', choice);
    runPrePaintScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe(choice);
    expect(createBrowserShellAdapters().themePreference?.initialChoice).toBe(choice);
  });

  it('ignores an unrecognised stored value', () => {
    localStorage.setItem('op-theme', 'sepia');
    runPrePaintScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
  });
});
