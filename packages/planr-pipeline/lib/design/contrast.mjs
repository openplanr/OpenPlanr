/**
 * WCAG contrast helper for the design adherence linter (v0.18.0).
 *
 * Parses `#hex` / `rgb()` / `oklch()` to sRGB, computes WCAG 2.x relative
 * luminance + contrast ratio, and answers isReadable() against the AA
 * thresholds (4.5:1 normal text, 3:1 large/UI). Returns `null` for anything it
 * can't fully resolve — `var(--token)`, `currentColor`, gradients — so the
 * linter never false-flags a value it can't actually evaluate.
 *
 * oklch is converted through Björn Ottosson's OKLab → linear-sRGB matrices, so
 * a design system authored in oklch (the modern token format, e.g. Atlas) is
 * checked correctly. Pure, stdlib-only.
 */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => {
  c = clamp01(c);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};

function parseHex(s) {
  let h = s.replace('#', '').trim();
  if (h.length === 3 || h.length === 4) h = h.split('').map((d) => d + d).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b].some(Number.isNaN) ? null : { r, g, b };
}

function parseRgb(s) {
  const m = /rgba?\(([^)]+)\)/i.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const toUnit = (p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
  const [r, g, b] = parts.map(toUnit);
  return [r, g, b].some((x) => !Number.isFinite(x)) ? null : { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

function parseOklch(s) {
  const m = /oklch\(([^)]+)\)/i.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  let [L, C, H] = parts;
  L = L.endsWith('%') ? parseFloat(L) / 100 : parseFloat(L);
  C = parseFloat(C);
  H = parseFloat(H); // degrees
  if (![L, C, H].every(Number.isFinite)) return null;
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b2 = C * Math.sin(h);
  // OKLab → LMS' → linear sRGB (Ottosson)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b2;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b2;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b2;
  const l = l_ ** 3, mm = m_ ** 3, ss = s_ ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss),
  };
}

const NAMED = { white: { r: 1, g: 1, b: 1 }, black: { r: 0, g: 0, b: 0 } };

/** Parse a CSS color string to { r, g, b } in sRGB 0..1, or null if unresolvable. */
export function parseColor(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s.includes('var(') || s.includes('gradient') || ['currentcolor', 'transparent', 'inherit', 'none'].includes(s)) return null;
  if (s in NAMED) return NAMED[s];
  if (s.startsWith('#')) return parseHex(s);
  if (s.startsWith('rgb')) return parseRgb(s);
  if (s.startsWith('oklch')) return parseOklch(s);
  return null;
}

export function relativeLuminance(color) {
  if (!color) return null;
  const { r, g, b } = color;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio (1..21) between two colors (strings or parsed); null if either is unresolvable. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(typeof a === 'string' ? parseColor(a) : a);
  const lb = relativeLuminance(typeof b === 'string' ? parseColor(b) : b);
  if (la == null || lb == null) return null;
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

/** Is `fg` readable on `bg` at WCAG AA? An unresolvable pair returns true (never false-flag). */
export function isReadable(fg, bg, { large = false } = {}) {
  const r = contrastRatio(fg, bg);
  if (r == null) return true;
  return r >= (large ? AA_LARGE : AA_NORMAL);
}
