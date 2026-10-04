import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { publishMarketplacePlugin } from '../../scripts/release-train/lib/publish-plugin.mjs';
import { readDirectoryEntries } from '../../scripts/skills/plugin-artifact-validation.mjs';

const script = resolve(import.meta.dirname, '../../scripts/release-train/publish-marketplace.mjs');
const manifest = JSON.stringify({ name: 'planr', version: '2.0.1', description: 'Planr.' });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-marketplace-'));
  t.after(() => {
    chmodSync(join(root, 'marketplace/plugins'), 0o755);
    rmSync(root, { recursive: true, force: true });
  });
  const plugin = join(root, 'plugin');
  const marketplace = join(root, 'marketplace');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(plugin, 'scripts'));
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), manifest);
  writeFileSync(join(plugin, 'scripts/run.mjs'), 'console.log("new");\n', { mode: 0o755 });
  mkdirSync(join(marketplace, 'plugins/planr'), { recursive: true });
  writeFileSync(join(marketplace, 'plugins/planr/old.txt'), 'published plugin\n');
  writeFileSync(join(marketplace, 'README.md'), '# Marketplace\n');
  mkdirSync(join(marketplace, '.claude-plugin'));
  writeFileSync(join(marketplace, '.claude-plugin/marketplace.json'), '{"published":true}\n');
  return { root, plugin, marketplace };
}

const snapshot = (directory) =>
  readDirectoryEntries(directory).map(({ path, bytes, mode }) => [
    path,
    bytes.toString('utf8'),
    mode & 0o111,
  ]);
const publish = (plugin, marketplace) =>
  spawnSync(process.execPath, [script, '--plugin', plugin, '--marketplace', marketplace], {
    encoding: 'utf8',
    timeout: 30000,
  });

test('the inspected plugin replaces the published copy with exact bytes and modes', (t) => {
  const { plugin, marketplace } = fixture(t);
  const result = publish(plugin, marketplace);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(join(marketplace, 'plugins/planr')), snapshot(plugin));
  assert.equal(statSync(join(marketplace, 'plugins/planr/scripts/run.mjs')).mode & 0o111, 0o111);
  assert.deepEqual(readdirSync(join(marketplace, 'plugins')), ['planr']);
  assert.deepEqual(
    snapshot(marketplace)
      .map(([path]) => path)
      .filter((path) => !path.startsWith('plugins/planr/')),
    ['.claude-plugin/marketplace.json', 'README.md'],
  );
  assert.equal(
    JSON.parse(readFileSync(join(marketplace, '.claude-plugin/marketplace.json'), 'utf8')).metadata
      .version,
    '2.0.1',
  );
});

test('malformed, oversized and linked manifests fail before the marketplace changes', (t) => {
  const cases = [
    ['malformed', /not valid UTF-8 JSON/u, (path) => writeFileSync(path, '{"name":')],
    ['oversized', /text-size/u, (path) => writeFileSync(path, ' '.repeat(256 * 1024) + manifest)],
    [
      'linked',
      /non-regular-entry/u,
      (path, root) => {
        writeFileSync(join(root, 'outside.json'), manifest);
        rmSync(path);
        symlinkSync(join(root, 'outside.json'), path);
      },
    ],
    ['missing', /include-hidden-files/u, (path) => rmSync(path)],
  ];
  for (const [name, message, prepare] of cases) {
    const { root, plugin, marketplace } = fixture(t);
    prepare(join(plugin, '.claude-plugin/plugin.json'), root);
    const before = snapshot(marketplace);
    const result = publish(plugin, marketplace);
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, message, name);
    assert.deepEqual(snapshot(marketplace), before, name);
  }
});

test('source edits after inspection cannot change the installed bytes', (t) => {
  const { plugin, marketplace } = fixture(t);
  const inspected = snapshot(plugin);
  publishMarketplacePlugin({
    pluginDir: plugin,
    marketplaceDir: marketplace,
    afterInspection: () => {
      writeFileSync(join(plugin, 'scripts/run.mjs'), 'console.log("uninspected");\n');
      writeFileSync(join(plugin, 'scripts/added.mjs'), 'console.log("uninspected");\n');
      chmodSync(join(plugin, 'scripts/run.mjs'), 0o644);
    },
  });
  assert.deepEqual(snapshot(join(marketplace, 'plugins/planr')), inspected);
});

test('a failed staging leaves the published plugin intact', (t) => {
  const { plugin, marketplace } = fixture(t);
  const before = snapshot(marketplace);
  chmodSync(join(marketplace, 'plugins'), 0o555);
  assert.throws(
    () => publishMarketplacePlugin({ pluginDir: plugin, marketplaceDir: marketplace }),
    /EACCES/u,
  );
  chmodSync(join(marketplace, 'plugins'), 0o755);
  assert.deepEqual(snapshot(marketplace), before);
  assert.deepEqual(readdirSync(join(marketplace, 'plugins')), ['planr']);
});

test('an unusable metadata location fails before the published plugin is replaced', (t) => {
  const { plugin, marketplace } = fixture(t);
  rmSync(join(marketplace, '.claude-plugin'), { recursive: true });
  writeFileSync(join(marketplace, '.claude-plugin'), 'not a directory\n');
  const before = snapshot(marketplace);
  const result = publish(plugin, marketplace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST|ENOTDIR/u);
  assert.deepEqual(snapshot(marketplace), before);
});

test('a failure after the plugin swap restores the previous plugin and metadata', (t) => {
  for (const failingStep of ['plugin', 'metadata']) {
    const { plugin, marketplace } = fixture(t);
    const before = snapshot(marketplace);
    assert.throws(
      () =>
        publishMarketplacePlugin({
          pluginDir: plugin,
          marketplaceDir: marketplace,
          onCommitStep: (step) => {
            if (step === failingStep) throw new Error(`interrupted after ${step}`);
          },
        }),
      new RegExp(`rolled back: interrupted after ${failingStep}`, 'u'),
    );
    assert.deepEqual(snapshot(marketplace), before, failingStep);
  }
});

test('a README edited during the update fails the update and keeps the edit', (t) => {
  const { plugin, marketplace } = fixture(t);
  const before = snapshot(marketplace);
  const edited = '# Marketplace\n\nMaintainer note.\n';
  assert.throws(
    () =>
      publishMarketplacePlugin({
        pluginDir: plugin,
        marketplaceDir: marketplace,
        onCommitStep: (step) => {
          if (step === 'metadata') writeFileSync(join(marketplace, 'README.md'), edited);
        },
      }),
    /rolled back: .*README\.md changed while the marketplace update was prepared/u,
  );
  assert.deepEqual(
    snapshot(marketplace),
    before.map((entry) => (entry[0] === 'README.md' ? [entry[0], edited, entry[2]] : entry)),
  );
});

test('rollback keeps a plugin changed after the swap and retains the previous copy', (t) => {
  const { plugin, marketplace } = fixture(t);
  let error;
  try {
    publishMarketplacePlugin({
      pluginDir: plugin,
      marketplaceDir: marketplace,
      onCommitStep: (step) => {
        if (step !== 'plugin') return;
        writeFileSync(join(marketplace, 'plugins/planr/scripts/run.mjs'), 'console.log("edit");\n');
        throw new Error('interrupted after plugin');
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert.match(error?.message ?? '', /rollback stopped to keep concurrent changes/u);
  const kept = /previous plugin is kept at (\S+?)\.$/u.exec(error.message)?.[1];
  assert.ok(kept, error.message);
  assert.deepEqual(snapshot(kept), [['old.txt', 'published plugin\n', 0]]);
  assert.equal(
    readFileSync(join(marketplace, 'plugins/planr/scripts/run.mjs'), 'utf8'),
    'console.log("edit");\n',
  );
  assert.equal(
    readFileSync(join(marketplace, '.claude-plugin/marketplace.json'), 'utf8'),
    '{"published":true}\n',
  );
});
