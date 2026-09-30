import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DIAGRAM_FONT } from '../lib/artifact/diagram/rendering/png.mjs';

const require = createRequire(import.meta.url);
const bytes = readFileSync(
  require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
);
if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== DIAGRAM_FONT.digest)
  throw new Error('Packaged diagram font custody failed.');
const output = `// Generated from the pinned OFL-1.1 Inter font; do not edit.\nexport const DIAGRAM_FONT_DATA_URL = 'data:font/ttf;base64,${bytes.toString('base64')}';\nexport const DIAGRAM_FONT_DIGEST = '${DIAGRAM_FONT.digest}';\n`;
const path = new URL('../lib/artifact/ui/generated/diagram-font.mjs', import.meta.url);
const fontPath = new URL('../lib/artifact/ui/generated/diagram-font.ttf', import.meta.url);
const infoPath = new URL('../lib/artifact/ui/generated/diagram-font-info.mjs', import.meta.url);
const info = `// Generated from the pinned OFL-1.1 Inter font; do not edit.\nexport const DIAGRAM_FONT_DIGEST = '${DIAGRAM_FONT.digest}';\n`;
if (process.argv.includes('--check')) {
  if (
    !readFileSync(fontPath).equals(bytes) ||
    readFileSync(infoPath, 'utf8') !== info ||
    readFileSync(path, 'utf8') !== output
  )
    throw new Error('Diagram review font asset is stale.');
} else {
  writeFileSync(path, output);
  writeFileSync(fontPath, bytes);
  writeFileSync(infoPath, info);
}
