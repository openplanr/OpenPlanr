#!/usr/bin/env node
// Append the publication rows for published bundles to docs/PROVENANCE.md.
// Usage: node scripts/release-train/record-provenance.mjs --bundles <dir> --run-id <id>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendProvenanceRows, payloadDigest, renderProvenanceRow } from './lib/notes.mjs';
import { bundleDirectory } from './lib/targets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const bundlesDir = resolve(flag('--bundles', 'release'));
const runId = flag('--run-id', process.env.GITHUB_RUN_ID);
if (!runId) throw new Error('Usage: record-provenance.mjs --bundles <dir> --run-id <id>');

const { commit, published } = JSON.parse(readFileSync(join(bundlesDir, 'published.json'), 'utf8'));
const rows = published.map((entry) => {
  const { digest } = payloadDigest(join(bundlesDir, bundleDirectory(entry.name), entry.filename));
  return renderProvenanceRow({
    name: entry.name,
    version: entry.version,
    publishedAt: entry.publishedAt,
    runId,
    commit,
    payloadSha256: digest,
    integrity: entry.integrity,
  });
});
const path = join(root, 'docs/PROVENANCE.md');
const { document, added } = appendProvenanceRows(readFileSync(path, 'utf8'), rows);
writeFileSync(path, document);
console.log(`docs/PROVENANCE.md: ${added} row(s) added`);
