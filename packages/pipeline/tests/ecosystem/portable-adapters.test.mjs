import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPERATE_VALIDATE_NOTE_LINE = /^node "<skill-root>\/scripts\/validate-note\.mjs" "<absolute-(?:advisor-output|challenger-output|chair-output|board-report-path)>" --profile (?:advisor|challenger|chair|board-report) --contract-version 2\.0\.0$/u;

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
  const legacySchema = 'packages/protocol/schemas/v1.0.0/design-manifest.schema.json';
  for (const runtime of ['openai', 'cursor']) {
    const assets = files(join(root, 'dist/plugins', runtime, 'openplanr'));
    assert.ok(assets.length > 0, `${runtime}: generated host package must not be empty`);
    for (const path of assets) {
      const bytes = readFileSync(path, 'utf8');
      if (path.replaceAll('\\', '/').endsWith(`/scripts/runtime/${legacySchema}`)) {
        // Frozen schema descriptions retain historical command names as contract
        // data. Require exact canonical bytes instead of allowing prompt changes.
        assert.equal(bytes, readFileSync(join(root, legacySchema), 'utf8'), relative(root, path));
        continue;
      }
      assert.doesNotMatch(
        bytes,
        forbidden,
        `${relative(root, path)} leaks a runtime-specific instruction`,
      );
    }
  }
});

test('the Codex artifact skill routes through planr without executing the nested binary', () => {
  const skill = readFileSync(
    join(root, 'dist/plugins/openai/openplanr/skills/artifact/SKILL.md'),
    'utf8',
  );
  assert.match(skill, /\bplanr artifact\b/);
  assert.doesNotMatch(skill, /(?:^|[`\s])planr-pipeline\s+(?:artifact|plan|ship)(?:[`\s]|$)/m);
  assert.match(skill, /never publishes it automatically/i);
});

test('Operate clients dispatch lens skills without foreign runtime paths', () => {
  const clients = [
    ['skills/planr-operate/SKILL.md', /name: planr-operate/u],
    ['dist/plugins/openai/openplanr/skills/operate/SKILL.md', /name: operate/u],
    ['dist/plugins/claude/openplanr/skills/operate/SKILL.md', /name: operate/u],
    ['dist/plugins/cursor/openplanr/rules/planr-operate.mdc', /^# Operate$/mu],
  ];
  for (const [relativePath, identity] of clients) {
    const bytes = readFileSync(join(root, relativePath), 'utf8');
    assert.match(bytes, identity, relativePath);
    assert.match(bytes, /in parallel/u, relativePath);
    assert.match(
      bytes,
      /Missing or malformed lens output is an issue,\s+not a reason to fabricate that lens/u,
      relativePath,
    );
    assert.match(bytes, /a person, a role, or\s+`unassigned`/u, relativePath);
    const commandLines = bytes
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^node\b/u.test(line));
    assert.equal(commandLines.length, 4, `${relativePath}: exact optional validation commands`);
    for (const line of commandLines) {
      assert.match(line, OPERATE_VALIDATE_NOTE_LINE, `${relativePath}: ${line}`);
    }
    assert.doesNotMatch(
      bytes,
      /JSON\.parse|--json\b|\bplanr operate validate-note\b|\.planr\/products|\/Users\/|\/home\/|\bplanr-pipeline\s+(?:operate|plan|ship)\b|\/planr-pipeline:/u,
      relativePath,
    );
  }
  assert.doesNotMatch(
    readFileSync(join(root, clients[1][0]), 'utf8'),
    /CLAUDE_PLUGIN_ROOT|~\/\.claude|\/planr-pipeline:/u,
  );
  assert.doesNotMatch(
    readFileSync(join(root, clients[3][0]), 'utf8'),
    /CLAUDE_PLUGIN_ROOT|~\/\.codex|\/planr-pipeline:/u,
  );
});
