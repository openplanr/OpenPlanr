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
  assert.match(shell, /\bfloating\s+modal=\{narrow\}/u);
  assert.match(shell, /<NavRail/u);
  assert.match(shell, /<RouteWorkspace/u);
});

test('mobile navigation preserves product switching and closes its secondary sheet', () => {
  assert.match(navigation, /kind: 'planning\.activity'/u);
  assert.match(navigation, /label: 'Record'/u);
  assert.match(navigation, /href="#\/operate\/today"/u);
  assert.match(navigation, /operateAvailable=\{operateAvailable\}/u);
  assert.match(navigation, /onNavigate=\{\(\) => setMoreOpen\(false\)\}/u);
  assert.match(navigation, /useEffect\(\(\) => setMoreOpen\(false\), \[route\.kind\]\)/u);
});

const styles = await readFile(
  new URL('../../src/features/shell/console-shell.css', import.meta.url),
  'utf8',
);

test('the responsive shell keeps the approved desktop and touch geometry', () => {
  assert.match(styles, /--pc-sidebar-width: 236px/u);
  assert.match(styles, /--pc-rail-width: 64px/u);
  assert.match(styles, /--pc-topbar-height: 60px/u);
  assert.match(styles, /@media \(max-width: 899px\)/u);
  assert.match(styles, /--pc-topbar-height: 56px/u);
  assert.match(styles, /\.pc-inspector-sheet\s*\{[^}]*height: 100dvh/u);
  assert.match(styles, /\.pc-mobile-more__sheet\s*\{[^}]*overflow-y: auto/u);
  assert.match(styles, /\.pc-mobile-nav__item:focus-visible/u);
  assert.match(styles, /@media \(min-width: 900px\)/u);
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
