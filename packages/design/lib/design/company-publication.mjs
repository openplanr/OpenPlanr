/** Read-only selective company publication using the existing design bundle. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import { assertCompanyDesignBundle, COMPANY_DESIGN_MAX_BYTES } from '@openplanr/protocol/design-publication-contracts';
import { prepareDesignDocument } from './document.mjs';
import { bundleDesignRevision } from './context.mjs';

const sensitive = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?:sk_live_|ghp_|github_pat_)[A-Za-z0-9_]{20,}|(?:authorization["']?\s*[:=]\s*["']?bearer\s+)[A-Za-z0-9._-]{20,}/iu;
const localPath = /(?:file:\/\/|\/(?:Users|home|private|tmp|var|etc|opt|Volumes)\/|[A-Za-z]:\\|\\\\)/u;
const forbiddenPart = /^(?:\.git|node_modules|\.ssh|\.local|\.design|\.codex|\.claude|\.aws|\.azure|\.config|\.env(?:\..*)?|credentials(?:\..*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?)$/iu;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const mediaKinds = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };

function assertPublicContent(content) {
  const pending = [content], seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (localPath.test(value) || sensitive.test(value)) throw new Error('Company design output contains a local filesystem path or credential. Use share-safe screen content and review guidance.');
    for (const [, encoded] of value.matchAll(/data:image\/svg\+xml;base64,([A-Za-z\d+/=]+)/giu)) {
      if (seen.has(encoded)) continue;
      seen.add(encoded);
      pending.push(Buffer.from(encoded, 'base64').toString('utf8'));
    }
  }
}

/** Separate source guard so mutation detection can be exercised deterministically. */
export function createCompanyDesignSourceReader(file, maxBytes) {
  const selected = resolve(file), selectedRoot = dirname(selected), root = realpathSync(selectedRoot);
  const snapshots = new Map();
  let totalBytes = 0;
  function readSource(path, from = root) {
    if (typeof path !== 'string' || !path || /[\x00-\x1f\x7f%?#\\]/u.test(path) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) throw new Error('Company design sources must be local relative files.');
    // The initial document may be an absolute caller selection; dependencies may not.
    if (isAbsolute(path) && resolve(path) !== selected && resolve(path) !== join(root, basename(selected))) throw new Error('Absolute dependency paths cannot be published.');
    const candidate = resolve(path === selected ? root : from, path === selected ? basename(selected) : path);
    const name = relative(root, candidate).split('\\').join('/');
    if (!name || name === '..' || name.startsWith('../') || isAbsolute(name) || name.split('/').some(part => forbiddenPart.test(part))) throw new Error('Company design sources cannot include secrets, internal state or files outside the design directory.');
    let current = root;
    for (const part of name.split('/')) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error('Company design source paths must not contain symbolic links.');
    }
    const before = lstatSync(candidate, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes)) throw new Error('Company design source exceeds the regular-file publication budget.');
    let descriptor, value, after;
    try {
      descriptor = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = fstatSync(descriptor, { bigint: true });
      if (!sameFile(before, opened) || realpathSync(candidate) !== candidate) throw new Error('Company design source changed during preparation. Retry after saving.');
      value = readFileSync(descriptor);
      after = fstatSync(descriptor, { bigint: true });
      if (!sameFile(opened, after) || !sameFile(after, lstatSync(candidate, { bigint: true }))) throw new Error('Company design source changed during preparation. Retry after saving.');
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
    const digest = sha256Hex(value), prior = snapshots.get(name);
    if (prior && (prior.digest !== digest || !sameFile(prior.stat, after))) throw new Error('Company design source changed during preparation. Retry after saving.');
    if (!prior) {
      totalBytes += value.byteLength;
      if (snapshots.size >= 256 || totalBytes > maxBytes) throw new Error('Company design sources exceed the publication budget.');
      // Inspect source bytes, including scripts that will be omitted, before any
      // of them can become data URLs inside the published HTML.
      if (sensitive.test(value.toString('utf8'))) throw new Error('A selected design source appears to contain credentials. Remove them before sharing.');
      snapshots.set(name, { digest, stat: after });
    }
    return { file: candidate, value };
  }
  function verify() {
    for (const name of [...snapshots.keys()]) readSource(name, root);
    return Object.fromEntries([...snapshots].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => [name, value.digest]));
  }
  return { root, readSource, verify };
}

/** No source writes, render cache, network access or script execution. */
export function prepareCompanyDesignPublication(file, { maxBytes = COMPANY_DESIGN_MAX_BYTES } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > COMPANY_DESIGN_MAX_BYTES) throw new TypeError('Company design publication budget must be between 1 byte and 1 MiB.');
  const reader = createCompanyDesignSourceReader(file, maxBytes);
  const document = JSON.parse(reader.readSource(file, process.cwd()).value.toString('utf8'));
  const screenCount = document.screens?.length, frameCount = document.frames?.length;
  const variantCount = Array.isArray(document.variants) ? document.variants.filter(item => item?.status === 'ready').length : 0;
  if (!Number.isInteger(screenCount) || screenCount < 1 || screenCount > 64 || !Number.isInteger(frameCount) || frameCount < 1 || frameCount > 16 || variantCount < 1 || variantCount > 16 || screenCount * frameCount * variantCount > 256) throw new Error('Company design publication supports up to 64 screens, 16 frames, 16 ready variants and 256 artboards in total.');
  const prepared = prepareDesignDocument(file, { readSource: reader.readSource, passive: true, maxBytes });
  const bundle = bundleDesignRevision(prepared);
  // The existing source-free bundle intentionally excludes authored paths,
  // private manifests, local review storage and source provenance.
  const content = canonicalizeJson(bundle);
  assertPublicContent(content);
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > maxBytes) throw new Error('Bundled company design exceeds the publication budget. Reduce selected screens, frames, variants or media size.');
  assertCompanyDesignBundle(bundle);
  const sourceDigests = reader.verify(), sourceFiles = Object.keys(sourceDigests);
  return {
    bundle, content, sourceFiles, sourceDigests, byteLength,
    designId: bundle.design.id, screenCount: bundle.design.screens.length,
    frameCount: bundle.design.frames.length, variantCount: bundle.design.variants.length,
    mediaKinds: [...new Set(sourceFiles.map(name => mediaKinds[extname(name).toLowerCase()]).filter(Boolean))].sort(),
    warnings: ['Company design previews are passive snapshots. Authored scripts and event handlers are omitted; interactive forms and prototype behavior are not published.'],
  };
}
