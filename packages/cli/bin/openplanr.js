#!/usr/bin/env node
import {
  CLI_NODE_REMEDIATION,
  cliNodeVersionMessage,
  supportsCliNodeVersion,
} from '../lib/node-runtime.mjs';

if (!supportsCliNodeVersion(process.versions.node)) {
  console.error(`E_NODE_VERSION: ${cliNodeVersionMessage(process.versions.node)}`);
  console.error(CLI_NODE_REMEDIATION);
  process.exit(1);
}
await import('../dist/cli/index.js');
