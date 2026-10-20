import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadDashboardFonts } from '../../src/design-system/fonts.ts';
import { fontPins } from '../helpers/brand-contract.mjs';
import { fontTable, variationAxes } from '../helpers/font-tables.mjs';

const require = createRequire(new URL('../../package.json', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(
  readFileSync(new URL('../../../../package-lock.json', import.meta.url), 'utf8'),
);
const tokens = readFileSync(new URL('../../src/design-system/tokens.css', import.meta.url), 'utf8');
const packageRoot = (name) => dirname(require.resolve(`${name}/package.json`));

for (const [name, version] of Object.entries(fontPins)) {
  test(`${name} has an exact manifest and registry integrity pin`, () => {
    assert.equal(manifest.dependencies[name], version);
    assert.equal(lock.packages['apps/dashboard'].dependencies[name], version);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.version, version);
    assert.equal(
      entry.resolved,
      `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${version}.tgz`,
    );
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u);
    assert.equal(entry.license, 'OFL-1.1');
  });

  test(`${name} is installed at its pin with its original open font license`, () => {
    const root = packageRoot(name);
    const installed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(installed.version, version);
    assert.equal(installed.license, 'OFL-1.1');
    assert.match(
      readFileSync(join(root, 'LICENSE'), 'utf8'),
      /SIL OPEN FONT LICENSE Version 1\.1/iu,
    );
  });
}

test('imports only the required local normal faces and retains optical sizing', () => {
  const imports = [...tokens.matchAll(/@import "(@fontsource[^";]+)";/gu)].map((match) => match[1]);
  assert.deepEqual(imports, [
    ...[400, 500, 600, 700, 800].map((weight) => `@fontsource/outfit/${weight}.css`),
    '@fontsource-variable/dm-sans/standard.css',
    ...[400, 500, 600].map((weight) => `@fontsource/source-code-pro/${weight}.css`),
  ]);
  assert.doesNotMatch(tokens, /https?:|geist|googleapis|gstatic/iu);
  const families = readFileSync(
    new URL('../../src/design-system/typography.css', import.meta.url),
    'utf8',
  );
  assert.match(families, /"Outfit"/u);
  assert.match(families, /"DM Sans Variable"/u);
  assert.match(families, /"Source Code Pro"/u);
  assert.match(families, /font-optical-sizing: auto/u);
});

for (const [name, family, weights] of [
  ['@fontsource/outfit', 'outfit', [400, 500, 600, 700, 800]],
  ['@fontsource/source-code-pro', 'source-code-pro', [400, 500, 600]],
]) {
  test(`${family} ships every required normal weight as a local WOFF2`, () => {
    for (const weight of weights) {
      const root = packageRoot(name);
      const css = readFileSync(join(root, `${weight}.css`), 'utf8');
      assert.match(css, new RegExp(`font-weight: ${weight};`, 'u'));
      assert.doesNotMatch(css, /https?:|font-style: italic/iu);
      const font = readFileSync(join(root, `files/${family}-latin-${weight}-normal.woff2`));
      assert.equal(fontTable(font, 'OS/2').readUInt16BE(4), weight);
    }
  });
}

test('DM Sans imports the full standard face with both weight and optical size axes', () => {
  const root = packageRoot('@fontsource-variable/dm-sans');
  const css = readFileSync(join(root, 'standard.css'), 'utf8');
  assert.match(css, /font-family: ['"]DM Sans Variable['"]/u);
  assert.match(css, /font-weight: 100 1000;/u);
  assert.doesNotMatch(css, /https?:|font-style: italic/iu);
  const files = [...css.matchAll(/url\((?:['"])?\.\/(files\/[^)'"\s]+\.woff2)(?:['"])?\)/gu)].map(
    (match) => match[1],
  );
  assert(files.length > 0, 'Standard CSS must declare local WOFF2 assets');
  for (const file of files) {
    const axes = variationAxes(readFileSync(join(root, file)));
    const opsz = axes.find((axis) => axis.tag === 'opsz');
    const wght = axes.find((axis) => axis.tag === 'wght');
    assert.equal(opsz?.min, 9);
    assert.equal(opsz?.max, 40);
    assert.equal(wght?.min, 100);
    assert.equal(wght?.max, 1000);
  }
});

test('font readiness waits for every face and surfaces missing or failed local assets', async () => {
  const requests = [];
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let ready = false;
  const loading = loadDashboardFonts({
    load: (font) => {
      requests.push(font);
      return pending;
    },
  }).then(() => {
    ready = true;
  });
  assert.equal(requests.length, 11);
  await Promise.resolve();
  assert.equal(ready, false);
  release([{}]);
  await loading;
  assert.equal(ready, true);
  await assert.rejects(
    loadDashboardFonts({ load: async () => [] }),
    /Dashboard font is unavailable/u,
  );
  await assert.rejects(
    loadDashboardFonts({
      load: async () => {
        throw new Error('Local asset failed');
      },
    }),
    /Local asset failed/u,
  );
});
