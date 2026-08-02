#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [join(here, 'doctor.mjs'), '--versions-only', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
