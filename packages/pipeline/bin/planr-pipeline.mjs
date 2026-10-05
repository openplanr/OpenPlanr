#!/usr/bin/env node

process.stderr.write(
  'planr-pipeline is now openplanr-pipeline. The planr-pipeline command will be removed in the next release.\n',
);
await import('./openplanr-pipeline.mjs');
