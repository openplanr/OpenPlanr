#!/usr/bin/env node

process.argv.push('--check');
await import('../../packages/protocol/scripts/generate-protocol-assets.mjs');
