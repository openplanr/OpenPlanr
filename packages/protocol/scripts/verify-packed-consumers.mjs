#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { chromium } from 'playwright';

// The harness uses development tools from this workspace; every subject module
// is resolved from the supplied, independently installed consumer package.
const [projectArgument, outputArgument] = process.argv.slice(2);
assert.ok(projectArgument && outputArgument && process.argv.length === 4,
  'Usage: verify-packed-consumers.mjs <installed-consumer> <report.json>');
const project = await realpath(projectArgument);
const packageRoot = await realpath(join(project, 'node_modules/@openplanr/protocol'));
assert.ok(packageRoot.startsWith(`${project}${sep}`), 'Protocol installation escaped consumer');
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@openplanr/protocol');
assert.notEqual(manifest.private, true);
assert.deepEqual(manifest.dependencies ?? {}, {});

async function files(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.map(async (entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink(), `Unexpected package symlink: ${path}`);
    return entry.isDirectory() ? files(join(directory, entry.name), path) : [path];
  }));
  return results.flat().sort();
}
const inventory = await files(packageRoot);
assert.ok(!inventory.some((path) => /^(?:projections|preservation|conformance|node_modules|scripts)\//u.test(path)),
  'Protocol tarball contains workspace-only material');

const exports = [];
const types = [];
for (const [key, target] of Object.entries(manifest.exports)) {
  const runtime = typeof target === 'string' ? target : target.import ?? target.default;
  const name = key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`;
  if (target.types) types.push(name);
  if (key.includes('*')) {
    const [prefix, suffix] = runtime.slice(2).split('*');
    for (const file of inventory.filter((file) => file.startsWith(prefix) && file.endsWith(suffix))) {
      const captured = file.slice(prefix.length, suffix ? -suffix.length : undefined);
      if (file.endsWith('.mjs')) exports.push({ name: name.replace('*', captured), path: file });
    }
  } else {
    assert.ok(inventory.includes(runtime.slice(2)), `Missing export ${name}`);
    if (runtime.endsWith('.mjs')) exports.push({ name, path: runtime.slice(2) });
  }
}

// Compatibility adapters intentionally use the explicit Node schema loader.
const nodeOnly = new Set(['./contracts', './operate-experience-live-patch', './live-evidence-v2', './operating-planning-contracts']
  .map((key) => `${manifest.name}${key.slice(1)}`));
const portable = exports.filter(({ name }) => !nodeOnly.has(name));
const sharedChecks = `
let checks = 0;
function check(value, message) { checks++; if (!value) throw new Error(message); }
const p = modules[0];
check(p.sha256Jcs({ a: 1 }) === 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862', 'Digest mismatch');
check(p.verifyDocumentDigest(p.withDocumentDigest({ kind: 'consumer', schemaVersion: '1.0.0' })), 'Document digest mismatch');
check(p.validateJson({ n: 1 }, { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } }).length === 0, 'Valid schema rejected');
check(p.validateJson({ n: 'bad' }, { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } }).length > 0, 'Invalid schema accepted');
let refused = false;
try { p.assertEnterpriseRevision({ kind: 'enterprise-artifact-revision' }); } catch { refused = true; }
check(refused, 'Malformed enterprise revision accepted');
const handoff = p.createEnterpriseHandoff({ organizationId: 'acme', projectId: 'project', artifactId: 'diagram', revisionId: 'r1', generatedAt: '2026-09-14T00:00:00.000Z' });
p.assertEnterpriseHandoff(handoff);
check(p.renderEnterpriseHandoffMarkdown(handoff).length > 0, 'Handoff export missing');
for (const profile of ['flowchart', 'process', 'swimlane', 'architecture']) {
  const document = {
    kind: 'planr-diagram', schemaVersion: '1.0.0', protocolVersion: '1.13.0',
    diagramId: 'consumer-diagram', title: '', summary: '', audience: 'mixed',
    grammar: { id: profile, version: '1.0.0' },
    nodes: [], relations: [], groups: [], lanes: [], events: [], series: [], axes: [], sets: [],
    annotations: [], emphasis: [], laneOrder: [], accessibility: { title: '', description: '', readingOrder: [] },
  };
  document.documentDigest = p.diagramDocumentDigest(document);
  const presentation = {
    kind: 'diagram-presentation', schemaVersion: '1.0.0', protocolVersion: '1.13.0',
    diagramId: document.diagramId, semanticDigest: document.documentDigest, coordinateSystem: 'global-canvas',
    layout: { direction: 'left-right', detailTier: 'balanced' }, theme: { themeId: 'paper', mode: 'light' }, elements: [],
  };
  presentation.presentationDigest = p.diagramPresentationDigest(presentation);
  const authored = {
    kind: 'diagram-authoring-bundle', schemaVersion: '1.0.0', protocolVersion: '1.13.0',
    diagramId: document.diagramId, document, presentation, originalSource: null, sourceMap: null,
  };
  authored.bundleDigest = p.diagramAuthoringBundleDigest(authored);
  p.assertDiagramAuthoringBundle(authored);
  check(p.validateDiagramAuthoringBundle(JSON.parse(JSON.stringify(authored))).length === 0, 'Blank profile rejected: ' + profile);
  check(p.summarizeDiagramAuthoringContent(authored).hasVisibleContent === false, 'Blank profile invented visible content');
  const substituted = JSON.parse(JSON.stringify(authored));
  substituted.presentation.semanticDigest = 'sha256:' + '0'.repeat(64);
  substituted.presentation.presentationDigest = p.diagramPresentationDigest(substituted.presentation);
  substituted.bundleDigest = p.diagramAuthoringBundleDigest(substituted);
  check(p.validateDiagramAuthoringBundle(substituted).some(issue => issue.rule === 'basis'), 'Substituted semantic basis accepted');
}
check(p.validateDiagramAuthoringArtifact('diagram-authoring-capabilities', p.DIAGRAM_AUTHORING_CAPABILITIES).length === 0, 'Capability catalog rejected');
const summary = { exports: modules.length, checks };
`;

async function runNode() {
  const runner = join(project, 'protocol-node-consumer.mjs');
  const code = `import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const modules = await Promise.all(${JSON.stringify(exports.map(({ name }) => name))}.map(name => import(name)));
${sharedChecks}
const contracts = await import('@openplanr/protocol/contracts');
let schemas = 0;
for (const entry of contracts.listProtocolSchemas()) {
  const found = contracts.resolveProtocolSchema(entry.kind, { protocolVersion: entry.protocolVersion });
  assert.ok(found.schema.$id, entry.kind);
  schemas++;
}
let assets = 0;
for (const version of ['1.5.0','1.6.0','1.7.0','1.8.0','1.11.0','1.13.0']) {
  for (const kind of Object.keys(modules[0]['PROTOCOL_V' + version.replaceAll('.', '').slice(0,-1) + '_CONTRACTS'])) {
    const url = modules[0].protocolAssetUrl(kind, { protocolVersion: version });
    assert.ok(existsSync(url), String(url));
    JSON.parse(readFileSync(url, 'utf8')); assets++;
  }
}
console.log(JSON.stringify({ ...summary, schemas, assets, status: 'passed' }));`;
  await writeFile(runner, code);
  const result = spawnSync(process.execPath, [runner], { cwd: project, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const source = join(project, 'protocol-types.mts');
  await writeFile(source, types.map((name, index) => `import type * as Export${index} from ${JSON.stringify(name)};`).join('\n'));
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  const config = join(project, 'protocol-tsconfig.json');
  await writeFile(config, JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'ES2022', lib: ['ES2022','DOM'], module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }, files: [source] }));
  const compiled = spawnSync(process.execPath, [compiler, '--project', config], {
    cwd: project, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  return { ...JSON.parse(result.stdout), typedExports: types.length };
}

async function runBrowser() {
  const imports = Object.fromEntries(portable.map(({ name, path }) => [name, `/protocol/${path}`]));
  const runner = `const modules = await Promise.all(${JSON.stringify(portable.map(({ name }) => name))}.map(name => import(name)));
${sharedChecks}
let assets = 0;
for (const version of ['1.5.0','1.6.0','1.7.0','1.8.0','1.11.0','1.13.0']) {
  for (const kind of Object.keys(modules[0]['PROTOCOL_V' + version.replaceAll('.', '').slice(0,-1) + '_CONTRACTS'])) {
    const response = await fetch(modules[0].protocolAssetUrl(kind, { protocolVersion: version }));
    check(response.ok, 'Missing schema asset ' + kind + '@' + version);
    await response.json(); assets++;
  }
}
globalThis.protocolResult = { ...summary, assets, status: 'passed' };`;
  const pageHtml = `<!doctype html><html><head><script type="importmap">${JSON.stringify({ imports })}</script></head><body><script type="module">try { ${runner} } catch (error) { globalThis.protocolError = String(error.stack || error); }</script></body></html>`;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(pageHtml); return; }
      if (!url.pathname.startsWith('/protocol/')) { res.writeHead(404).end(); return; }
      const file = resolve(packageRoot, decodeURIComponent(url.pathname.slice('/protocol/'.length)));
      if (!file.startsWith(`${packageRoot}${sep}`)) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OPENPLANR_PROOF_CHROMIUM_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.protocolResult || globalThis.protocolError, { timeout: 30000 });
    const result = await page.evaluate(() => ({ report: globalThis.protocolResult, error: globalThis.protocolError }));
    assert.equal(result.error, undefined, result.error);
    return result.report;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runWorkers() {
  const entry = join(project, 'protocol-worker-entry.mjs');
  const output = join(project, 'protocol-worker.mjs');
  const imports = portable.map(({ name }, index) => `import * as module${index} from ${JSON.stringify(name)};`).join('\n');
  await writeFile(entry, `${imports}\nexport default { fetch() { const modules = [${portable.map((_, i) => `module${i}`).join(',')}]; ${sharedChecks} return Response.json({ ...summary, status: 'passed' }); } };`);
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'neutral', format: 'esm', target: 'es2022', logLevel: 'silent' });
  const runtime = new Miniflare({ modules: true, modulesRoot: project, scriptPath: output, compatibilityDate: '2026-07-08', log: new Log(LogLevel.ERROR) });
  try {
    const response = await runtime.dispatchFetch('https://protocol.test/');
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json();
  } finally { await runtime.dispose(); }
}

const node = await runNode();
const browser = await runBrowser();
const workers = await runWorkers();
await writeFile(outputArgument, `${JSON.stringify({ name: manifest.name, version: manifest.version, node, browser, workers }, null, 2)}\n`);
