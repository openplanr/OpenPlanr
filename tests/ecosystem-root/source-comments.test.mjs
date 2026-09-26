import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findCommentIdentifiers } from '../../scripts/lib/source-comments.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const summarize = (findings) => findings.map(({ line, rule, match }) => [line, rule, match]);

test('planning identifiers inside comments are reported with their rule and line', () => {
  const source = [
    '/**',
    ' * Dashboard HTTP server (SPEC-016 / T-001).',
    ' */',
    'const a = 1; // FR5/FR6 — offer an upgrade where the user already is',
    '// ---- T-003: apply ----',
    '/* the daemon outlives the agent (hard rule 14) */',
    "const id = 'US-006'; // stored beside BL-012",
    'export const nfr = () => a; // NFR-2 keeps this under a second',
    '/**',
    ' * Follows the daemon pattern (hard rule',
    ' * 14): the board keeps working if the agent dies.',
    ' */',
  ].join('\n');
  assert.deepEqual(summarize(findCommentIdentifiers('fixture.mjs', source, '.mjs')), [
    [2, 'planning-id', 'SPEC-016'],
    [2, 'planning-id', 'T-001'],
    [4, 'requirement-id', 'FR5'],
    [4, 'requirement-id', 'FR6'],
    [5, 'planning-id', 'T-003'],
    [6, 'hard-rule', 'hard rule 14'],
    [7, 'planning-id', 'BL-012'],
    [8, 'planning-id', 'NFR-2'],
    [10, 'hard-rule', 'hard rule 14'],
  ]);
});

test('identifiers in string, template, regex and JSX text are not comment findings', () => {
  const source = [
    "const taskId = 'T-001';",
    'const file = `.planr/specs/SPEC-001-checkout/tasks/${taskId}.md`; // the task file',
    'const idPattern = /^(?:SPEC|US|T)-\\d{3}$/u;',
    'const slashes = /\\/\\/ T-002 [/*] SPEC-002/u; // a regex, not a comment',
    "const url = 'https://example.test/BL-012'; // a link, not an id",
    'const html = `<a href="https://example.test">FR5</a>`;',
    'const view = () => <p>US-004 is prose, not a comment</p>;',
    'const quote = "AC9 isn\'t a comment either"; // and the apostrophe ends here',
  ].join('\n');
  assert.deepEqual(findCommentIdentifiers('fixture.tsx', source, '.tsx'), []);
});

test('stylesheet block comments are checked and url() text is not', () => {
  const source = [
    '/* ── SPEC-001 · Ecosystem animations ── */',
    '.hero { background: url(https://example.test/BL-012/hero.png); }',
    ".logo { content: 'T-003'; }",
  ].join('\n');
  assert.deepEqual(summarize(findCommentIdentifiers('fixture.css', source, '.css')), [
    [1, 'planning-id', 'SPEC-001'],
  ]);
});

test('the repository passes the source comment gate', () => {
  const result = spawnSync(process.execPath, ['scripts/check-source-comments.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Source comments clean: \d+ files, 3 rules\.$/mu);
});
