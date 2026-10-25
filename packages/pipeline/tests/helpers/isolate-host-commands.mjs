import '../../../../tests/support/isolate-user-state.mjs';

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const home = process.env.OPENPLANR_TEST_ISOLATED_HOME;
if (!home) throw new Error('Pipeline host isolation requires the isolated test home.');
const bin = join(home, 'host-bin');
const paths = (process.env.PATH ?? '').split(delimiter);
if (!paths.includes(bin)) {
  mkdirSync(bin, { recursive: true });
  for (const name of ['claude', 'codex', 'cursor']) {
    if (process.platform === 'win32') copyFileSync(process.execPath, join(bin, `${name}.exe`));
    else
      writeFileSync(
        join(bin, name),
        '#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then\n  echo "OpenPlanr test host 1.0.0"\n  exit 0\nfi\necho "Unexpected coding-host invocation in Pipeline tests" >&2\nexit 1\n',
        { mode: 0o755 },
      );
  }
  if (process.platform !== 'win32')
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
}
process.env.PATH = [bin, ...paths.filter((entry) => entry !== bin)].join(delimiter);
