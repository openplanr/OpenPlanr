import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  assertHostBundle,
  baselineDigest,
  CLAUDE_MANIFEST_KEYS,
  inspectHostBundle,
  readDirectoryEntries,
  readHostBundleBaseline,
} from '../../scripts/skills/plugin-artifact-validation.mjs';
import {
  CLAUDE_PLUGIN_ICON,
  CLAUDE_PLUGIN_LISTING,
} from '../../scripts/skills/plugin-metadata.mjs';

const root = resolve(import.meta.dirname, '../..');
const checker = join(root, 'scripts/check-plugin-allowed-types.mjs');
const png = readFileSync(join(root, 'docs/assets/brand/png/openplanr-mark-16.png'));
const empty = { entries: [] };
const manifest = JSON.stringify({ name: 'planr', version: '1.0.0', description: 'Planr.' });

function writeBundle(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-allowed-types-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [path, content, mode] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content, mode ? { mode } : undefined);
  }
  return directory;
}

const clean = [
  ['.claude-plugin/plugin.json', manifest],
  ['.claude-plugin/icon.png', png],
  ['LICENSE', 'MIT License\n'],
  ['README.md', '# OpenPlanr\n'],
  ['skills/sync/SKILL.md', '---\nname: sync\n---\nRun `npx -y openplanr@3.6.0 sync tracker`.\n'],
  ['skills/sync/references/notes.txt', 'Plain notes.\n'],
  ['skills/sync/agents/openai.yaml', 'interface: {}\n'],
];

const dirty = [
  ...clean,
  ['skills/x/scripts/x.mjs', 'console.log("x");\n'],
  ['skills/x/run.md', '#!/bin/sh\necho hidden\n'],
  ['skills/x/package.json', '{"name":"x"}\n'],
  ['skills/x/font.woff2', 'wOF2'],
  ['skills/x/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n'],
  ['skills/x/favicon.ico', Buffer.from([0, 0, 1, 0, 1, 0])],
  ['skills/x/SKILL.md', '---\nname: x\nallowed-tools: Bash\n---\nBody.\n'],
  ['skills/x/references/launch.md', 'Run `npx openplanr@latest delegate`.\n'],
  ['skills/x/references/tool.md', 'Notes.\n', 0o755],
];

const findingsOf = (report) => report.findings.map(({ code, path }) => `${code} ${path}`).sort();

test('a bundle carrying code, packaging, refused media, tool grants or an unpinned launcher fails', (t) => {
  const report = inspectHostBundle(readDirectoryEntries(writeBundle(t, dirty)), {
    host: 'claude',
  });
  assert.equal(report.passed, false);
  assert.deepEqual(findingsOf(report), [
    'executable-bit skills/x/references/tool.md',
    'package-manager-file skills/x/package.json',
    'pre-approved-tools skills/x/SKILL.md',
    'shebang skills/x/run.md',
    'type-not-allowed skills/x/favicon.ico',
    'type-not-allowed skills/x/font.woff2',
    'type-not-allowed skills/x/mark.svg',
    'type-not-allowed skills/x/scripts/x.mjs',
    'unpinned-launcher skills/x/references/launch.md',
  ]);
  assert.throws(
    () =>
      assertHostBundle(readDirectoryEntries(writeBundle(t, dirty)), {
        host: 'claude',
        baseline: empty,
      }),
    (error) =>
      error.code === 'E_PLUGIN_ARTIFACT_INVALID' && /type-not-allowed/u.test(error.message),
  );
});

test('a bundle of instructions, metadata and a raster icon passes', (t) => {
  const entries = readDirectoryEntries(writeBundle(t, clean));
  assert.deepEqual(inspectHostBundle(entries, { host: 'claude' }).findings, []);
  assert.equal(assertHostBundle(entries, { host: 'claude', baseline: empty }).passed, true);
});

test('launchers pass only with an exact version', () => {
  const launch = (text) =>
    inspectHostBundle([{ path: 'a.md', bytes: Buffer.from(text), mode: 0o644 }], {
      host: 'codex',
    }).findings.map(({ code }) => code);
  for (const pinned of [
    'npx -y openplanr@3.6.0 delegate',
    'npx --yes @openplanr/cli@3.6.0-rc.1 run',
    'bunx openplanr@3.6.0',
    'pnpm dlx openplanr@3.6.0',
    'uvx ruff==0.6.9 check',
    'the `npx` launcher is described elsewhere',
    'npm install -g openplanr@3.6.0',
    'Never use npx and never prompt for an install.',
    'Codex: npx is blocked by the sandbox.',
    'Remove the remote plugin (`openplanr@openplanr`).',
    'Pin it as openplanr@3.6.0.',
    'Run it with npx, bunx or uvx only when the version is pinned.',
  ])
    assert.deepEqual(launch(pinned), [], pinned);
  for (const unpinned of [
    'npx openplanr',
    'npx -y openplanr@latest',
    'npx openplanr@^3.6.0',
    'npx openplanr@~3.6',
    'npx openplanr@>3',
    'npx openplanr@3',
    'npx openplanr@<exact>',
    'bunx openplanr',
    'pnpm  dlx openplanr@latest',
    'uvx ruff',
    'npx prisma migrate dev',
    'npm install -g openplanr@latest',
    'npm install -g openplanr@^3.6.0',
    'npx foo',
    'npx foo@latest',
    'npx foo@^1',
    'npm install -g openplanr',
    'pnpm add -g openplanr',
    'Install openplanr@3 first.',
    'Install openplanr@* first.',
    'Install openplanr@next first.',
  ])
    assert.deepEqual(launch(unpinned), ['unpinned-launcher'], unpinned);
});

test('the Claude label predicate refuses components and manifest keys that make a plugin privileged', () => {
  const entry = (path, text = '{}') => ({ path, bytes: Buffer.from(text), mode: 0o644 });
  const codes = (entries, host = 'claude') =>
    inspectHostBundle(entries, { host }).findings.map(({ code, path }) => `${code} ${path}`);
  for (const path of [
    'hooks/hooks.json',
    'hooks.json',
    '.mcp.json',
    '.lsp.json',
    'settings.json',
    'monitors/monitors.json',
    'bin/README.md',
    'commands/run.md',
  ])
    assert.deepEqual(codes([entry(path)]), [`privileged-component ${path}`], path);
  assert.deepEqual(codes([entry('hooks/hooks.json')], 'codex'), []);
  assert.deepEqual(
    codes([entry('.claude-plugin/plugin.json', JSON.stringify({ name: 'planr', mcpServers: {} }))]),
    ['manifest-key .claude-plugin/plugin.json'],
  );
  assert.deepEqual(
    [...CLAUDE_MANIFEST_KEYS].sort(),
    [
      'author',
      'description',
      'homepage',
      'license',
      'name',
      'repository',
      'version',
      ...Object.keys(CLAUDE_PLUGIN_LISTING),
    ].sort(),
  );
});

test('skill hooks frontmatter and a BOM-prefixed #! are refused', () => {
  const codes = (path, bytes) =>
    inspectHostBundle([{ path, bytes: Buffer.from(bytes), mode: 0o644 }], {
      host: 'claude',
    }).findings.map(({ code }) => code);
  assert.deepEqual(
    codes('skills/x/SKILL.md', '---\nname: x\nhooks:\n  PreToolUse: []\n---\nBody.\n'),
    ['privileged-frontmatter'],
  );
  assert.deepEqual(codes('skills/x/SKILL.md', '---\nname: x\n---\nhooks: are prose here.\n'), []);
  assert.deepEqual(codes('skills/x/run.md', '\ufeff#!/bin/sh\necho hidden\n'), ['shebang']);
});

test('Markdown rules are allowed only in the Cursor bundle; text must be UTF-8 without NUL', () => {
  const rule = { path: 'rules/planr-plan.mdc', bytes: Buffer.from('---\n---\n'), mode: 0o644 };
  assert.deepEqual(inspectHostBundle([rule], { host: 'cursor' }).findings, []);
  assert.deepEqual(
    inspectHostBundle([rule], { host: 'claude' }).findings.map(({ code }) => code),
    ['type-not-allowed'],
  );
  assert.throws(
    () =>
      assertHostBundle([{ path: 'a.md', bytes: Buffer.from([65, 0, 66]), mode: 0o644 }], {
        host: 'claude',
        baseline: empty,
      }),
    /binary-text/u,
  );
  assert.throws(() => inspectHostBundle([], { host: 'other' }), /host/u);
});

test('baseline entries excuse only their own host, path and rule', () => {
  const entries = [{ path: 'scripts/x.mjs', bytes: Buffer.from('x\n'), mode: 0o644 }];
  const baseline = {
    entries: [{ host: 'claude', path: 'scripts/x.mjs', code: 'type-not-allowed' }],
  };
  assert.equal(assertHostBundle(entries, { host: 'claude', baseline }).passed, true);
  assert.throws(() => assertHostBundle(entries, { host: 'codex', baseline }), /type-not-allowed/u);
});

test('the committed baseline is pinned by count and digest', () => {
  const baseline = readHostBundleBaseline();
  assert.equal(baseline.count, baseline.entries.length);
  assert.equal(baseline.sha256, baselineDigest(baseline.entries));
});

test('every launcher and openplanr install in the bundles names an exact version', () => {
  const unpinned = readHostBundleBaseline().entries.filter(
    ({ code }) => code === 'unpinned-launcher',
  );
  assert.deepEqual(unpinned, []);
});

test('the Claude icon is a PNG source', () => {
  assert.match(CLAUDE_PLUGIN_ICON, /\.png$/u);
});

test('the boundary check fails a dirty bundle root and passes a clean one', (t) => {
  const run = (directory) =>
    spawnSync(process.execPath, [checker, '--host', 'claude', '--plugin-root', directory], {
      encoding: 'utf8',
    });
  const failed = run(writeBundle(t, dirty));
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /skills\/x\/scripts\/x\.mjs \[type-not-allowed\]/u);
  const passed = run(writeBundle(t, clean));
  assert.equal(passed.status, 0, passed.stderr);
});
