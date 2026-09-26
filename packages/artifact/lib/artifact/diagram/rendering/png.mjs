import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';
import { DIAGRAM_THEME, RASTER_SCALE } from './theme.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const require = createRequire(import.meta.url);
const INTER_REGULAR_DIGEST =
  'sha256:a414b48aa577ef2c62ebb135341ddeef33ee26a4f5dc9f787f93c1aab08ebb50';
export const DIAGRAM_FONT = Object.freeze({
  family: 'Inter',
  package: '@expo-google-fonts/inter',
  packageVersion: '0.4.2',
  license: 'OFL-1.1',
  asset: '400Regular/Inter_400Regular.ttf',
  digest: INTER_REGULAR_DIGEST,
});
export const DIAGRAM_RASTERIZER = Object.freeze({
  package: '@resvg/resvg-js',
  packageVersion: '2.6.2',
  license: 'MPL-2.0',
});
export const MAX_DIAGRAM_PNG_BYTES = 32 * 1024 * 1024;

function loadRasterAssets() {
  try {
    const { Resvg } = require('@resvg/resvg-js');
    const fontPath = require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf');
    const font = readFileSync(fontPath);
    const digest = `sha256:${createHash('sha256').update(font).digest('hex')}`;
    if (digest !== INTER_REGULAR_DIGEST) {
      diagramFail(
        DIAGRAM_ERROR_CODES.RENDER_FAILED,
        'The packaged diagram font failed its custody check.',
        {
          actual: digest,
          expected: INTER_REGULAR_DIGEST,
          repair: 'Reinstall planr-pipeline with optional dependencies enabled.',
        },
      );
    }
    return { font, Resvg };
  } catch (error) {
    if (error?.name === 'DiagramError') throw error;
    diagramFail(DIAGRAM_ERROR_CODES.RENDER_FAILED, 'The offline diagram renderer is unavailable.', {
      cause: error instanceof Error ? error.message : String(error),
      repair: 'Reinstall planr-pipeline with optional dependencies enabled.',
    });
  }
}

export function inspectDiagramPng(bytes) {
  const value = Buffer.from(bytes);
  if (
    value.length < 24 ||
    !value.subarray(0, 8).equals(PNG_SIGNATURE) ||
    value.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    diagramFail(DIAGRAM_ERROR_CODES.PNG_INVALID, 'Renderer did not produce a valid PNG header.');
  }
  const width = value.readUInt32BE(16);
  const height = value.readUInt32BE(20);
  if (
    width === 0 ||
    height === 0 ||
    width > 16_384 ||
    height > 16_384 ||
    value.length > MAX_DIAGRAM_PNG_BYTES
  ) {
    diagramFail(DIAGRAM_ERROR_CODES.PNG_INVALID, 'Rendered PNG exceeds the image bounds.', {
      width,
      height,
      bytes: value.length,
      maximumBytes: MAX_DIAGRAM_PNG_BYTES,
    });
  }
  return Object.freeze({ width, height, byteLength: value.length });
}

export function renderDiagramPng(svg, { scale = RASTER_SCALE, theme = DIAGRAM_THEME } = {}) {
  try {
    const { font, Resvg } = loadRasterAssets();
    const renderer = new Resvg(svg, {
      background: theme.background,
      fitTo: { mode: 'zoom', value: scale },
      font: {
        defaultFontFamily: DIAGRAM_FONT.family,
        fontBuffers: [font],
        loadSystemFonts: false,
      },
    });
    const bytes = Buffer.from(renderer.render().asPng());
    return Object.freeze({ bytes, ...inspectDiagramPng(bytes) });
  } catch (error) {
    if (error?.name === 'DiagramError') throw error;
    diagramFail(DIAGRAM_ERROR_CODES.RENDER_FAILED, 'The offline SVG rasterizer failed.', {
      renderer: 'resvg-js',
      cause: error instanceof Error ? error.message : String(error),
      repair: 'Validate the SVG and confirm the current platform has a supported resvg binary.',
    });
  }
}
