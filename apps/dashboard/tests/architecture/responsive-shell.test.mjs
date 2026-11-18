import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shell = await readFile(
  new URL('../../src/features/shell/UnifiedShell.tsx', import.meta.url),
  'utf8',
);
const planes = await readFile(
  new URL('../../src/features/shell/shell-planes.tsx', import.meta.url),
  'utf8',
);
const navigation = await readFile(
  new URL('../../src/features/shell/shell-navigation.tsx', import.meta.url),
  'utf8',
);

test('small viewports keep the real application shell available', () => {
  assert.doesNotMatch(shell, /TooNarrow|SHELL_MIN_WIDTH/u);
  assert.doesNotMatch(planes, /TooNarrow|Use a wider window|desktop-only/u);
  assert.match(shell, /<Inspector\b[^>]*\bmodal\b/u);
  assert.match(shell, /<MobileNavigation\b/u);
  assert.match(shell, /<FloatingChrome\b/u);
  assert.match(shell, /<RouteWorkspace/u);
});

test('mobile navigation preserves product switching and closes its secondary sheet', () => {
  assert.match(navigation, /kind: 'planning\.activity'/u);
  assert.match(navigation, /label: 'Record'/u);
  assert.match(navigation, /href="#\/operate\/today"/u);
  assert.match(shell, /operateAvailable=\{!operateOffline\}/u);
  assert.match(navigation, /onNavigate=\{\(\) => setMoreOpen\(false\)\}/u);
  assert.match(navigation, /useEffect\(\(\) => setMoreOpen\(false\), \[route\.kind\]\)/u);
});

const styles = await readFile(
  new URL('../../src/features/shell/console-shell.css', import.meta.url),
  'utf8',
);
const chrome = await readFile(
  new URL('../../src/features/shell/floating-chrome.tsx', import.meta.url),
  'utf8',
);
const chromeStyles = await readFile(
  new URL('../../src/features/shell/floating-chrome.css', import.meta.url),
  'utf8',
);

test('the responsive shell keeps the approved floating and touch geometry', () => {
  assert.match(styles, /--pc-topbar-height: 57px/u);
  assert.match(styles, /--pc-mobile-nav-height: 65px/u);
  assert.match(styles, /@media \(max-width: 599px\)/u);
  assert.doesNotMatch(styles, /\.pc-rail|\.pc-statusbar|\.pc-shell-inspector\s*\{/u);
  assert.match(
    styles,
    /\.pc-inspector-sheet\s*\{[^}]*inset: 72px 0 0;[^}]*border-radius: 16px 16px 0 0/u,
  );
  assert.match(styles, /\.pc-mobile-more__sheet\s*\{[^}]*overflow-y: auto/u);
  assert.match(styles, /\.pc-mobile-nav__item:focus-visible/u);
  assert.match(shell, /PHONE_MAX_WIDTH/u);
  assert.match(chrome, /export const PHONE_MAX_WIDTH = 599;/u);
  assert.match(chrome, /const ONE_PANEL_WIDTH = 1100;/u);
  for (const token of ['background', 'foreground', 'border', 'accent', 'focus', 'shadow'])
    assert.match(chromeStyles, new RegExp(`--canvas-chrome-${token}: var\\(--op-`, 'u'));
  assert.match(chromeStyles, /--canvas-chrome-shadow: var\(--op-shadow-float\)/u);
});

test('theme persistence is supplied by an adapter outside the shell', () => {
  assert.doesNotMatch(navigation, /localStorage|sessionStorage/u);
  assert.match(navigation, /preference\?\.save\(next\)/u);
});

test('capability tooltip controls meet the minimum active target height', () => {
  const chip = styles.match(/\.pc-conn\s*\{([^}]*)\}/u)?.[1] ?? '';
  const height = Number(chip.match(/height:\s*(\d+)px/u)?.[1]);
  assert(height >= 24, 'desktop and tablet capability controls must be at least 24px high');
  assert.match(styles, /\.pc-mobile-more__controls \.pc-conn\s*\{[^}]*min-height: 44px/u);
});
