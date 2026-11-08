import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  allowlistDigest,
  assertBaselineNotGrown,
  assertReleasablePlugin,
  checkPluginRoots,
  classifyFindings,
  readAllowlist,
  scanPluginRoot,
} from '../../scripts/check-plugin-network-boundary.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const fixtures = join(import.meta.dirname, 'fixtures');
const none = { permanent: [] };

function plugin(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'planr-plugin-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const rules = (root) =>
  scanPluginRoot(root)
    .map(({ path, rule }) => `${path} ${rule}`)
    .sort();

test('project reads, proven-local sends and schema identifiers pass', (t) => {
  const root = plugin(t, {
    'runtime/a.mjs': [
      "import { readFileSync } from 'node:fs';",
      "import { request } from 'node:http';",
      "readFileSync('design.json');",
      'export async function probe(port) {',
      '  if (!Number.isInteger(port)) throw new Error("port");',
      '  await fetch(`http://127.0.0.1:${port}/api`);',
      '}',
      'await fetch(`http://127.0.0.1:${Number(process.argv[2])}/status`);',
      "await fetch('/api/feedback', { credentials: 'same-origin' });",
      'await fetch(`${location.origin}/api/pins`);',
      "await fetch(new URL('./state', location.href));",
      "request({ hostname: '127.0.0.1', port: 4173 });",
      "new WebSocket('/live');",
      "new WebSocket('ws://127.0.0.1:4173/live');",
      "await fetch(location.origin + '/api/pins');",
      'await fetch(`/api/${encodeURIComponent(id)}`);',
      'const doc = { $id: "https://openplanr.dev/schemas/v1/a.schema.json" };',
      'const run = (git) => git; // homedir() and process.env in a comment are not reads',
    ].join('\n'),
    'skills/design/SKILL.md': 'Sharing goes through share.openplanr.dev from the openplanr CLI.',
    'runtime/schemas/a.schema.json': '{"$id": "https://openplanr.dev/schemas/v1/a.schema.json"}',
  });
  assert.deepEqual(rules(root), []);
  assert.doesNotThrow(() => assertReleasablePlugin({ workspace, pluginRoots: [root] }));
});

test('every environment, home and storage read is found, however it is written', (t) => {
  const root = plugin(t, {
    'a.mjs': "const home = process.env['PLANR_HOME'];",
    'b.mjs': 'const { HOME } = process.env;',
    'c.mjs': 'const { env } = process;\nconst profile = env.USERPROFILE;',
    'd.mjs': "import { env } from 'node:process';\nexport const x = env.X;",
    'e.mjs': "import os from 'node:os';\nconst p = os.homedir();",
    'f.mjs': "const p = '~/.planr/tokens.json';",
    'g.js': 'const theme = window.localStorage.getItem("t");',
    'h.js': 'const open = indexedDB.open("custody");',
    'i.js': 'const c = document.cookie;',
  });
  assert.deepEqual(rules(root), [
    'a.mjs env-read',
    'b.mjs env-read',
    'c.mjs env-read',
    'd.mjs env-read',
    'e.mjs home-read',
    'f.mjs home-read',
    'g.js browser-storage',
    'h.js browser-storage',
    'i.js browser-storage',
  ]);
});

test('a send is found unless its destination is proven local', (t) => {
  const root = plugin(t, {
    'a.mjs': 'export const get = (options, u) => (options.fetchImpl ?? fetch)(u);',
    'b.mjs': "import { request } from 'node:https';\nrequest('https://example.com');",
    'c.js': "new WebSocket('wss://live.example.com');",
    'd.mjs': 'export const probe = (port) => fetch(`http://127.0.0.1:${port}/api`);',
    'e.mjs': "await fetch('http://localhost:4173/api');",
    'f.mjs':
      "import { LOOPBACK_HOST } from './g.mjs';\nawait fetch(`http://${LOOPBACK_HOST}:4173/`);",
    'g.mjs': "export const LOOPBACK_HOST = '127.0.0.1';",
    'h.mjs': "const base = 'https://share.' + 'openplanr.dev';",
    'i.mjs': "import net from 'node:net';\nnet.connect(443, 'example.com');",
    'j.js': 'navigator.sendBeacon("https://example.com/b", data);\nnew XMLHttpRequest();',
    'k.mjs': 'const s = "@x.example";\nawait fetch(`http://127.0.0.1:80${s}/a`);',
    'l.mjs': 'const s = ".x.example";\nawait fetch(`http://127.0.0.1${s}/a`);',
    'm.js': 'const h = "/x.example";\nawait fetch(`/${h}`);',
    'n.js': "await fetch('/\\\\x.example/a');",
    'o.mjs': 'const p = 80;\nconst s = "@x.example";\nawait fetch(`http://127.0.0.1:${p}${s}`);',
    'p.js':
      'const location = { origin: "https://x.example" };\nawait fetch(`${location.origin}/a`);',
    'q.js': "export const go = (location) => fetch(new URL('/a', location.href));",
  });
  assert.deepEqual(rules(root), [
    'a.mjs network-send',
    'b.mjs network-send',
    'c.js network-send',
    'd.mjs network-send',
    'e.mjs network-send',
    'f.mjs network-send',
    'h.mjs share-host',
    'i.mjs network-send',
    'j.js network-send',
    'k.mjs network-send',
    'l.mjs network-send',
    'm.js network-send',
    'n.js network-send',
    'o.mjs network-send',
    'p.js network-send',
    'q.js network-send',
  ]);
});

test('computed, aliased and dynamic forms are seen', (t) => {
  const root = plugin(t, {
    'a.mjs': "const e = process['e' + 'nv'];",
    'b.mjs': "const e = globalThis['process'].env;",
    'c.mjs': 'const p = process;\nconst e = p.env;',
    'd.mjs': "import p from 'node:process';\nconst e = p.env;",
    'e.mjs': "const e = Reflect.get(process, 'env');",
    'f.mjs': "const e = process.getBuiltinModule('process').env;",
    'g.mjs': 'const e = Bun.env;',
    'h.cjs': "const h = require('os').homedir();",
    'i.mjs': "import os from 'node:os';\nconst h = os['homedir']();",
    'j.js': "globalThis['fetch']('https://x.example');",
    'k.js': 'new window.XMLHttpRequest();\nwindow.navigator.sendBeacon("https://x.example");',
    'l.js': "const s = window['localStorage'];",
    'm.mjs': "const h = await import('node:https');\nh.request('https://x.example');",
    'n.cjs': "require('child_process').spawn('git');",
    'o.mjs': "const cp = await import('node:child_process');\ncp.execFile('gh');",
    'p.mjs': "const base = `https://share.${'openplanr'}.dev`;",
    'q.mjs': 'eval(code);\n(0, eval)(code);',
    'r.mjs': "const f = new Function('return 1');",
    's.mjs': 'const m = await import(specifier);',
    't.cjs': 'const m = require(name);',
  });
  assert.deepEqual(rules(root), [
    'a.mjs env-read',
    'b.mjs env-read',
    'c.mjs env-read',
    'd.mjs env-read',
    'e.mjs env-read',
    'f.mjs env-read',
    'g.mjs env-read',
    'h.cjs home-read',
    'i.mjs home-read',
    'j.js network-send',
    'k.js network-send',
    'l.js browser-storage',
    'm.mjs network-send',
    'n.cjs env-forward',
    'o.mjs env-forward',
    'p.mjs share-host',
    'q.mjs dynamic-code',
    'r.mjs dynamic-code',
    's.mjs dynamic-code',
    't.cjs dynamic-code',
  ]);
});

test('shipped shell scripts are scanned for sends, home and credential reads', (t) => {
  const root = plugin(t, {
    'a.sh': '#!/usr/bin/env bash\ncurl -s https://x.example',
    'b.sh': '#!/usr/bin/env bash\ncat "$HOME/.netrc"',
    'c.sh': '#!/usr/bin/env bash\necho "$GITHUB_TOKEN"',
    'd.sh': '#!/usr/bin/env bash\nprintenv',
    'e.sh': '#!/usr/bin/env bash\ngit log --since="$1" | sort',
  });
  assert.deepEqual(rules(root), [
    'a.sh network-send',
    'b.sh home-read',
    'c.sh env-read',
    'd.sh env-read',
  ]);
});

test('a child process forwards the environment unless it is given an explicit one', (t) => {
  const root = plugin(t, {
    'a.mjs': "import { execFile } from 'node:child_process';\nexecFile('gh', ['repo', 'view']);",
    'b.mjs':
      "import { promisify } from 'node:util';\nimport { execFile } from 'node:child_process';\nexport const run = promisify(execFile);",
    'c.mjs':
      "const cp = require('child_process');\ncp.spawn('git', [], { env: { ...process.env } });",
    'd.mjs':
      "import { spawn } from 'node:child_process';\nspawn('git', ['status'], { env: { LANG: 'C' } });",
  });
  assert.deepEqual(rules(root), [
    'a.mjs env-forward',
    'b.mjs env-forward',
    'c.mjs credential-forward',
    'c.mjs env-forward',
    'c.mjs env-read',
  ]);
});

test('a read in one module and a send in another are joined at the entry point', (t) => {
  const root = plugin(t, {
    'skills/x/scripts/run.mjs':
      "import { home } from './state.mjs';\nimport { send } from './net.mjs';\n",
    'skills/x/scripts/state.mjs':
      "import { homedir } from 'node:os';\nexport const home = homedir();",
    'skills/x/scripts/net.mjs': 'export const send = (u) => fetch(u);',
  });
  const forward = scanPluginRoot(root).find(({ rule }) => rule === 'credential-forward');
  assert.equal(forward.path, 'skills/x/scripts/run.mjs');
  assert.deepEqual(forward.evidence, [
    'home-read skills/x/scripts/state.mjs:2',
    'network-send skills/x/scripts/net.mjs:1',
  ]);
});

test('the 3.4.0 bundle the directory held fails, covering every file it flagged', () => {
  const root = join(fixtures, 'directory-3.4.0');
  const flagged = [
    '.claude-plugin/plugin.json',
    'runtime/design/scripts/design-document.mjs',
    'runtime/design/scripts/design-handoff.mjs',
    'runtime/design/scripts/design-review.mjs',
    'runtime/design/scripts/design-shared-artifact-support-dependencies-design-support-protocol-contracts-d707e49b.mjs',
    'runtime/design/scripts/design.mjs',
    'runtime/design/scripts/runtime/packages/artifact/templates/artifact-review-stage.js.sources/04-artifact-review-ui.js',
    'runtime/design/scripts/runtime/packages/design/templates/studio/studio.js.sources/13-design-review-experience.js',
    'runtime/plan/scripts/design-protocol-contracts.mjs',
    'runtime/plan/scripts/design.mjs',
  ];
  const [{ blocking }] = checkPluginRoots([root], none).results;
  const reported = new Set(blocking.flatMap(({ path, closure = [] }) => [path, ...closure]));
  assert.deepEqual(
    flagged.filter((path) => !reported.has(path)),
    [],
  );
  assert.equal(reported.has('runtime/operate/scripts/errors.mjs'), false);
  assert.ok(
    blocking.some(
      ({ path, rule }) => path === '.claude-plugin/plugin.json' && rule === 'plugin-anchor',
    ),
  );
  assert.throws(
    () => assertReleasablePlugin({ workspace, pluginRoots: [root] }),
    /no release ships until it is clean[\s\S]*design-review\.mjs \[network-send\]/u,
  );
});

test('Figma hosts and tokens are refused in skill text and code; plain mentions pass', () => {
  assert.deepEqual(rules(join(fixtures, 'figma')), [
    'rules/planr-design/figma.mdc figma-token',
    'runtime/design/scripts/figma.mjs figma-host',
    'skills/design-loop/config.yaml figma-token',
    'skills/design/references/figma-export.md figma-host',
  ]);
});

test('allowlist entries cover findings by glob, and unused entries are reported stale', (t) => {
  const root = plugin(t, {
    'skills/delegate/scripts/a/run.mjs':
      "import { execFile } from 'node:child_process';\nexecFile('git');",
    'runtime/x.mjs': "import { execFile } from 'node:child_process';\nexecFile('git');",
  });
  const allowlist = {
    permanent: [
      { path: 'skills/delegate/scripts/**', rule: 'env-forward', reason: 'git' },
      { path: 'runtime/gone.mjs', rule: 'env-read', reason: 'gone' },
    ],
  };
  const { results, stale } = checkPluginRoots([root], allowlist);
  assert.deepEqual(
    results[0].allowed.map(({ path }) => path),
    ['skills/delegate/scripts/a/run.mjs'],
  );
  assert.deepEqual(
    results[0].blocking.map(({ path, rule }) => `${path} ${rule}`),
    ['runtime/x.mjs env-forward'],
  );
  assert.deepEqual(stale, [{ path: 'runtime/gone.mjs', rule: 'env-read' }]);
  assert.deepEqual(classifyFindings([], allowlist).stale.length, 2);
});

test('the permanent allowlist is pinned to its baseline and can only shrink', (t) => {
  const entry = (path) => ({ path, rule: 'env-read', reason: 'local' });
  const write = (permanent, baseline, extra = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'planr-allowlist-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'scripts'));
    writeFileSync(
      join(root, 'scripts/plugin-network-boundary-allowlist.json'),
      JSON.stringify({ permanent, ...extra }),
    );
    writeFileSync(
      join(root, 'scripts/plugin-network-boundary-baseline.json'),
      JSON.stringify(baseline),
    );
    return root;
  };
  const pinned = [entry('a.mjs'), entry('b.mjs')];
  const baseline = { count: 2, sha256: allowlistDigest(pinned) };
  assert.deepEqual(readAllowlist(write(pinned, baseline)).permanent, pinned);
  assert.throws(
    () => readAllowlist(write([...pinned, entry('c.mjs')], baseline)),
    /grew from 2 to 3 permanent entries/u,
  );
  assert.throws(
    () => readAllowlist(write([entry('a.mjs'), entry('c.mjs')], baseline)),
    /no longer matches/u,
  );
  assert.throws(
    () => readAllowlist(write([entry('a.mjs')], baseline)),
    new RegExp(
      `set the baseline to \\{"count": 1, "sha256": "${allowlistDigest([entry('a.mjs')])}"\\}`,
      'u',
    ),
  );
  assert.throws(
    () => readAllowlist(write(pinned, baseline, { shrinking: [] })),
    /unsupported keys: shrinking/u,
  );
  assert.throws(
    () => readAllowlist(write([{ path: 'a.mjs', rule: 'env-read' }], baseline)),
    /invalid permanent entry/u,
  );
});

test('on a pull request every allowlist entry must already be on the base branch', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'planr-baseline-base-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const commit = (message) => {
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', message);
  };
  const entry = (path, rule = 'env-read', reason = 'local') => ({ path, rule, reason });
  const pin = (permanent) => {
    writeFileSync(
      join(root, 'scripts/plugin-network-boundary-allowlist.json'),
      JSON.stringify({ permanent }),
    );
    writeFileSync(
      join(root, 'scripts/plugin-network-boundary-baseline.json'),
      JSON.stringify({ count: permanent.length }),
    );
  };
  mkdirSync(join(root, 'scripts'));
  git('init', '-q');
  writeFileSync(
    join(root, 'scripts/plugin-network-boundary-allowlist.json'),
    JSON.stringify({ permanent: [entry('old.mjs', 'owner-key')] }),
  );
  commit('allowlist before the pin');
  pin([entry('a.mjs'), entry('b.mjs', 'network-send')]);
  assert.deepEqual(assertBaselineNotGrown('HEAD', root), { base: null });
  commit('pin');
  assert.deepEqual(assertBaselineNotGrown('HEAD', root), { base: 2 });
  pin([entry('a.mjs', 'env-read', 'reworded')]);
  assert.deepEqual(assertBaselineNotGrown('HEAD', root), { base: 2 });
  pin([entry('a.mjs'), entry('**', 'network-send')]);
  assert.throws(
    () => assertBaselineNotGrown('HEAD', root),
    /entries HEAD does not: \*\* \[network-send\]/u,
  );
  pin([entry('a.mjs'), entry('b.mjs', 'network-send'), entry('c.mjs')]);
  assert.throws(() => assertBaselineNotGrown('HEAD', root), /c\.mjs \[env-read\]/u);
  assert.throws(
    () => assertBaselineNotGrown('origin/main', root),
    /Cannot resolve origin\/main[\s\S]*fails closed/u,
  );
});

test('the committed allowlist matches its baseline and names only delegate and sync', () => {
  const { permanent } = readAllowlist(workspace);
  const baseline = JSON.parse(
    readFileSync(join(workspace, 'scripts/plugin-network-boundary-baseline.json'), 'utf8'),
  );
  assert.equal(permanent.length, baseline.count);
  assert.deepEqual(
    permanent.filter(({ path }) => !/^(?:skills|rules\/planr)[-/](?:delegate|sync)\//u.test(path)),
    [],
  );
});

test('the scan names a missing plugin bundle instead of passing', () => {
  assert.throws(
    () => scanPluginRoot(join(tmpdir(), 'planr-no-such-plugin')),
    /missing\. Run npm run generate first/u,
  );
});
