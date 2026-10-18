import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designFixture } from './design-fixture.mjs';

export const FIXTURE_FONT_FAMILY = 'Fixture Sans';
export const FIXTURE_FONT_PATH = 'fonts/manrope-latin.woff2';
const fontFile = fileURLToPath(new URL('fixtures/fonts/manrope-latin.woff2', import.meta.url));

/** A one-screen design whose stylesheet loads a snapshotted local woff2. */
export function localFontDesign(root) {
  const fixture = designFixture(root, { count: 1 });
  mkdirSync(join(root, 'source/fonts'), { recursive: true });
  copyFileSync(fontFile, join(root, 'source', FIXTURE_FONT_PATH));
  const stylesheet = join(root, 'source/style.css');
  const css = readFileSync(stylesheet, 'utf8').replace(
    'font:16px/1.5 system-ui',
    `font:16px/1.5 "${FIXTURE_FONT_FAMILY}",system-ui`,
  );
  writeFileSync(
    stylesheet,
    `@font-face{font-family:"${FIXTURE_FONT_FAMILY}";src:url("${FIXTURE_FONT_PATH}") format("woff2");font-weight:200 800}\n${css}`,
  );
  return fixture;
}
