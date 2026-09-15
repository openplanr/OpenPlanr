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
  assert.match(shell, /floating=\{narrow\}/u);
  assert.match(shell, /<NavRail/u);
  assert.match(shell, /<RouteWorkspace/u);
});

test('mobile navigation preserves product switching and closes its secondary sheet', () => {
  assert.match(navigation, /alternateProduct/u);
  assert.match(navigation, /operateAvailable=\{operateAvailable\}/u);
  assert.match(navigation, /onNavigate=\{\(\) => setMoreOpen\(false\)\}/u);
  assert.match(navigation, /useEffect\(\(\) => setMoreOpen\(false\), \[route\.kind\]\)/u);
});
