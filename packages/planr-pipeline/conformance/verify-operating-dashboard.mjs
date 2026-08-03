import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertProtocolArtifact } from '../lib/pipeline/index.mjs';
import { DASHBOARD_VIEWS } from '../lib/dashboard/server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const state = JSON.parse(
  read('conformance/fixtures/operating-dashboard/.planr/operate/projections/state.json'),
);

assertProtocolArtifact('operating-state', state);
if (!DASHBOARD_VIEWS.includes('operate')) {
  throw new Error('Dashboard server does not advertise the Operating view.');
}

const assets = {
  main: read('lib/dashboard/app/main.js'),
  shell: read('lib/dashboard/app/shell.js'),
  view: read('lib/dashboard/app/views/operate.js'),
  css: read('lib/dashboard/app/styles/operate.css'),
  index: read('lib/dashboard/app/index.html'),
};

for (const [name, marker] of [
  ['main', "import('./views/operate.js')"],
  ['shell', "label: 'Operating'"],
  ['view', 'deriveOperatingViewModel'],
  ['view', 'planr operate review'],
  ['css', '.op-thread'],
  ['index', './styles/operate.css'],
]) {
  if (!assets[name].includes(marker)) {
    throw new Error(`Operating dashboard ${name} asset is missing ${marker}.`);
  }
}
if (/method:\s*['"](?:POST|PATCH|PUT|DELETE)/.test(assets.view)) {
  throw new Error('Operating dashboard view introduced a browser mutation request.');
}
if (/#[0-9a-fA-F]{3,8}/.test(assets.css)) {
  throw new Error('Operating dashboard CSS bypassed the canonical dashboard tokens.');
}

process.stdout.write(
  `Operating dashboard conformance passed (event head ${state.eventHead.sequence}, ${state.findings.length} finding, read-only route).\n`,
);
