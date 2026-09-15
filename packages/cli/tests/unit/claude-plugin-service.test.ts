import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBundledClaudePluginIntegration,
  applyClaudePluginIntegration,
  type ClaudeCommandRunner,
  inspectBundledClaudePluginIntegration,
  inspectClaudePluginIntegration,
  OPENPLANR_SKILLS_VERSION,
} from '../../src/services/claude-plugin-service.js';

const pipelineVersion = '0.32.1';
/**
 * One patch above whatever the CLI currently targets, so the "a newer advertised version
 * wins" fixture stays newer by construction instead of by coincidence.
 */
const advertisedSkillsVersion = (() => {
  const [major, minor, patch] = OPENPLANR_SKILLS_VERSION.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
})();
const roots: string[] = [];

function pluginPath(name: string, version: string, manifest = true): string {
  const root = mkdtempSync(join(tmpdir(), `openplanr-claude-${name}-`));
  roots.push(root);
  if (manifest) {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(root, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name, version })}\n`,
    );
  }
  return root;
}

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

  it('accepts the configured local unified plugin as its complete release topology', () => {
    const marketplaceRoot = mkdtempSync(join(tmpdir(), 'openplanr-claude-unified-'));
    roots.push(marketplaceRoot);
    mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
      `${JSON.stringify({
        name: 'openplanr',
        plugins: [{ name: 'openplanr', version: '0.1.0' }],
      })}\n`,
    );
    const runner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace') {
        return result(
          JSON.stringify([
            {
              name: 'openplanr',
              source: 'directory',
              path: marketplaceRoot,
              installLocation: marketplaceRoot,
            },
          ]),
        );
      }
      return result(
        JSON.stringify([
          {
            id: 'openplanr@openplanr',
            version: '0.1.0',
            scope: 'user',
            enabled: true,
            installPath: pluginPath('openplanr', '0.1.0'),
          },
        ]),
      );
    };

    const inspection = inspectClaudePluginIntegration(pipelineVersion, runner);

    expect(inspection.ready).toBe(true);
    expect(inspection.plugins).toHaveLength(1);
    expect(inspection.plugins[0]).toMatchObject({
      id: 'openplanr@openplanr',
      expectedVersion: '0.1.0',
      identityValid: true,
    });
    expect(inspection.operations.map((operation) => operation.kind)).toEqual([
      'refresh-marketplace',
    ]);
  });

  it('uses newer compatible versions advertised by the official marketplace', () => {
    const marketplaceRoot = mkdtempSync(join(tmpdir(), 'openplanr-claude-marketplace-'));
    roots.push(marketplaceRoot);
    mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
      `${JSON.stringify({
        plugins: [
          // Derived, never a literal: this fixture only means anything while it is
          // *newer* than what the CLI targets, and a hardcoded version silently stops
          // being newer the next time the constant moves — which is exactly what a
          // stale literal did here before.
          { name: 'openplanr', version: advertisedSkillsVersion },
          { name: 'planr-pipeline', version: '0.32.2' },
        ],
      })}\n`,
    );
    const runner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace') {
        return result(
          JSON.stringify([
            {
              name: 'openplanr',
              repo: 'openplanr/marketplace',
              installLocation: marketplaceRoot,
            },
          ]),
        );
      }
      return result(
        JSON.stringify([
          {
            id: 'openplanr@openplanr',
            version: OPENPLANR_SKILLS_VERSION,
            scope: 'user',
            enabled: true,
            installPath: pluginPath('openplanr', OPENPLANR_SKILLS_VERSION),
          },
          {
            id: 'planr-pipeline@openplanr',
            version: pipelineVersion,
            scope: 'user',
            enabled: true,
            installPath: pluginPath('planr-pipeline', pipelineVersion),
          },
        ]),
      );
    };

    const inspection = inspectClaudePluginIntegration(pipelineVersion, runner);

    expect(inspection.plugins.map((plugin) => plugin.expectedVersion)).toEqual([
      advertisedSkillsVersion,
      '0.32.2',
    ]);
    expect(inspection.operations.map((operation) => operation.kind)).toEqual([
      'refresh-marketplace',
      'update',
      'update',
    ]);
  });

  it('does not cross incompatible semantic-version boundaries automatically', () => {
    const marketplaceRoot = mkdtempSync(join(tmpdir(), 'openplanr-claude-marketplace-'));
    roots.push(marketplaceRoot);
    mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
      `${JSON.stringify({
        plugins: [
          { name: 'openplanr', version: '2.0.0' },
          { name: 'planr-pipeline', version: '0.33.0' },
        ],
      })}\n`,
    );
    const runner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace') {
        return result(
          JSON.stringify([
            {
              name: 'openplanr',
              repo: 'openplanr/marketplace',
              installLocation: marketplaceRoot,
            },
          ]),
        );
      }
      return result(
        JSON.stringify([
          {
            id: 'openplanr@openplanr',
            version: OPENPLANR_SKILLS_VERSION,
            scope: 'user',
            enabled: true,
            installPath: pluginPath('openplanr', OPENPLANR_SKILLS_VERSION),
          },
          {
            id: 'planr-pipeline@openplanr',
            version: pipelineVersion,
            scope: 'user',
            enabled: true,
            installPath: pluginPath('planr-pipeline', pipelineVersion),
          },
        ]),
      );
    };

    const inspection = inspectClaudePluginIntegration(pipelineVersion, runner);

    expect(inspection.plugins.map((plugin) => plugin.expectedVersion)).toEqual([
      OPENPLANR_SKILLS_VERSION,
      pipelineVersion,
    ]);
    expect(inspection.ready).toBe(true);
  });

  it('detects version, identity, and legacy-installation drift without mutating state', () => {
    const calls: string[][] = [];
    const runner: ClaudeCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace') {
        return result(
          JSON.stringify([
            { name: 'openplanr', repo: 'openplanr/marketplace' },
            { name: 'openplanr-skills', repo: 'openplanr/skills' },
          ]),
        );
      }
      return result(
        JSON.stringify([
          {
            id: 'openplanr@openplanr',
            version: '1.18.1',
            scope: 'user',
            enabled: true,
            installPath: pluginPath('openplanr-skills', '1.18.1'),
          },
          {
            id: 'planr-pipeline@openplanr',
            version: pipelineVersion,
            scope: 'user',
            enabled: true,
            installPath: pluginPath('planr-pipeline', pipelineVersion),
          },
          {
            id: 'openplanr@openplanr-skills',
            version: '1.18.1',
            scope: 'user',
            enabled: true,
          },
        ]),
      );
    };

    const inspection = inspectClaudePluginIntegration(pipelineVersion, runner);

    expect(inspection.ready).toBe(false);
    expect(inspection.legacyPluginIds).toEqual(['openplanr@openplanr-skills']);
    expect(inspection.plugins[0]).toMatchObject({
      installedVersion: '1.18.1',
      expectedVersion: OPENPLANR_SKILLS_VERSION,
      identityValid: false,
    });
    expect(inspection.operations.map((operation) => operation.kind)).toEqual([
      'refresh-marketplace',
      'update',
    ]);
    expect(calls).toHaveLength(3);
  });

  it('adds the marketplace, installs compatible plugins, and verifies their manifests', () => {
    let marketplaceConfigured = false;
    const installed = new Map<
      string,
      { version: string; scope: string; enabled: boolean; installPath: string }
    >();
    const calls: string[][] = [];
    const runner: ClaudeCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return result(
          JSON.stringify(
            marketplaceConfigured ? [{ name: 'openplanr', repo: 'openplanr/marketplace' }] : [],
          ),
        );
      }
      if (args[1] === 'marketplace' && args[2] === 'add') {
        marketplaceConfigured = true;
        return result();
      }
      if (args[1] === 'list') {
        return result(
          JSON.stringify(
            [...installed.entries()].map(([id, plugin]) => ({
              id,
              ...plugin,
            })),
          ),
        );
      }
      if (args[1] === 'install') {
        const id = args[2];
        const name = id.split('@')[0];
        const version = name === 'openplanr' ? OPENPLANR_SKILLS_VERSION : pipelineVersion;
        installed.set(id, {
          version,
          scope: 'user',
          enabled: true,
          installPath: pluginPath(name, version),
        });
        return result();
      }
      return result('', 1, `Unexpected command: ${args.join(' ')}`);
    };

    const preview = inspectClaudePluginIntegration(pipelineVersion, runner);
    expect(preview.operations.map((operation) => operation.kind)).toEqual([
      'add-marketplace',
      'install',
      'install',
    ]);

    const applied = applyClaudePluginIntegration(pipelineVersion, preview, runner);

    expect(applied.inspection.ready).toBe(true);
    expect(applied.restartRequired).toBe(true);
    expect(applied.operations).toHaveLength(3);
    expect(calls).toContainEqual([
      'plugin',
      'marketplace',
      'add',
      'openplanr/marketplace',
      '--scope',
      'user',
    ]);
  });

  it('surfaces command failures instead of claiming an update succeeded', () => {
    const runner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return result('2.1.0\n');
      if (args[1] === 'marketplace' && args[2] === 'list') return result('[]');
      if (args[1] === 'list') return result('[]');
      return result('', 1, 'network unavailable');
    };
    const preview = inspectClaudePluginIntegration(pipelineVersion, runner);

    expect(() => applyClaudePluginIntegration(pipelineVersion, preview, runner)).toThrow(
      /network unavailable/,
    );
  });
});
