import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  assertDirectoryEntries,
  readDirectoryEntries,
} from '../../skills/plugin-artifact-validation.mjs';
import {
  renderMarketplaceManifest,
  renderPluginTable,
  replacePluginTable,
} from './marketplace.mjs';

const MANIFEST = '.claude-plugin/plugin.json';
const utf8 = new TextDecoder('utf-8', { fatal: true });

function sameEntries(expected, actual) {
  return (
    expected.length === actual.length &&
    expected.every(
      (entry, index) =>
        actual[index].path === entry.path &&
        actual[index].type === 'file' &&
        actual[index].bytes?.equals(entry.bytes) &&
        ((actual[index].mode & 0o111) !== 0) === (entry.mode === 0o755),
    )
  );
}

/** File bytes, or null when the file does not exist. */
function readOptional(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Renames staged bytes into place unless the destination changed since it was read. */
function commitFile(staged, destination, expected) {
  const current = readOptional(destination);
  if (expected === null ? current !== null : !current?.equals(expected))
    throw new Error(`${destination} changed while the marketplace update was prepared.`);
  renameSync(staged, destination);
}

/** Undo committed steps that still hold this update's bytes; keep anything changed since. */
function rollback({ error, committed, snapshot, target, previousPlugin, files, suffix }) {
  const kept = [];
  for (const [step, path, written, previous] of files) {
    if (!committed.includes(step)) continue;
    if (!readOptional(path)?.equals(written)) {
      kept.push(`${path} changed after the update and was left as is`);
      continue;
    }
    if (previous === null) rmSync(path);
    else {
      const restore = join(dirname(path), `.${suffix}-restore`);
      writeFileSync(restore, previous, { flag: 'wx' });
      renameSync(restore, path);
    }
  }
  if (committed.includes('plugin')) {
    if (!existsSync(target) || !sameEntries(snapshot, readDirectoryEntries(target))) {
      kept.push(`${target} changed after the update and was left as is`);
    } else {
      rmSync(target, { recursive: true });
      committed.splice(committed.indexOf('plugin'), 1);
    }
  }
  if (committed.includes('previous')) {
    if (committed.includes('plugin')) kept.push(`the previous plugin is kept at ${previousPlugin}`);
    else renameSync(previousPlugin, target);
  }
  if (kept.length)
    throw new Error(
      `Marketplace update failed (${error.message}); rollback stopped to keep concurrent changes: ${kept.join('; ')}.`,
      { cause: error },
    );
  throw new Error(`Marketplace update failed and was rolled back: ${error.message}`, {
    cause: error,
  });
}

/**
 * Replace `plugins/planr` in a marketplace checkout with an inspected snapshot of the plugin.
 * Plugin and metadata are staged first; previous copies are restored if any step fails.
 */
export function publishMarketplacePlugin({
  pluginDir,
  marketplaceDir,
  afterInspection,
  onCommitStep,
}) {
  const entries = readDirectoryEntries(pluginDir);
  const manifestEntry = entries.find(({ path }) => path === MANIFEST);
  if (!manifestEntry) {
    throw new Error(
      `${join(pluginDir, MANIFEST)} is missing. The generated plugin keeps its manifest in .claude-plugin/, so an artifact carrying it must be uploaded with include-hidden-files: true.`,
    );
  }
  assertDirectoryEntries(entries);
  let manifest;
  try {
    manifest = JSON.parse(utf8.decode(manifestEntry.bytes));
  } catch (error) {
    throw new Error(`${join(pluginDir, MANIFEST)} is not valid UTF-8 JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (
    manifest?.name !== 'planr' ||
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
  ) {
    throw new Error(
      'The plugin manifest must be the generated planr plugin with a release version',
    );
  }
  const snapshot = entries.map(({ path, bytes, mode }) => ({
    path,
    bytes: Buffer.from(bytes),
    mode: (mode & 0o111) !== 0 ? 0o755 : 0o644,
  }));
  afterInspection?.();

  const plugins = join(marketplaceDir, 'plugins');
  const target = join(plugins, 'planr');
  const metadataPath = join(marketplaceDir, '.claude-plugin/marketplace.json');
  const readmePath = join(marketplaceDir, 'README.md');
  const previousMetadata = readOptional(metadataPath);
  const previousReadme = readOptional(readmePath);
  const metadata = Buffer.from(
    `${JSON.stringify(renderMarketplaceManifest({ version: manifest.version, description: manifest.description }), null, 2)}\n`,
  );
  const readme = Buffer.from(
    replacePluginTable(
      previousReadme?.toString('utf8') ?? '# OpenPlanr Marketplace\n',
      renderPluginTable({ version: manifest.version, description: manifest.description }),
    ),
  );

  mkdirSync(plugins, { recursive: true });
  mkdirSync(dirname(metadataPath), { recursive: true });
  const staging = mkdtempSync(join(plugins, '.planr-staging-'));
  const suffix = basename(staging);
  const previousPlugin = `${staging}-previous`;
  const stagedMetadata = join(dirname(metadataPath), `.${suffix}-marketplace.json`);
  const stagedReadme = join(marketplaceDir, `.${suffix}-README.md`);
  const committed = [];
  try {
    for (const { path, bytes, mode } of snapshot) {
      const destination = join(staging, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: 'wx', mode });
      chmodSync(destination, mode);
    }
    if (!sameEntries(snapshot, readDirectoryEntries(staging)))
      throw new Error(`Staged plugin copy in ${staging} differs from the inspected plugin.`);
    writeFileSync(stagedMetadata, metadata, { flag: 'wx' });
    writeFileSync(stagedReadme, readme, { flag: 'wx' });

    try {
      if (existsSync(target)) {
        renameSync(target, previousPlugin);
        committed.push('previous');
      }
      renameSync(staging, target);
      committed.push('plugin');
      onCommitStep?.('plugin');
      commitFile(stagedMetadata, metadataPath, previousMetadata);
      committed.push('metadata');
      onCommitStep?.('metadata');
      commitFile(stagedReadme, readmePath, previousReadme);
      committed.push('readme');
    } catch (error) {
      rollback({
        error,
        committed,
        snapshot,
        target,
        previousPlugin,
        files: [
          ['metadata', metadataPath, metadata, previousMetadata],
          ['readme', readmePath, readme, previousReadme],
        ],
        suffix,
      });
    }
    rmSync(previousPlugin, { recursive: true, force: true });
  } finally {
    for (const leftover of [staging, stagedMetadata, stagedReadme])
      rmSync(leftover, { recursive: true, force: true });
  }
  return manifest;
}
