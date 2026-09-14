import { contrastRatio } from '../internal/contrast.mjs';
import { DIAGRAM_ERROR_CODES, diagramFail } from './errors.mjs';

const attribute = (bytes, name) => bytes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu'))?.[1] ?? null;

export function validateDiagramSvg(svg, {
  foreground = '#111111',
  background = '#ffffff',
  clipped = false,
} = {}) {
  const bytes = String(svg);
  const errors = [];
  const svgOpen = bytes.match(/<svg\b[^>]*>/iu)?.[0] ?? '';
  if (!svgOpen) errors.push('missing-svg-root');
  if (attribute(svgOpen, 'role') !== 'img') errors.push('missing-role-img');
  if (!attribute(svgOpen, 'viewBox')) errors.push('missing-viewbox');
  const labelledBy = attribute(svgOpen, 'aria-labelledby')?.trim().split(/\s+/u) ?? [];
  const title = bytes.match(/^\s*<svg\b[^>]*>\s*<title\s+id=["']([^"']+)["'][^>]*>([^<]+)<\/title>/iu);
  const description = bytes.match(/<desc\s+id=["']([^"']+)["'][^>]*>([^<]+)<\/desc>/iu);
  if (!title) errors.push('missing-first-child-title');
  if (!description) errors.push('missing-description');
  if (title && description && title[1] === description[1]) errors.push('duplicate-accessibility-id');
  if (title && !labelledBy.includes(title[1])) errors.push('title-not-labelledby');
  if (description && !labelledBy.includes(description[1])) errors.push('description-not-labelledby');
  if (/<(?:script|foreignObject)\b|\son[a-z]+\s*=|(?:href|src)=["'](?:https?:|\/\/|data:)/iu.test(bytes)) errors.push('external-or-executable-resource');
  const fontSizes = [...bytes.matchAll(/font-size\s*[:=]\s*["']?(\d+(?:\.\d+)?)/giu)].map((match) => Number(match[1]));
  if (fontSizes.some((size) => size < 12)) errors.push('text-below-12px');
  const ratio = contrastRatio(foreground, background);
  if (ratio !== null && ratio < 4.5) errors.push('contrast-below-aa');
  if (clipped) errors.push('clipped-content');
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    contrastRatio: ratio,
  });
}

export function assertDiagramSvg(svg, options) {
  const result = validateDiagramSvg(svg, options);
  if (!result.ok) {
    diagramFail(DIAGRAM_ERROR_CODES.ACCESSIBILITY_INVALID, 'SVG accessibility contract failed.', result);
  }
  return result;
}
