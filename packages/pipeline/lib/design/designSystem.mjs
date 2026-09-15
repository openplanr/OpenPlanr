/**
 * Resolve the project's design SYSTEM (v0.18.0) — the project-wide package the
 * `/design` generator + the PO designer-agent ground every design in, so each
 * design is a *continuation* of one feel, never standalone.
 *
 * A planr design system is a package (Atlas model): `manifest.json` (machine
 * tokens), `tokens.css` (portable custom properties), `brand.md` (voice /
 * identity), `components.md` (per-surface recipes). `resolveDesignSystem()`
 * finds it, or falls back to legacy signals (a root `DESIGN.md`, a CSS/Tailwind
 * theme, the stack's ComponentLibrary). When nothing resolves, the `/design`
 * preflight gate ASKS the user (generate / point-to-existing / describe) rather
 * than silently producing a generic look.
 *
 * Pure status core (no fs) + a thin fs resolver. stdlib-only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DS_PACKAGE_FILES = ['manifest.json', 'tokens.css', 'brand.md', 'components.md'];

const THEME_FILES = [
  'globals.css', 'app/globals.css', 'src/globals.css', 'src/index.css', 'app/index.css',
  'tailwind.config.js', 'tailwind.config.ts', 'theme.css', 'src/styles/theme.css',
];

/**
 * Priority-ordered source of a design system from boolean signals (pure — the
 * tested decision core the fs resolver and the preflight gate both rely on).
 * @returns {{ found: boolean, source: 'package'|'design-md'|'theme'|'stack'|'none' }}
 */
export function designSystemStatus({ hasPackage = false, hasDesignMd = false, hasTheme = false, hasStackTokens = false } = {}) {
  if (hasPackage) return { found: true, source: 'package' };
  if (hasDesignMd) return { found: true, source: 'design-md' };
  if (hasTheme) return { found: true, source: 'theme' };
  if (hasStackTokens) return { found: true, source: 'stack' };
  return { found: false, source: 'none' };
}

/**
 * Resolve the design system for a project.
 * @param {{ dir?: string, projectRoot?: string }} opts — `dir` = the package dir
 *   (`.planr/design-system` spec-driven, `input/design-system` default).
 * @returns {{ found, source, dir, tokens, themes, fonts, brand, components, tokensCss }}
 */
export function resolveDesignSystem({ dir, projectRoot = '.' } = {}) {
  const pkgManifest = dir ? join(dir, 'manifest.json') : null;
  const hasPackage = Boolean(pkgManifest && existsSync(pkgManifest));
  const hasDesignMd = existsSync(join(projectRoot, 'DESIGN.md'));
  const hasTheme = THEME_FILES.some((f) => existsSync(join(projectRoot, f)));
  let hasStackTokens = false;
  try {
    const stack = readFileSync(join(projectRoot, 'input/tech/stack.md'), 'utf-8');
    hasStackTokens = /ComponentLibrary|FrontendFramework|design ?system|tailwind|shadcn/i.test(stack);
  } catch { /* no stack file — fine */ }

  const status = designSystemStatus({ hasPackage, hasDesignMd, hasTheme, hasStackTokens });
  const out = { ...status, dir: dir || null, tokens: [], themes: [], fonts: [], brand: false, components: false, tokensCss: null };

  if (hasPackage) {
    try {
      const m = JSON.parse(readFileSync(pkgManifest, 'utf-8'));
      out.tokens = Array.isArray(m.tokens) ? m.tokens : [];
      out.themes = Array.isArray(m.themes) ? m.themes : [];
      out.fonts = Array.isArray(m.fonts) ? m.fonts : [];
    } catch { /* malformed manifest — still report the package exists */ }
    out.brand = existsSync(join(dir, 'brand.md'));
    out.components = existsSync(join(dir, 'components.md'));
    out.tokensCss = existsSync(join(dir, 'tokens.css')) ? join(dir, 'tokens.css') : null;
  }
  return out;
}

/** One-line summary for `--dry-run` / logs. */
export function summarizeDesignSystem(ds) {
  if (!ds || !ds.found) return 'none — preflight will ask to generate / point to one / describe';
  if (ds.source === 'package') {
    const colors = (ds.tokens || []).filter((t) => t.kind === 'color').length;
    return `package · ${ds.tokens.length} tokens (${colors} color) · ${ds.themes.length} theme(s) · ${ds.fonts.length} font(s)`;
  }
  return ds.source; // design-md | theme | stack
}
