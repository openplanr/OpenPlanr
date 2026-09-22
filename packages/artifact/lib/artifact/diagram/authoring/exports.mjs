import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, unlink } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

import { validateDiagramAuthoringArtifact } from '@openplanr/protocol/diagram-authoring-contracts';
import { digestBytes, jsonBytes } from '../custody/bytes.mjs';
import { renderDiagramPng, inspectDiagramPng } from '../rendering/png.mjs';
import { renderDiagramHtml } from '../rendering/html.mjs';
import { escapeXml } from '../rendering/svg.mjs';
import { snapshot, validateAuthoringBundle } from './model.mjs';
import { renderAuthoredDiagramSvg } from './renderer.mjs';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const fail = (code, detail, path = '$exports') => ({ ok: false, code, diagnostics: [{ path, rule: code, detail }] });
const abort = (code, detail) => { const error = new Error(detail); error.exportCode = code; throw error; };
const sameVersion = (left, right) => left?.id === right.id && left?.version === right.version;
const meta = kind => ({ kind, schemaVersion: '1.0.0', protocolVersion: '1.13.0' });

async function info(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function workspace(root) {
  if (typeof root !== 'string' || !root || root.includes('\0')) abort('unsafe-path', 'An existing workspace root is required.');
  const path = resolve(root), status = await info(path);
  if (!status?.isDirectory() || status.isSymbolicLink()) abort('unsafe-path', 'Workspace root must be an existing real directory.');
  const canonical = await realpath(path);
  if (canonical === sep) abort('unsafe-path', 'The filesystem root is not an export workspace.');
  return canonical;
}
async function directory(root, relativePath, create = false) {
  const segments = relativePath.split('/');
  if (isAbsolute(relativePath) || segments.some(value => !value || value === '.' || value === '..' || value.includes('\\'))) abort('unsafe-path', 'Export paths must remain below their workspace.');
  let path = root;
  for (const part of segments) {
    path = join(path, part);
    let status = await info(path);
    if (!status && create) { try { await mkdir(path); } catch (error) { if (error.code !== 'EEXIST') throw error; } status = await info(path); }
    if (!status) return null;
    if (status.isSymbolicLink() || !status.isDirectory()) abort('unsafe-path', 'Every export directory must be a real directory.');
  }
  return path;
}
async function regularBytes(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.nlink !== 1 || status.size > MAX_FILE_BYTES) abort('unsafe-member', 'Export members must be bounded regular files without links.');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function flushDirectory(path) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
function prepare(bundle, options) {
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return { ...checked, code: 'invalid-bundle' };
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['root', 'slug', 'rasterize'].includes(key))) return fail('invalid-options', 'Only root, slug and an optional rasterize adapter are accepted.');
  if (![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) return fail('invalid-options', 'Export options must contain only explicit data properties.');
  if (options.rasterize !== undefined && typeof options.rasterize !== 'function') return fail('invalid-options', 'The rasterize adapter must be a function.');
  const slug = options.slug === undefined ? bundle.diagramId : options.slug;
  if (typeof slug !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 128) return fail('unsafe-path', 'The export slug must be a bounded lowercase identifier.');
  bundle = JSON.parse(JSON.stringify(bundle));
  const rendered = renderAuthoredDiagramSvg(bundle);
  if (!rendered.ok) return rendered;
  const theme = { id: rendered.theme.id, version: rendered.theme.version };
  const renderKey = digestBytes(jsonBytes({ renderer: rendered.renderer, theme })).slice(7);
  const relativeDirectory = `diagrams/${slug}/exports/${bundle.bundleDigest.slice(7)}/${renderKey}`;
  return { ok: true, bundle, slug, rendered, theme, relativeDirectory, bundleBytes: jsonBytes(bundle) };
}
function fidelity(bundle, targetFormat) {
  return { ...meta('diagram-fidelity-report'), diagramId: bundle.diagramId, basis: snapshot(bundle),
    sourceDigest: bundle.originalSource?.sourceDigest ?? null, sourceFormat: 'planr-diagram-bundle', targetFormat,
    semantic: 'partial', presentation: 'lossless', sourceText: 'unsupported', losses: [
      { dimension: 'semantic', code: 'visual-snapshot', elementIds: [], message: 'This visual output does not replace the editable bundle snapshot.' },
      { dimension: 'sourceText', code: 'source-in-bundle-only', elementIds: [], message: 'Original source and correspondence remain in the separate immutable bundle snapshot.' },
    ] };
}
function reportSection(bundle, rendered) {
  const report = { diagramId: bundle.diagramId, basis: snapshot(bundle), renderer: rendered.renderer,
    theme: { id: rendered.theme.id, version: rendered.theme.version }, quality: rendered.quality,
    canvas: { width: rendered.scene.width, height: rendered.scene.height }, editableSource: 'snapshot.planr-diagram-bundle.json' };
  return `<section aria-label="Export quality report"><h2>Export report</h2><p>These outputs are visual snapshots. Use the immutable bundle snapshot to retain editable content.</p><pre>${escapeXml(JSON.stringify(report, null, 2))}</pre></section>`;
}
function reviewHtml(bundle, rendered) {
  return renderDiagramHtml({ ...bundle.document, layout: bundle.presentation.layout }, rendered.svg, { theme: rendered.theme }).replace('</body>', `${reportSection(bundle, rendered)}</body>`);
}
async function verifyDirectory(root, bundle, prepared) {
  const target = await directory(root, prepared.relativeDirectory);
  if (!target) return fail('exports-missing', 'No complete export set exists for this snapshot and renderer.');
  const manifestBytes = await regularBytes(join(target, 'manifest.json'));
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { return fail('invalid-manifest', 'Export manifest is not valid JSON.'); }
  const diagnostics = validateDiagramAuthoringArtifact('diagram-manifest', manifest, { bundle });
  if (diagnostics.length) return { ok: false, code: 'invalid-manifest', diagnostics };
  if (!sameVersion(manifest.renderer, prepared.rendered.renderer) || !sameVersion(manifest.theme, prepared.theme)) return fail('stale-renderer', 'Export renderer and theme must match the current supported renderer.');
  const prefix = `${prepared.relativeDirectory}/`;
  const expectedOutputs = new Map([['diagram.svg', 'image/svg+xml'], ['diagram.png', 'image/png'], ['review.html', 'text/html']]);
  if (manifest.bundle.path !== `${prefix}snapshot.planr-diagram-bundle.json` || manifest.bundle.transportDigest !== digestBytes(prepared.bundleBytes)) return fail('snapshot-mismatch', 'The export manifest must identify these exact immutable bundle bytes.');
  const source = await regularBytes(join(target, 'snapshot.planr-diagram-bundle.json'));
  if (!source.equals(prepared.bundleBytes)) return fail('snapshot-mismatch', 'The immutable export source does not match the requested bundle.');
  if (manifest.outputs.length !== expectedOutputs.size) return fail('incomplete-exports', 'The export manifest must name the complete visual output set.');
  const names = new Set(['manifest.json', 'snapshot.planr-diagram-bundle.json']);
  for (const output of manifest.outputs) {
    const name = basename(output.path);
    if (output.path !== `${prefix}${name}` || !expectedOutputs.has(name) || expectedOutputs.get(name) !== output.mediaType || names.has(name)) return fail('unexpected-output', 'The manifest contains an unexpected or substituted output member.');
    names.add(name);
    const bytes = await regularBytes(join(target, name));
    if (name === 'diagram.svg' && !bytes.equals(Buffer.from(prepared.rendered.svg))) return fail('stale-output', 'SVG content does not match the current authored renderer.');
    if (name === 'review.html' && !bytes.equals(Buffer.from(reviewHtml(bundle, prepared.rendered)))) return fail('stale-output', 'Review HTML does not match the current authored scene and quality report.');
    if (name === 'diagram.png') {
      const dimensions = inspectDiagramPng(bytes);
      if (dimensions.width !== Math.ceil(prepared.rendered.scene.width) || dimensions.height !== Math.ceil(prepared.rendered.scene.height)) return fail('raster-dimensions', 'PNG dimensions do not match the authored scene.');
    }
    if (digestBytes(bytes) !== output.transportDigest) return fail('output-mismatch', `The ${name} bytes do not match the export manifest.`);
  }
  if ((await readdir(target)).some(name => !names.has(name))) return fail('unowned-collision', 'The export directory contains unowned files.');
  return { ok: true, directory: target, manifest, quality: prepared.rendered.quality };
}

/**
 * Read-only custody check against an immutable bundle, never the mutable latest file.
 * SVG and HTML are rederived; PNG is checked by digest and dimensions without
 * rerasterization. The manifest is not a signature: replacing both a PNG and its
 * declared digest requires an independently trusted transport manifest to detect.
 */
export async function verifyAuthoredDiagramExports(bundle, options) {
  try {
    const prepared = prepare(bundle, options);
    if (!prepared.ok) return prepared;
    return await verifyDirectory(await workspace(options.root), prepared.bundle, prepared);
  } catch (error) { return fail(error.exportCode ?? 'export-verification-failed', 'The complete export set could not be verified safely.'); }
}

/**
 * Stage and atomically promote one immutable derived set; never write canonical source.
 * An interrupted process can leave its lock/stage behind. Those are deliberately
 * not reclaimed automatically: confirm no exporter is active, verify any complete
 * snapshot outputs, then explicitly recover only that operation's lock/stage.
 */
export async function exportAuthoredDiagram(bundle, options) {
  try { return await stageAuthoredDiagramExports(bundle, options); }
  catch { return fail('export-cleanup-pending', 'Export cleanup could not be confirmed. Verify this snapshot output and recover its inactive lock or staging directory before retrying.'); }
}
async function stageAuthoredDiagramExports(bundle, options) {
  let stage, lock, lockPath;
  try {
    const prepared = prepare(bundle, options);
    if (!prepared.ok) return prepared;
    bundle = prepared.bundle;
    const root = await workspace(options.root);
    const existing = await directory(root, prepared.relativeDirectory);
    if (existing) {
      const verified = await verifyDirectory(root, bundle, prepared);
      return verified.ok ? { ...verified, status: 'unchanged', scene: prepared.rendered.scene, theme: prepared.rendered.theme } : verified;
    }
    const rendered = prepared.rendered;
    const raster = await (options.rasterize ?? renderDiagramPng)(rendered.svg, { scale: 1, theme: rendered.theme });
    const png = Buffer.from(raster.bytes);
    const dimensions = inspectDiagramPng(png);
    if (dimensions.width !== Math.ceil(rendered.scene.width) || dimensions.height !== Math.ceil(rendered.scene.height)) return fail('raster-dimensions', 'PNG dimensions do not match the authored scene at its declared scale.');
    const files = new Map([
      ['snapshot.planr-diagram-bundle.json', prepared.bundleBytes],
      ['diagram.svg', Buffer.from(rendered.svg)], ['diagram.png', png],
      ['review.html', Buffer.from(reviewHtml(bundle, rendered))],
    ]);
    const formats = { 'diagram.svg': ['image/svg+xml', 'svg'], 'diagram.png': ['image/png', 'png'], 'review.html': ['text/html', 'html'] };
    const manifest = { ...meta('diagram-manifest'), diagramId: bundle.diagramId, basis: snapshot(bundle),
      bundle: { path: `${prepared.relativeDirectory}/snapshot.planr-diagram-bundle.json`, transportDigest: digestBytes(prepared.bundleBytes) },
      renderer: rendered.renderer, theme: prepared.theme,
      outputs: Object.entries(formats).map(([name, [mediaType, format]]) => ({ path: `${prepared.relativeDirectory}/${name}`, mediaType, transportDigest: digestBytes(files.get(name)), fidelity: fidelity(bundle, format) })) };
    const diagnostics = validateDiagramAuthoringArtifact('diagram-manifest', manifest, { bundle });
    if (diagnostics.length) return { ok: false, code: 'invalid-manifest', diagnostics };
    files.set('manifest.json', jsonBytes(manifest));
    const parentRelative = prepared.relativeDirectory.slice(0, prepared.relativeDirectory.lastIndexOf('/'));
    const parent = await directory(root, parentRelative, true);
    const name = basename(prepared.relativeDirectory);
    lockPath = join(parent, `.${name}.lock`);
    lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    // A competing renderer may have completed while this render was being prepared.
    if (await directory(root, prepared.relativeDirectory)) {
      const verified = await verifyDirectory(root, bundle, prepared);
      return verified.ok ? { ...verified, status: 'unchanged', scene: rendered.scene, theme: rendered.theme } : verified;
    }
    stage = await mkdtemp(join(parent, `.${name}.stage-`));
    for (const [file, bytes] of files) {
      const handle = await open(join(stage, file), 'wx', 0o444);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      if (!(await regularBytes(join(stage, file))).equals(bytes)) abort('staging-mismatch', 'Staged output bytes changed before promotion.');
    }
    await flushDirectory(stage);
    await directory(root, parentRelative); // Recheck containment immediately before promotion.
    if (await info(join(parent, name))) abort('unowned-collision', 'The immutable output target appeared during rendering.');
    await rename(stage, join(parent, name)); stage = null;
    await flushDirectory(parent);
    return { ok: true, status: 'created', directory: join(parent, name), manifest, scene: rendered.scene, quality: rendered.quality, theme: rendered.theme };
  } catch (error) {
    return fail(error.exportCode ?? (error.code === 'EEXIST' ? 'exports-busy' : 'export-failed'), error.exportCode ? error.message : 'Export did not complete; canonical content and prior complete exports were preserved.');
  } finally {
    let cleanupError;
    if (stage) { try { await rm(stage, { recursive: true, force: true }); } catch (error) { cleanupError = error; } }
    if (lock) {
      let held;
      try { held = await lock.stat(); } catch (error) { cleanupError ??= error; }
      try { await lock.close(); } catch (error) { cleanupError ??= error; }
      // Retain the lock if staging cleanup is uncertain. Never delete a replaced lock.
      if (!cleanupError) {
        try {
          const current = await info(lockPath);
          if (current && (current.ino !== held.ino || current.dev !== held.dev)) abort('export-cleanup-pending', 'Export lock ownership changed during cleanup.');
          if (current) await unlink(lockPath);
        } catch (error) { cleanupError = error; }
      }
    }
    if (cleanupError) throw cleanupError;
  }
}
