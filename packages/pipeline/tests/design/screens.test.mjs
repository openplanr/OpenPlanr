import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveScreens, countScreens } from '../../lib/design/screens.mjs';

test('resolves a bullet list under a "Screens" heading', () => {
  const spec = [
    '# Feature', 'intro prose',
    '## Screens', '- Login', '- Dashboard', '- Settings',
    '## Out of scope', '- billing',
  ].join('\n');
  assert.deepEqual(resolveScreens(spec), ['Login', 'Dashboard', 'Settings']);
});

test('strips a trailing " — description" and markdown decoration', () => {
  const spec = '## Screens\n- **Login** — the sign-in page\n- `Dashboard`\n';
  assert.deepEqual(resolveScreens(spec), ['Login', 'Dashboard']);
});

test('reads a frontmatter ui_files list and de-duplicates against the body', () => {
  const spec = [
    '---', 'title: X', 'ui_files:', '  - login.png', '  - dashboard.png', '---',
    '## Screens', '- Login', '- Reports',
  ].join('\n');
  // login (frontmatter) + dashboard (frontmatter) + Reports (body); "Login"
  // de-dupes against "login".
  assert.deepEqual(resolveScreens(spec), ['login', 'dashboard', 'Reports']);
});

test('a screenless spec resolves to an empty list (→ thin-spec clarify path)', () => {
  assert.deepEqual(resolveScreens('# Feature\nNo UI section here.'), []);
  assert.equal(countScreens('# Feature'), 0);
});

test('countScreens matches resolveScreens length', () => {
  const spec = '## Screens\n- A\n- B\n- C\n- D\n';
  assert.equal(countScreens(spec), 4);
});
