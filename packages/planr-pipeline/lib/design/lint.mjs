/**
 * Deterministic design linter for `/planr-pipeline:design` output (SPEC-015
 * follow-up, v0.16.0).
 *
 * The engineering guarantee behind "consistent, accurate sizing/spacing":
 * instead of trusting the model's self-review, we PARSE the generated HTML/CSS
 * and FAIL on the defect classes that make a layout look amateur — then the
 * generator snaps every finding to the token scale and re-lints until clean.
 *
 * Catches (statically, no browser needed):
 *   • spacing-off-grid (ERROR) — a padding/margin/gap/inset value off the
 *     4-point grid (the `13px`/`14px`/`17px` drift), in a <style> rule OR an
 *     inline style.
 *   • frame-not-canonical (ERROR) — a canvas artboard not at the canonical
 *     1440×1024 desktop frame (the per-screen 760/700/820 size drift).
 *   • inline-sizing-drift (WARN) — a classed element carrying inline sizing
 *     (width/height/padding/margin/font-size): the mechanism by which
 *     "same-type elements" diverge. Advisory input to the visual self-review.
 *
 * Does NOT catch anything needing real layout (rendered overlap, optical
 * alignment) — those stay with the LLM self-review (C.4.5). This linter is the
 * deterministic floor under it.
 *
 * Pure, stdlib-only. Also runnable as a CLI:
 *   node lib/design/lint.mjs <file.html> [<file2.html> …]   (exit 1 on ERROR)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isOnSpacingScale, nearestSpacing, isCanonicalFrame, FRAMES } from './tokens.mjs';

const SPACING_PROP =
  /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;

const SIZING_PROP = /^(width|height|min-width|min-height|max-width|max-height|padding|margin|font-size|gap)/;

/** Pull the px magnitudes that appear as standalone tokens in a CSS value. */
function pxValues(value) {
  if (/\bvar\(|\bcalc\(/.test(value)) return []; // token / computed — not a literal
  return (value.match(/-?\d+(?:\.\d+)?px/g) || []).map((t) => parseFloat(t));
}

/** Split a declaration block (`a:1; b:2`) into `{prop,value}` pairs. */
function declsFromBlock(block) {
  return block
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      if (i < 0) return null;
      return { prop: s.slice(0, i).trim().toLowerCase(), value: s.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

/**
 * Brace-aware scan: return the text of every innermost declaration block in a
 * stylesheet, ignoring selectors and @-rule prelude. Handles one level of
 * nesting (e.g. @media) — enough for generated design CSS.
 */
function cssDeclBlocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let depth = 0;
  let buf = '';
  for (const ch of clean) {
    if (ch === '{') { depth += 1; buf = ''; continue; }
    if (ch === '}') { if (depth >= 1) blocks.push(buf); depth -= 1; buf = ''; continue; }
    if (depth >= 1) buf += ch;
  }
  return blocks;
}

/** Every declaration in every <style> block. */
function styleBlockDecls(html) {
  const out = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const block of cssDeclBlocks(m[1])) {
      for (const d of declsFromBlock(block)) out.push({ ...d, where: 'style' });
    }
  }
  return out;
}

/** Every declaration in every inline style="" / style='' attribute. */
function inlineStyleDecls(html) {
  const out = [];
  for (const m of html.matchAll(/style\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    for (const d of declsFromBlock(m[2])) out.push({ ...d, where: 'inline' });
  }
  return out;
}

/** Classed elements that also carry inline sizing (the drift signal). */
function inlineSizingDrift(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const cls = /\bclass\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    const style = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    if (!cls || !style) continue;
    const sized = declsFromBlock(style[2]).filter((d) => SIZING_PROP.test(d.prop));
    if (sized.length) {
      out.push({
        rule: 'inline-sizing-drift',
        level: 'warn',
        tag: m[1],
        class: cls[2].trim(),
        props: sized.map((d) => d.prop).join(', '),
        message: `<${m[1]} class="${cls[2].trim()}"> carries inline sizing (${sized
          .map((d) => d.prop)
          .join(', ')}) — move it to the shared class so siblings can't drift`,
      });
    }
  }
  return out;
}

/**
 * Lint a design HTML string for spacing + drift. Frame is checked separately
 * (`lintCanvasData`) because it lives in the embedded canvas data, not the CSS.
 * @param {string} html
 * @returns {{ ok: boolean, errors: object[], warnings: object[], summary: string }}
 */
export function lintDesign(html) {
  const errors = [];
  const warnings = [];

  for (const d of [...styleBlockDecls(html), ...inlineStyleDecls(html)]) {
    if (!SPACING_PROP.test(d.prop)) continue;
    for (const px of pxValues(d.value)) {
      if (!isOnSpacingScale(px)) {
        errors.push({
          rule: 'spacing-off-grid',
          level: 'error',
          prop: d.prop,
          value: `${px}px`,
          suggestion: `${nearestSpacing(px)}px`,
          where: d.where,
          message: `${d.prop}: ${px}px is off the 4-point grid (${d.where}) → use ${nearestSpacing(px)}px`,
        });
      }
    }
  }

  warnings.push(...inlineSizingDrift(html));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: `${errors.length} error(s), ${warnings.length} warning(s)`,
  };
}

/**
 * Lint a canvas data object: every artboard must be a canonical frame.
 * @param {{ sections?: Array<{ artboards?: Array<{ id?:string, label?:string, width?:number, height?:number }> }> }} data
 * @returns {{ ok: boolean, errors: object[] }}
 */
export function lintCanvasData(data) {
  const errors = [];
  for (const section of data?.sections || []) {
    for (const a of section.artboards || []) {
      if (!isCanonicalFrame({ w: a.width, h: a.height })) {
        errors.push({
          rule: 'frame-not-canonical',
          level: 'error',
          artboard: a.id || a.label || '(unnamed)',
          value: `${a.width}×${a.height}`,
          suggestion: `${FRAMES.desktop.w}×${FRAMES.desktop.h}`,
          message: `artboard "${a.id || a.label || '?'}" is ${a.width}×${a.height} — use the canonical ${FRAMES.desktop.w}×${FRAMES.desktop.h} desktop frame`,
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Best-effort: extract `var DATA = {…}` / `__CANVAS_DATA = {…}` from canvas.html. */
function extractCanvasData(html) {
  const m = /(?:var\s+DATA\s*=|__CANVAS_DATA\s*=)\s*(\{[\s\S]*?\})\s*;/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node lib/design/lint.mjs <file.html> [<file2.html> …]');
    process.exit(2);
  }
  let totalErrors = 0;
  for (const file of files) {
    let html;
    try { html = readFileSync(file, 'utf-8'); } catch (e) {
      console.error(`✗ cannot read ${file}: ${e.message}`);
      totalErrors += 1;
      continue;
    }
    const res = lintDesign(html);
    const data = extractCanvasData(html);
    const frame = data ? lintCanvasData(data) : { ok: true, errors: [] };
    const allErrors = [...res.errors, ...frame.errors];
    totalErrors += allErrors.length;

    console.log(`\n${file} — ${allErrors.length} error(s), ${res.warnings.length} warning(s)`);
    for (const e of allErrors) console.log(`  ✗ [${e.rule}] ${e.message}`);
    for (const w of res.warnings) console.log(`  ⚠ [${w.rule}] ${w.message}`);
    if (!allErrors.length && !res.warnings.length) console.log('  ✓ clean');
  }
  process.exit(totalErrors ? 1 : 0);
}
