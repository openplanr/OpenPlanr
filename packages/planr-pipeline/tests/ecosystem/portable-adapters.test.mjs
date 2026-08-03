import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

test('Codex and Cursor portable adapters contain no foreign runtime instructions', () => {
  const forbidden = /CLAUDE_PLUGIN_ROOT|\bSonnet\b|\bOpus\b|\/planr-pipeline:/;
  for (const runtime of ['codex', 'cursor']) {
    for (const path of files(join(root, 'adapters', runtime))) {
      assert.doesNotMatch(
        readFileSync(path, 'utf8'),
        forbidden,
        `${relative(root, path)} leaks a runtime-specific instruction`,
      );
    }
  }
});

test('the Codex artifact skill routes through planr without executing the nested binary', () => {
  const skill = readFileSync(
    join(root, 'adapters', 'codex', 'skills', 'planr-artifact', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /\bplanr artifact\b/);
  assert.doesNotMatch(skill, /(?:^|[`\s])planr-pipeline\s+(?:artifact|plan|ship)(?:[`\s]|$)/m);
  assert.match(skill, /never publishes it automatically/i);
});
