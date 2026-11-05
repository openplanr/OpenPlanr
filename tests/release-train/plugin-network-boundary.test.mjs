import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  assertReleasablePlugin,
  classifyFindings,
  scanPluginNetworkBoundary,
} from '../../scripts/check-plugin-network-boundary.mjs';

const workspace = resolve(import.meta.dirname, '../..');

function plugin(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'planr-plugin-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function rules(root) {
  return scanPluginNetworkBoundary({ workspace, pluginRoots: [root], includeSkillSources: false })
    .map(({ path, rule }) => `${path} ${rule}`)
    .sort();
}

test('a plugin that only reads project files and talks to loopback passes', (t) => {
  const root = plugin(t, {
    'runtime/design/scripts/design.mjs':
      "import { readFileSync } from 'node:fs';\nconst x = readFileSync('a');\nawait fetch(`http://127.0.0.1:${port}/api`);\n",
    'runtime/schemas/a.schema.json': '{"$id": "https://openplanr.dev/schemas/v1/a.schema.json"}',
    'runtime/design/scripts/contracts.mjs':
      'var c = (name) => ({ $id: `https://openplanr.dev/schemas/v1/${name}.schema.json` });\ndoc.$id = "https://openplanr.dev/schemas/v2/d.schema.json";\n',
    'README.md': 'Sharing goes through share.openplanr.dev from the CLI.',
  });
  assert.deepEqual(rules(root), []);
  assert.doesNotThrow(() => assertReleasablePlugin({ workspace, pluginRoots: [root] }));
});

test('each kind of credential read or OpenPlanr request is found', (t) => {
  const root = plugin(t, {
    'a.mjs': 'const base = process.env.OPENPLANR_SHARE_BASE ?? "https://share.openplanr.dev";',
    'b.mjs': 'await fetch("https://openplanr.dev/api/v1/thing");',
    'c.mjs': 'const { ownerAuth } = custody;',
    'd.mjs':
      "import { homedir } from 'node:os';\nconst p = join(homedir(), '.planr');\nawait fetchImpl(url);\n",
    'e.mjs': 'headers.Authorization = `Bearer ${token}`;',
    'f.mjs': '// packages/artifact/lib/artifact/owner-custody.mjs\nexport const x = 1;\n',
    'g.js': '  // lib/artifact/ui/hosted-viewer.mjs\n  var y = 2;\n',
    'h.mjs': '// packages/protocol/src/sharing-security-contracts.mjs\nexport const z = 3;\n',
    'i.js': '  // ../protocol/src/workspace-contracts.mjs\n  var w = 4;\n',
  });
  assert.deepEqual(rules(root), [
    'a.mjs openplanr-request-url',
    'a.mjs share-host',
    'b.mjs openplanr-request-url',
    'c.mjs owner-key',
    'd.mjs home-read-with-network',
    'e.mjs authorization',
    'f.mjs share-module',
    'g.js share-module',
    'h.mjs share-module',
    'i.js share-module',
  ]);
});

test('a home read without any request is not a finding', (t) => {
  const root = plugin(t, { 'a.mjs': "const p = join(env.HOME, '.config');" });
  assert.deepEqual(rules(root), []);
});

test('allowlist entries cover findings by glob, and unused entries are reported stale', () => {
  const findings = [
    { path: 'runtime/design/scripts/design-share-1a2b3c4d.mjs', rule: 'share-host', evidence: [] },
    { path: 'runtime/x.mjs', rule: 'owner-key', evidence: [] },
  ];
  const { blocking, allowed, stale } = classifyFindings(findings, {
    permanent: [],
    shrinking: [
      { path: 'runtime/design/scripts/design-share-*.mjs', rule: 'share-host' },
      { path: 'runtime/gone.mjs', rule: 'authorization' },
    ],
  });
  assert.deepEqual(
    allowed.map(({ path }) => path),
    ['runtime/design/scripts/design-share-1a2b3c4d.mjs'],
  );
  assert.deepEqual(
    blocking.map(({ path }) => path),
    ['runtime/x.mjs'],
  );
  assert.deepEqual(stale, [{ path: 'runtime/gone.mjs', rule: 'authorization', kind: 'shrinking' }]);
});

test('a release refuses any finding even when the shrinking allowlist covers it', (t) => {
  const root = plugin(t, {
    'runtime/design/scripts/design-share.mjs': 'fetch("https://share.openplanr.dev/x");',
  });
  assert.throws(
    () => assertReleasablePlugin({ workspace, pluginRoots: [root] }),
    /no release ships until it is clean[\s\S]*design-share\.mjs \[share-host\]/u,
  );
});

test('publishing the marketplace refuses an unclean plugin before touching the checkout', (t) => {
  const root = plugin(t, { 'runtime/a.mjs': 'const k = record.ownerPrivateKey;' });
  const marketplace = mkdtempSync(join(tmpdir(), 'planr-marketplace-'));
  t.after(() => rmSync(marketplace, { recursive: true, force: true }));
  const run = spawnSync(
    process.execPath,
    [
      join(workspace, 'scripts/release-train/publish-marketplace.mjs'),
      '--plugin',
      root,
      '--marketplace',
      marketplace,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /no release ships until it is clean/u);
});

test('the scan names a missing plugin bundle instead of passing', () => {
  assert.throws(
    () =>
      scanPluginNetworkBoundary({
        workspace,
        pluginRoots: [join(tmpdir(), 'planr-no-such-plugin')],
        includeSkillSources: false,
      }),
    /missing\. Run npm run generate first/u,
  );
});
