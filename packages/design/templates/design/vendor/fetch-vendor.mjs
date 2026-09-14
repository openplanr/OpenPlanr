#!/usr/bin/env node
/**
 * Refresh the vendored design runtime in this directory.
 *
 * The repo COMMITS the runtime (React UMD + the compiled DesignCanvas) so a
 * generated canvas opens offline with zero setup. Run this script only to
 * upgrade a pin or re-verify integrity:
 *
 *     node templates/design/vendor/fetch-vendor.mjs
 *
 * Steps:
 *   1. Download the pinned React + ReactDOM UMD production builds and verify
 *      each against its Subresource Integrity (SRI) hash. A mismatch aborts —
 *      the bytes will not be written.
 *   2. Recompile ../DesignCanvas.jsx → ./DesignCanvas.js with esbuild
 *      (classic JSX runtime, React.createElement), so the canvas needs no
 *      in-browser transpiler.
 *
 * Pure Node + one optional `npx esbuild`. No persistent dependencies.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REACT_VERSION = '18.3.1';

/** Pinned UMD assets. `sri` is sha384, base64 — regenerate when bumping the pin. */
const ASSETS = [
  {
    file: 'react.production.min.js',
    url: `https://unpkg.com/react@${REACT_VERSION}/umd/react.production.min.js`,
    sri: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  },
  {
    file: 'react-dom.production.min.js',
    url: `https://unpkg.com/react-dom@${REACT_VERSION}/umd/react-dom.production.min.js`,
    sri: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  },
];

function sri384(buf) {
  return 'sha384-' + createHash('sha384').update(buf).digest('base64');
}

async function fetchPinned({ file, url, sri }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sri384(buf);
  if (actual !== sri) {
    throw new Error(`integrity mismatch for ${file}\n  expected ${sri}\n  got      ${actual}`);
  }
  writeFileSync(join(HERE, file), buf);
  console.log(`  ✓ ${file} (${buf.length} bytes, SRI verified)`);
}

function compileCanvas() {
  const src = join(HERE, '..', 'DesignCanvas.jsx');
  const out = join(HERE, 'DesignCanvas.js');
  const js = execFileSync('npx', [
    '--yes', 'esbuild', src,
    '--jsx=transform',
    '--jsx-factory=React.createElement',
    '--jsx-fragment=React.Fragment',
  ], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(out, js);
  console.log(`  ✓ DesignCanvas.js (${Buffer.byteLength(js)} bytes, compiled from JSX)`);
}

async function main() {
  console.log(`Refreshing design vendor runtime (React ${REACT_VERSION})…`);
  for (const asset of ASSETS) await fetchPinned(asset);
  compileCanvas();
  console.log('Done.');
}

main().catch((err) => {
  console.error(`fetch-vendor failed: ${err.message}`);
  process.exitCode = 1;
});
