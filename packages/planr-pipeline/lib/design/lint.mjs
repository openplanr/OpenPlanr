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
import { contrastRatio, AA_NORMAL } from './contrast.mjs';

const SPACING_PROP =
  /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;

const SIZING_PROP = /^(width|height|min-width|min-height|max-width|max-height|padding|margin|font-size|gap)/;

// v0.18.0 token-adherence (Atlas `_adherence.oxlintrc.json` model).
const COLOR_PROP = /^(color|background|background-color|border(-(top|right|bottom|left))?-color|outline-color|fill|stroke|caret-color|text-decoration-color)$/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi;
const SYSTEM_FONTS = new Set([
  'inherit', 'initial', 'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-monospace',
  'ui-serif', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica',
  'arial', 'sfmono-regular', 'sf mono', 'menlo', 'consolas', 'liberation mono', 'cursive',
]);

/** All raw color literals used as a value (hex/rgb/oklch); [] for a var()/gradient. */
function literalColors(value) {
  return /gradient/i.test(value) ? [] : (value.match(COLOR_LITERAL) || []);
}
/** The first resolvable literal color in a value, or null (var/gradient/none). */
function firstColor(value) {
  if (/var\(|gradient/i.test(value)) return null;
  const m = value.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|\b(?:white|black)\b/i);
  return m ? m[0] : null;
}
/** First font family in a font-family/font value, lowercased + unquoted. */
function firstFontFamily(value) {
  const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
  return first ? first.toLowerCase() : null;
}
/** Decls grouped per block (so color + background can be paired for a contrast check). */
function declBlocks(html) {
  const blocks = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    for (const b of cssDeclBlocks(m[1])) blocks.push(declsFromBlock(b));
  for (const m of html.matchAll(/style\s*=\s*(["'])([\s\S]*?)\1/gi)) blocks.push(declsFromBlock(m[2]));
  return blocks;
}

/** Pull the px magnitudes that appear as standalone tokens in a CSS value. */
function pxValues(value) {
  if (/\bvar\(|\bcalc\(/.test(value)) return []; // token / computed — not a literal
  // px-equivalent literals. rem/em are normalized to px at the 16px root the
  // spacing tokens assume — Tailwind/most stacks compile spacing to rem, so an
  // off-grid rem (0.8125rem = 13px) would otherwise slip past the grid check.
  const out = [];
  for (const m of value.matchAll(/-?\d+(?:\.\d+)?(px|rem|em)\b/g)) {
    const n = parseFloat(m[0]);
    out.push(/r?em/.test(m[1]) ? Math.round(n * 16 * 1000) / 1000 : n);
  }
  return out;
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
 * Lint a design HTML string. ERRORS (hard gate): off-grid spacing,
 * sub-AA text/background contrast. WARNINGS (advisory, fed to the visual
 * self-review): raw-color usage, non-design-system fonts, inline-sizing drift.
 * Frame is checked separately (`lintCanvasData`).
 * @param {string} html
 * @param {{ designSystem?: { fonts?: Array<{family:string}> } }} [opts]
 * @returns {{ ok: boolean, errors: object[], warnings: object[], summary: string }}
 */
export function lintDesign(html, opts = {}) {
  const { designSystem = null } = opts;
  const errors = [];
  const warnings = [];

  const decls = [...styleBlockDecls(html), ...inlineStyleDecls(html)];
  for (const d of decls) {
    // spacing off the 4-point grid (ERROR)
    if (SPACING_PROP.test(d.prop)) {
      for (const px of pxValues(d.value)) {
        if (!isOnSpacingScale(px)) {
          errors.push({
            rule: 'spacing-off-grid', level: 'error', prop: d.prop, value: `${px}px`,
            suggestion: `${nearestSpacing(px)}px`, where: d.where,
            message: `${d.prop}: ${px}px is off the 4-point grid (${d.where}) → use ${nearestSpacing(px)}px`,
          });
        }
      }
    }
    // raw color used as a value, not a `--token` definition (WARN — use var(--…))
    if (COLOR_PROP.test(d.prop)) {
      for (const lit of literalColors(d.value)) {
        warnings.push({
          rule: 'color-not-token', level: 'warn', prop: d.prop, value: lit, where: d.where,
          message: `${d.prop}: ${lit} is a raw color — use a design-system token via var(--…)`,
        });
      }
    }
    // font not in the design system + not a system fallback (WARN, only when a DS is known)
    if ((d.prop === 'font-family' || d.prop === 'font') && designSystem?.fonts?.length) {
      const fam = firstFontFamily(d.value);
      const allowed = new Set(designSystem.fonts.map((f) => String(f.family || '').toLowerCase()));
      if (fam && !allowed.has(fam) && !SYSTEM_FONTS.has(fam)) {
        warnings.push({
          rule: 'font-not-token', level: 'warn', value: fam, where: d.where,
          message: `font "${fam}" is not in the design system (${[...allowed].join(', ') || 'none'})`,
        });
      }
    }
  }

  // sub-AA contrast (ERROR): a block where color + background both resolve to literals
  for (const block of declBlocks(html)) {
    const c = block.find((d) => d.prop === 'color');
    const bg = block.find((d) => d.prop === 'background' || d.prop === 'background-color');
    if (!c || !bg) continue;
    const fg = firstColor(c.value);
    const back = firstColor(bg.value);
    if (!fg || !back) continue;
    const ratio = contrastRatio(fg, back);
    if (ratio != null && ratio < AA_NORMAL) {
      errors.push({
        rule: 'contrast-below-aa', level: 'error', value: `${ratio.toFixed(1)}:1`, fg, bg: back,
        message: `text/background contrast ${ratio.toFixed(1)}:1 is below AA 4.5:1 (${fg} on ${back})`,
      });
    }
  }

  warnings.push(...inlineSizingDrift(html));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    declarations: decls.length,
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
  // `--expect-styles`: a file that parses to ZERO declarations is a FAILURE, not
  // a silent "✓ clean". Without this guard, pointing the linter at a raw .css
  // (no <style> wrapper) or an empty/style-less HTML reports clean having checked
  // nothing — a fabricated pass. Used by the qa-agent's design-fidelity gate,
  // which always expects real CSS to be present in what it lints.
  const expectStyles = process.argv.includes('--expect-styles');
  const files = process.argv.slice(2).filter((a) => a !== '--expect-styles');
  if (!files.length) {
    console.error('usage: node lib/design/lint.mjs [--expect-styles] <file.html> [<file2.html> …]');
    process.exit(2);
  }
  let totalErrors = 0;
  let emptyParsed = false;
  for (const file of files) {
    let html;
    try { html = readFileSync(file, 'utf-8'); } catch (e) {
      console.error(`✗ cannot read ${file}: ${e.message}`);
      totalErrors += 1;
      continue;
    }
    // A bare stylesheet has no <style> wrapper, so lintDesign would parse nothing.
    // Auto-wrap .css/.scss (and any file with no <style> but obvious CSS rules) so
    // the qa fidelity gate can point straight at COMPILED CSS in the build output.
    if (/\.s?css$/i.test(file) || (!/<style[\s>]/i.test(html) && /\{[^}]*:[^}]*\}/.test(html))) {
      html = `<style>${html}</style>`;
    }
    const res = lintDesign(html);
    const data = extractCanvasData(html);
    const frame = data ? lintCanvasData(data) : { ok: true, errors: [] };
    const allErrors = [...res.errors, ...frame.errors];
    totalErrors += allErrors.length;

    console.log(`\n${file} — ${res.declarations} declaration(s), ${allErrors.length} error(s), ${res.warnings.length} warning(s)`);
    for (const e of allErrors) console.log(`  ✗ [${e.rule}] ${e.message}`);
    for (const w of res.warnings) console.log(`  ⚠ [${w.rule}] ${w.message}`);
    if (res.declarations === 0) {
      emptyParsed = true;
      console.log(`  ⚠ [no-styles-parsed] 0 CSS declarations found — point at COMPILED CSS, or wrap raw CSS as <style>…</style>${expectStyles ? ' (fails --expect-styles)' : ''}`);
    } else if (!allErrors.length && !res.warnings.length) {
      console.log('  ✓ clean');
    }
  }
  // Exit: 1 = real lint errors; 3 = --expect-styles but a file parsed nothing
  // (distinct so "checked nothing" can't read as a pass); 0 = clean.
  process.exit(totalErrors ? 1 : (expectStyles && emptyParsed ? 3 : 0));
}
