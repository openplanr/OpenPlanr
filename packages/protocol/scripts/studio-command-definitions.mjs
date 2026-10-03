/** Additive Protocol 1.17 server lifecycle commands; frozen catalogs are preserved. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256Hex, withDocumentDigest } from '../src/canonical-json.mjs';
export function buildStudioCommandRegistry() {
  const path = 'packages/cli/src/cli/commands/server.ts';
  const source = {
    path,
    digest: `sha256:${sha256Hex(readFileSync(fileURLToPath(new URL('../../cli/src/cli/commands/server.ts', import.meta.url)), 'utf8'))}`,
  };
  const commands = [
    ['cli-server', ['server']],
    ['cli-server-list', ['server', 'list']],
    ['cli-server-stop', ['server', 'stop']],
  ].map(([commandId, argv]) => ({
    commandId,
    argv,
    lifecycle: 'active',
    ownerPackage: 'openplanr',
    surface: argv.length === 1 ? 'cli-root' : 'cli-subcommand',
    authorityClass:
      commandId === 'cli-server-stop'
        ? 'authenticated-local-instance'
        : 'read-only-local-discovery',
    machineJson: true,
    source,
    testRefs: ['packages/cli/tests/unit/server-command.test.ts'],
  }));
  const pastePath = 'packages/cli/src/cli/commands/artifact.ts';
  commands.push({
    commandId: 'cli-artifact-share-resume',
    argv: ['artifact', 'share', '--resume'],
    lifecycle: 'active',
    ownerPackage: 'openplanr',
    surface: 'cli-subcommand',
    authorityClass: 'saved-private-paste-operation',
    machineJson: true,
    source: {
      path: pastePath,
      digest: `sha256:${sha256Hex(readFileSync(fileURLToPath(new URL('../../cli/src/cli/commands/artifact.ts', import.meta.url)), 'utf8'))}`,
    },
    testRefs: ['packages/cli/tests/unit/artifact-paste-custody.test.ts'],
  });
  return withDocumentDigest({
    kind: 'command-catalog-extension',
    schemaVersion: '1.0.0',
    protocolVersion: '1.17.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    baseProtocolVersion: '1.5.0',
    commands,
  });
}
