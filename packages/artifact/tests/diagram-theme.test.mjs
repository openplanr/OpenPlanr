import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';

import {
  checkDiagram,
  createDiagramDocument,
  DIAGRAM_ERROR_CODES,
  DIAGRAM_THEME,
  DIAGRAM_THEMES,
  OPENPLANR_BRAND_TOKENS,
  OPENPLANR_THEME,
  renderDiagram,
  renderDiagramOutputs,
  resolveDiagramTheme,
} from '../lib/artifact/diagram/index.mjs';
import {
  DIAGRAM_ADAPTIVE_STYLE_PATTERN,
  DIAGRAM_PALETTE_KEYS,
  mixHex,
} from '../lib/artifact/diagram/rendering/theme.mjs';
import { contrastRatio, parseColor } from '../lib/artifact/internal/contrast.mjs';
import { prepareDiagramSvg } from '../lib/artifact/ui/diagram-svg.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const brandFixture = JSON.parse(
  readFileSync(
    join(packageRoot, 'fixtures/diagram/themes/openplanr-brand.planr-diagram.json'),
    'utf8',
  ),
);
const grammarFixture = (grammarId) =>
  JSON.parse(
    readFileSync(
      join(packageRoot, 'fixtures', 'diagram', 'grammars', `${grammarId}.planr-diagram.json`),
      'utf8',
    ),
  );
const brandDocument = (mode, fixture = brandFixture) =>
  createDiagramDocument({ ...fixture, theme: { themeId: 'openplanr', mode } });
const { ink, teal, tealOnLight, paper } = OPENPLANR_BRAND_TOKENS;
const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

/** Opaque colour a fill shows over a background at the given alpha. */
function composite(fill, background, alpha) {
  const over = parseColor(fill);
  const under = parseColor(background);
  const channel = (key) => over[key] * alpha + under[key] * (1 - alpha);
  return { r: channel('r'), g: channel('g'), b: channel('b') };
}

function rasterBackground(svg) {
  const font = readFileSync(
    createRequire(import.meta.url).resolve(
      '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
    ),
  );
  const image = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 1 },
    font: { defaultFontFamily: 'Inter', fontBuffers: [font], loadSystemFonts: false },
  }).render();
  const [r, g, b] = image.pixels;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

test('brand palettes derive every slot from the four brand tokens', () => {
  assert.equal(mixHex('#000000', '#FFFFFF', 0.5), '#808080');
  assert.deepEqual(
    [OPENPLANR_THEME.light, OPENPLANR_THEME.dark].map(({ background, foreground, accent }) => [
      background,
      foreground,
      accent,
    ]),
    [
      [paper, ink, tealOnLight],
      [ink, paper, teal],
    ],
  );
  for (const palette of [OPENPLANR_THEME.light, OPENPLANR_THEME.dark]) {
    const between = (value, from, to) =>
      [1, 3, 5].every((offset) => {
        const channel = (hex) => Number.parseInt(hex.slice(offset, offset + 2), 16);
        const [low, high] = [channel(from), channel(to)].sort((a, b) => a - b);
        return channel(value) >= low && channel(value) <= high;
      });
    assert.ok(between(palette.surface, palette.background, palette.accent), 'surface');
    assert.ok(between(palette.border, palette.background, palette.foreground), 'border');
    assert.ok(between(palette.muted, palette.background, palette.foreground), 'muted');
    assert.ok(between(palette.page.rule, palette.background, palette.foreground), 'rule');
    assert.equal(palette.page.canvas, palette.background);
    for (const key of DIAGRAM_PALETTE_KEYS) assert.match(palette[key], /^#[0-9A-F]{6}$/u, key);
  }
  assert.equal(OPENPLANR_THEME.auto.background, OPENPLANR_THEME.light.background);
  assert.deepEqual(
    DIAGRAM_PALETTE_KEYS.map((key) => OPENPLANR_THEME.auto.dark[key]),
    DIAGRAM_PALETTE_KEYS.map((key) => OPENPLANR_THEME.dark[key]),
  );
  assert.match(OPENPLANR_THEME.light.fontFamily, /^DM Sans, Inter,.*sans-serif$/u);
});

test('every brand text colour meets WCAG AA on the surface it is drawn over', () => {
  for (const [mode, palette] of Object.entries({
    light: OPENPLANR_THEME.light,
    dark: OPENPLANR_THEME.dark,
  })) {
    const ratio = (fg, bg) => contrastRatio(fg, bg);
    // Box, note and label text.
    assert.ok(ratio(palette.foreground, palette.background) >= 7, `${mode} foreground`);
    assert.ok(ratio(palette.foreground, palette.surface) >= 7, `${mode} foreground on surface`);
    // Relation labels sit on a background-coloured knockout.
    assert.ok(ratio(palette.muted, palette.background) >= AA_TEXT, `${mode} muted`);
    // Phase labels and emphasised group titles.
    assert.ok(ratio(palette.accent, palette.background) >= AA_TEXT, `${mode} accent`);
    // Plain group titles reuse the border colour as text.
    assert.ok(ratio(palette.border, palette.background) >= AA_TEXT, `${mode} border as text`);
    // Lane titles sit on the lane fill, surface at 45% over the background.
    const laneFill = composite(palette.surface, palette.background, 0.45);
    assert.ok(ratio(palette.accent, laneFill) >= AA_TEXT, `${mode} accent on lane`);
    assert.ok(ratio(palette.border, laneFill) >= AA_TEXT, `${mode} border on lane`);
    // Strokes are graphics, not text.
    assert.ok(ratio(palette.border, palette.surface) >= AA_GRAPHIC, `${mode} border stroke`);
    assert.ok(ratio(palette.accent, palette.surface) >= AA_GRAPHIC, `${mode} accent stroke`);
  }
});

test('theme resolution keeps the default theme mode-agnostic and rejects unknown ids', () => {
  for (const mode of ['light', 'dark', 'auto']) {
    assert.equal(resolveDiagramTheme({ themeId: 'openplanr-default', mode }), DIAGRAM_THEME);
    assert.equal(resolveDiagramTheme({ themeId: 'openplanr', mode }), OPENPLANR_THEME[mode]);
  }
  assert.deepEqual(
    DIAGRAM_THEMES.map(({ id }) => id),
    ['openplanr-default', 'openplanr'],
  );
  assert.throws(
    () => resolveDiagramTheme({ themeId: 'acme', mode: 'auto' }),
    (error) =>
      error.name === 'DiagramError' &&
      error.code === DIAGRAM_ERROR_CODES.SCHEMA_INVALID &&
      error.details.themes.includes('openplanr'),
  );
  assert.throws(
    () =>
      renderDiagramOutputs(
        createDiagramDocument({ ...brandFixture, theme: { themeId: 'acme', mode: 'auto' } }),
      ),
    (error) => error.code === DIAGRAM_ERROR_CODES.SCHEMA_INVALID,
  );
});

test('the brand theme renders each mode with its own palette and only auto carries the media query', () => {
  const expectations = {
    light: { background: paper, foreground: ink, accent: tealOnLight, scheme: 'light' },
    dark: { background: ink, foreground: paper, accent: teal, scheme: 'dark' },
    auto: { background: paper, foreground: ink, accent: tealOnLight, scheme: 'light dark' },
  };
  for (const [mode, expected] of Object.entries(expectations)) {
    const rendered = renderDiagramOutputs(brandDocument(mode));
    assert.equal(rendered.theme.id, 'openplanr', mode);
    assert.equal(rendered.theme.mode, mode);
    assert.equal(rendered.quality.status, 'pass', mode);
    assert.ok(
      rendered.svg.includes(
        `<rect width="${rendered.scene.width}" height="${rendered.scene.height}" fill="${expected.background}"/>`,
      ),
      `${mode} canvas`,
    );
    assert.ok(rendered.svg.includes(`fill="${expected.foreground}">`), `${mode} text`);
    assert.ok(rendered.svg.includes(`stroke="${expected.accent}"`), `${mode} emphasis`);
    assert.equal(rendered.svg.includes('<style>'), mode === 'auto', `${mode} stylesheet`);
    assert.doesNotMatch(rendered.svg, /font-family="Inter"/u, `${mode} font stack`);
    assert.equal(rasterBackground(rendered.svg), expected.background, `${mode} raster`);
    assert.ok(rendered.html.includes(`color-scheme:${expected.scheme};`), `${mode} page scheme`);
    assert.equal(
      rendered.html.includes('@media (prefers-color-scheme: dark){:root{'),
      mode === 'auto',
    );
    assert.ok(rendered.html.includes('h1{font-family:Outfit,'), `${mode} headline font`);
    assert.ok(rendered.png.width > 0 && rendered.png.height > 0, `${mode} png`);
  }
  const swimlane = renderDiagramOutputs(brandDocument('dark', grammarFixture('swimlane')));
  assert.equal(swimlane.quality.status, 'pass');
  assert.ok(swimlane.svg.includes(`fill="${OPENPLANR_THEME.dark.surface}" fill-opacity="0.45"`));
});

test('auto mode remaps every light value to its dark value and stays passive in the studio', () => {
  const rendered = renderDiagramOutputs(brandDocument('auto'));
  const style = rendered.svg.match(/<style>([^<]*)<\/style>/u)[1];
  assert.match(style, DIAGRAM_ADAPTIVE_STYLE_PATTERN);
  for (const key of DIAGRAM_PALETTE_KEYS) {
    const light = OPENPLANR_THEME.light[key];
    const dark = OPENPLANR_THEME.dark[key];
    assert.ok(style.includes(`[fill="${light}"]{fill:${dark}}`), key);
    assert.ok(style.includes(`[stroke="${light}"]{stroke:${dark}}`), key);
  }
  const usedColours = new Set(
    [...rendered.svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/gu)].map(([, hex]) => hex),
  );
  for (const colour of usedColours)
    assert.ok(style.includes(`="${colour}"]`), `${colour} has a dark remap`);
  const prepared = prepareDiagramSvg(rendered.svg);
  assert.doesNotMatch(prepared.svg, /<style/u);
  assert.ok(prepared.items.some(({ id }) => id === 'manifest'));
  assert.throws(
    () => prepareDiagramSvg(rendered.svg.replace('<style>', '<style>body{display:none}')),
    /unsupported or active/u,
  );
});

test('the default theme output is untouched by the brand theme', () => {
  const rendered = renderDiagramOutputs(
    createDiagramDocument({
      ...brandFixture,
      theme: { themeId: 'openplanr-default', mode: 'auto' },
    }),
  );
  assert.equal(rendered.theme, DIAGRAM_THEME);
  assert.doesNotMatch(rendered.svg, /<style|#F5F7F7|#08080C/u);
  assert.match(rendered.svg, /font-family="Inter"/u);
  assert.ok(rendered.html.includes(':root{color-scheme:light;--bg:#ffffff;'));
  assert.ok(rendered.html.includes('background:linear-gradient(180deg,#f8fafc 0,#fff 320px)'));
  assert.doesNotMatch(rendered.html, /h1\{font-family|prefers-color-scheme/u);
});

test('a rendered brand set records its theme in the manifest and asset receipt and verifies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-diagram-theme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const document = brandDocument('auto');
  const result = await renderDiagram(document, { outputRoot: root });
  assert.equal(result.status, 'created');
  assert.deepEqual(result.manifest.theme, { id: 'openplanr', version: '1.0.0' });
  const directory = join(root, 'diagrams', document.diagramId);
  const receipt = JSON.parse(
    await readFile(join(directory, `${document.diagramId}.assets.json`), 'utf8'),
  );
  assert.equal(receipt.theme.id, 'openplanr');
  assert.equal(receipt.theme.mode, 'auto');
  assert.equal(receipt.theme.dark.background, ink);
  assert.match(receipt.theme.digest, /^sha256:/u);
  const svg = await readFile(join(directory, `${document.diagramId}.svg`), 'utf8');
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/u);
  assert.equal(
    (await checkDiagram({ outputRoot: root, slug: document.diagramId })).validation,
    'passed',
  );
});
