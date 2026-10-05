#!/usr/bin/env node
import { CLI_COMMAND } from '../lib/names.mjs';

process.stderr.write(
  `planr is now ${CLI_COMMAND} (short alias: opr). The planr command will be removed in the next release.\n`,
);
await import('./openplanr.js');
