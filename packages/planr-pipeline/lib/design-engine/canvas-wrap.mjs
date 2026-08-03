/**
 * canvas-wrap — render a single design-loop variant (an SVG or PNG file) inside
 * the SAME DesignCanvas shell the /design-review flow uses, so the board shows
 * each variant as a real pan/zoom canvas instead of a flat image.
 *
 * The board already renders any `type:'html'` variant as the pannable canvas
 * iframe; this module produces that html. We wrap the existing variant image as
 * ONE artboard (markup is just an <img> sized to the image), inject it into
 * templates/design/canvas-shell.html through the same `GENERATOR:data` contract
 * /design uses, and rely on the vendored React + DesignCanvas runtime copied
 * alongside. Every spec-derived string goes through embedJson()/escapeHtml()
 * (SPEC-015 S1) — never hand-concatenated into the <script>.
 *
 * The artboard id is the VARIANT LETTER (a `data-dc-slot`), so a pin dropped on
 * the canvas anchors to a stable, per-variant slot that survives re-wraps on
 * iterate — and the board scopes those pins to their variant.
 *
 * Pure, stdlib-only. No network.
 */

import { readFileSync } from 'node:fs';
import { embedJson, escapeHtml } from '../design/escape.mjs';

/** Canonical desktop frame — the fallback when an image declares no size. */
const FALLBACK = Object.freeze({ width: 1440, height: 1024 });

/**
 * Best-effort intrinsic pixel dimensions of an SVG or PNG so the artboard frame
 * matches the design's aspect (no letterboxing). Falls back to a desktop frame
 * when the size can't be read — the canvas still pans/zooms, just framed wider.
 *
 * @param {string} filePath
 * @returns {{ width: number, height: number }}
 */
export function imageDimensions(filePath) {
  try {
    if (/\.svg$/i.test(filePath)) {
      const svg = readFileSync(filePath, 'utf8');
      const open = svg.slice(0, svg.indexOf('>') >= 0 ? svg.indexOf('>') + 1 : 4096);
      const tag = /<svg[\s\S]*?>/i.exec(svg);
      const head = tag ? tag[0] : open;
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(head);
      if (vb) return round(Number(vb[1]), Number(vb[2]));
      const w = /\bwidth\s*=\s*["']?\s*([\d.]+)/i.exec(head);
      const h = /\bheight\s*=\s*["']?\s*([\d.]+)/i.exec(head);
      if (w && h) return round(Number(w[1]), Number(h[1]));
    } else if (/\.png$/i.test(filePath)) {
      const buf = readFileSync(filePath);
      // PNG: 8-byte signature, then the IHDR chunk (length+type+W+H…); width is a
      // big-endian uint32 at offset 16, height at offset 20.
      if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
        return round(buf.readUInt32BE(16), buf.readUInt32BE(20));
      }
    }
  } catch (e) { /* unreadable — fall through to the default frame */ }
  return { ...FALLBACK };
}

function round(w, h) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  return { width: W, height: H };
}

/**
 * Build the DesignCanvas data for ONE variant image: a single section with a
 * single artboard whose markup is the image at full artboard width. The artboard
 * id is the variant letter so it becomes a stable `data-dc-slot` pin anchor.
 *
 * @param {{ variantId: string, label?: string, src: string, width: number, height: number }} v
 * @returns {{ sections: Array<object> }}
 */
export function buildImageCanvasData({ variantId, label, src, width, height }) {
  const name = label || `Variant ${variantId}`;
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" `
    + `style="display:block;width:100%;height:auto" draggable="false" />`;
  return {
    sections: [{
      id: `s-${variantId}`,
      title: name,
      artboards: [{ id: variantId, label: name, width, height, html: img }],
    }],
  };
}

/**
 * Inject canvas data + title into the canvas shell, producing a self-contained
 * canvas.html-equivalent for one variant. embedJson() neutralizes any `</script>`
 * / U+2028 in the (image-derived) strings before they enter the inline script.
 *
 * @param {{ shellHtml: string, data: object, title?: string }} args
 * @returns {string}
 */
export function wrapInCanvas({ shellHtml, data, title }) {
  let html = shellHtml.replace('/* GENERATOR:data */ { sections: [] }', embedJson(data));
  if (title) html = html.replace('<!-- GENERATOR:title -->', escapeHtml(title));
  return html;
}

/** Render rank: a variant is shown as its richest available form. */
const VARIANT_RANK = Object.freeze({ html: 3, svg: 2, image: 1 });

/**
 * Resolve a loop session's `variant-*.{png,svg,html}` files into ONE stage
 * artifact per variant letter, preferring the canvas wrapper (`.html`) over the
 * bare image so the board renders each variant pannable — and degrading to the
 * source image for legacy sessions (or when the wrap was skipped). The source
 * image always stays on disk; this only decides what the stage loads.
 *
 * @param {string[]} fileNames  directory listing (basenames)
 * @returns {Array<{ id: string, label: string, src: string, type: 'html'|'svg'|'image' }>}
 */
export function discoverVariants(fileNames) {
  const byLetter = new Map();
  for (const f of fileNames) {
    const m = /^variant-([A-Z])\.(png|svg|html)$/.exec(f);
    if (!m) continue;
    const type = m[2] === 'html' ? 'html' : m[2] === 'png' ? 'image' : 'svg';
    const prev = byLetter.get(m[1]);
    if (!prev || VARIANT_RANK[type] > VARIANT_RANK[prev.type]) {
      byLetter.set(m[1], { id: m[1], label: f, src: f, type });
    }
  }
  return [...byLetter.keys()].sort().map((k) => byLetter.get(k));
}
