import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBundledClaudePluginIntegration,
  type ClaudeCommandRunner,
  formatClaudePluginOperationCommand,
  inspectBundledClaudePluginIntegration,
} from '../../src/services/claude-plugin-service.js';

const roots: string[] = [];

function result(stdout = '', status = 0, stderr = '') {
  return { status, stdout, stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Claude plugin integration', () => {
  it('installs the renamed bundled plugin before retiring its old local identity', () => {
    const marketplaceRoot = mkdtempSync(join(tmpdir(), 'openplanr-claude-renamed-'));
    const packageRoot = join(marketplaceRoot, 'openplanr');
    const currentPath = mkdtempSync(join(tmpdir(), 'openplanr-claude-planr-'));
    roots.push(marketplaceRoot, currentPath);
    mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
      `${JSON.stringify({
        name: 'openplanr-local',
        plugins: [{ name: 'planr', version: '0.1.0', source: './openplanr' }],
      })}\n`,
    );
    const contentIdentity = '{"digest":"current"}\n';
    writeFileSync(join(packageRoot, '.openplanr-content.json'), contentIdentity);

    let currentInstalled = false;
    let legacyInstalled = true;
    const calls: string[][] = [];
    const runner: ClaudeCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return result(
          JSON.stringify([
            {
              name: 'openplanr-local',
              installLocation: marketplaceRoot,
            },
          ]),
        );
      }
      if (args[1] === 'marketplace' && args[2] === 'update') return result();
      if (args[1] === 'list') {
        return result(
          JSON.stringify([
            ...(currentInstalled
              ? [
                  {
                    id: 'planr@openplanr-local',
                    version: '0.1.0',
                    scope: 'user',
                    enabled: true,
                    installPath: currentPath,
                  },
                ]
              : []),
            ...(legacyInstalled
              ? [
                  {
                    id: 'openplanr@openplanr-local',
                    version: '0.1.0',
                    scope: 'user',
                    enabled: true,
                    installPath: join(marketplaceRoot, 'legacy'),
                  },
                ]
              : []),
          ]),
        );
      }
      if (args[1] === 'install' && args[2] === 'planr@openplanr-local') {
        currentInstalled = true;
        mkdirSync(join(currentPath, '.claude-plugin'), { recursive: true });
        writeFileSync(
          join(currentPath, '.claude-plugin', 'plugin.json'),
          `${JSON.stringify({ name: 'planr', version: '0.1.0' })}\n`,
        );
        writeFileSync(join(currentPath, '.openplanr-content.json'), contentIdentity);
        return result();
      }
      if (args[1] === 'uninstall' && args[2] === 'openplanr@openplanr-local') {
        legacyInstalled = false;
        return result();
      }
      return result('', 1, `Unexpected command: ${args.join(' ')}`);
    };

    const preview = inspectBundledClaudePluginIntegration(marketplaceRoot, runner);
    expect(preview.operations.map(({ kind }) => kind)).toEqual([
      'refresh-marketplace',
      'install',
      'remove',
    ]);

    const applied = applyBundledClaudePluginIntegration(marketplaceRoot, preview, runner);

    expect(applied.inspection.ready).toBe(true);
    expect(currentInstalled).toBe(true);
    expect(legacyInstalled).toBe(false);
    const installIndex = calls.findIndex(
      (args) => args[1] === 'install' && args[2] === 'planr@openplanr-local',
    );
    const removeIndex = calls.findIndex(
      (args) => args[1] === 'uninstall' && args[2] === 'openplanr@openplanr-local',
    );
    expect(installIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(installIndex);
  });

  it('reports a marketplace-installed planr@openplanr beside planr@openplanr-local without scheduling its removal', () => {
    const marketplaceRoot = mkdtempSync(join(tmpdir(), 'openplanr-claude-duplicate-'));
    const packageRoot = join(marketplaceRoot, 'openplanr');
    const installPath = mkdtempSync(join(tmpdir(), 'openplanr-claude-planr-'));
    roots.push(marketplaceRoot, installPath);
    mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
      `${JSON.stringify({
        name: 'openplanr-local',
        plugins: [{ name: 'planr', version: '2.2639.1', source: './openplanr' }],
      })}\n`,
    );
    const contentIdentity = '{"digest":"current"}\n';
    writeFileSync(join(packageRoot, '.openplanr-content.json'), contentIdentity);
    mkdirSync(join(installPath, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(installPath, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'planr', version: '2.2639.1' })}\n`,
    );
    writeFileSync(join(installPath, '.openplanr-content.json'), contentIdentity);
    const calls: string[][] = [];
    const runner: ClaudeCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return result(
          JSON.stringify([{ name: 'openplanr-local', installLocation: marketplaceRoot }]),
        );
      }
      if (args[1] === 'list') {
        return result(
          JSON.stringify([
            {
              id: 'planr@openplanr-local',
              version: '2.2639.1',
              scope: 'user',
              enabled: true,
              installPath,
            },
            {
              id: 'planr@openplanr',
              version: '2.6.1',
              scope: 'user',
              enabled: true,
              installPath: join(marketplaceRoot, 'remote'),
            },
          ]),
        );
      }
      return result('', 1, `Unexpected command: ${args.join(' ')}`);
    };

    const inspection = inspectBundledClaudePluginIntegration(marketplaceRoot, runner);

    expect(inspection.duplicatePluginIds).toEqual(['planr@openplanr']);
    // A second `planr` is not a legacy id: it is reported, never retired for the user.
    expect(inspection.legacyPluginIds).toEqual([]);
    expect(inspection.ready).toBe(true);
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['refresh-marketplace']);
    expect(calls.some((args) => args[1] === 'uninstall')).toBe(false);
  });

  it('renders add-marketplace from the bundled marketplace root, never a remote source', () => {
    const command = formatClaudePluginOperationCommand(
      {
        runtime: 'claude-code',
        kind: 'add-marketplace',
        id: 'openplanr-local',
        scope: 'user',
        description: 'Add the generated local OpenPlanr Claude marketplace',
      },
      '/opt/openplanr/lib/host-packages/claude',
    );
    expect(command).toBe('claude plugin marketplace add /opt/openplanr/lib/host-packages/claude');
  });
});
