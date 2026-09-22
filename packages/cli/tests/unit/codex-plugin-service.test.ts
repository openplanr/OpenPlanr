import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  applyCodexPluginIntegration,
  type CodexCommandRunner,
  inspectCodexPluginIntegration,
} from '../../src/services/codex-plugin-service.js';

function hostPackageFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-codex-marketplace-'));
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(root, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify({
      name: 'openplanr-pipeline-local',
      plugins: [{ name: 'planr', version: '0.1.0', source: './plugins/openplanr' }],
    })}\n`,
  );
  return root;
}

function runnerState(
  input: {
    configured?: boolean;
    installed?: boolean;
    version?: string;
    duplicate?: boolean;
    managedLegacy?: boolean;
  } = {},
) {
  const calls: string[][] = [];
  let configured = Boolean(input.configured);
  let installed = Boolean(input.installed);
  let managedLegacy = Boolean(input.managedLegacy);
  const runner: CodexCommandRunner = (args) => {
    calls.push(args);
    if (args[0] === '--version') return { status: 0, stdout: 'codex 1.0.0', stderr: '' };
    if (args.join(' ') === 'plugin marketplace list --json')
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify({
          marketplaces: configured ? [{ name: 'openplanr-pipeline-local', root: fixture }] : [],
        }),
      };
    if (args.join(' ') === 'plugin list --json')
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify({
          installed: [
            ...(installed
              ? [
                  {
                    pluginId: 'planr@openplanr-pipeline-local',
                    name: 'planr',
                    marketplaceName: 'openplanr-pipeline-local',
                    version: input.version ?? '0.1.0',
                    enabled: true,
                  },
                ]
              : []),
            ...(input.duplicate
              ? [
                  {
                    pluginId: 'openplanr@legacy',
                    name: 'openplanr',
                    marketplaceName: 'legacy',
                    version: '1.0.0',
                    enabled: true,
                  },
                ]
              : []),
            ...(managedLegacy
              ? [
                  {
                    pluginId: 'openplanr@openplanr-pipeline-local',
                    name: 'openplanr',
                    marketplaceName: 'openplanr-pipeline-local',
                    version: '0.1.0',
                    enabled: true,
                  },
                ]
              : []),
          ],
        }),
      };
    if (args.slice(0, 3).join(' ') === 'plugin marketplace add') configured = true;
    if (args.slice(0, 2).join(' ') === 'plugin add') installed = true;
    if (args.slice(0, 2).join(' ') === 'plugin remove') {
      if (args[2] === 'openplanr@openplanr-pipeline-local') managedLegacy = false;
      else installed = false;
    }
    return { status: 0, stdout: '{}', stderr: '' };
  };
  const fixture = hostPackageFixture();
  return { runner, calls, fixture };
}

describe('Codex plugin integration', () => {
  it('names the CLI host package and setup repair when its marketplace is missing', () => {
    const hostPackageRoot = mkdtempSync(path.join(tmpdir(), 'openplanr-codex-missing-'));
    const calls: string[][] = [];
    const runner: CodexCommandRunner = (args) => {
      calls.push(args);
      return { status: 0, stdout: '{}', stderr: '' };
    };
    try {
      const inspection = inspectCodexPluginIntegration(
        hostPackageRoot,
        'unified-plugin',
        undefined,
        runner,
      );
      expect(inspection).toMatchObject({
        available: false,
        ready: false,
        operations: [],
        error:
          'The CLI bundled Codex host package is missing its OpenPlanr marketplace. Run planr setup --runtime codex to repair it.',
      });
      expect(() => applyCodexPluginIntegration(hostPackageRoot, inspection, runner)).toThrow(
        'Run planr setup --runtime codex to repair it.',
      );
      expect(calls).toEqual([]);
    } finally {
      rmSync(hostPackageRoot, { recursive: true, force: true });
    }
  });

  it('names the host marketplace when it does not declare the managed plugin', () => {
    const state = runnerState();
    writeFileSync(
      path.join(state.fixture, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'openplanr-pipeline-local', plugins: [] }),
    );
    try {
      const inspection = inspectCodexPluginIntegration(
        state.fixture,
        'unified-plugin',
        undefined,
        state.runner,
      );
      expect(inspection).toMatchObject({
        available: false,
        ready: false,
        operations: [],
        error:
          'The CLI bundled Codex host marketplace does not declare planr. Run planr setup --runtime codex to repair it.',
      });
      expect(state.calls).toEqual([]);
    } finally {
      rmSync(state.fixture, { recursive: true, force: true });
    }
  });

  it('accepts a marketplace reached through a workspace package link', () => {
    const state = runnerState({ configured: true, installed: true });
    const linkRoot = mkdtempSync(path.join(tmpdir(), 'openplanr-codex-link-'));
    const linkedFixture = path.join(linkRoot, 'marketplace');
    symlinkSync(state.fixture, linkedFixture, 'dir');
    try {
      const inspection = inspectCodexPluginIntegration(
        linkedFixture,
        'unified-plugin',
        'unified-plugin',
        state.runner,
      );
      expect(inspection.error).toBeUndefined();
      expect(inspection.ready).toBe(true);
    } finally {
      rmSync(linkRoot, { recursive: true, force: true });
    }
  });

  it('installs the short-name plugin before retiring the managed legacy identity', () => {
    const state = runnerState({ configured: true, managedLegacy: true });
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['install', 'remove']);

    applyCodexPluginIntegration(state.fixture, inspection, state.runner);

    const installIndex = state.calls.findIndex(
      (args) => args.join(' ') === 'plugin add planr@openplanr-pipeline-local --json',
    );
    const removeIndex = state.calls.findIndex(
      (args) => args.join(' ') === 'plugin remove openplanr@openplanr-pipeline-local --json',
    );
    expect(installIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(installIndex);
  });

  it('plans and applies one packaged local marketplace installation', () => {
    const state = runnerState();
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      undefined,
      state.runner,
    );
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['add-marketplace', 'install']);
    const applied = applyCodexPluginIntegration(state.fixture, inspection, state.runner);
    expect(applied.restartRequired).toBe(true);
    expect(
      state.calls.some(
        (args) => args.join(' ') === `plugin marketplace add ${state.fixture} --json`,
      ),
    ).toBe(true);
    expect(
      state.calls.some(
        (args) => args.join(' ') === 'plugin add planr@openplanr-pipeline-local --json',
      ),
    ).toBe(true);
  });

  it('retires only the exact managed plugin when switching to direct mode', () => {
    const state = runnerState({ configured: true, installed: true });
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'direct',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.operations).toEqual([
      expect.objectContaining({ kind: 'remove', id: 'planr@openplanr-pipeline-local' }),
    ]);
  });

  it('reports unrelated duplicate OpenPlanr plugins without scheduling their removal', () => {
    const state = runnerState({ configured: true, installed: true, duplicate: true });
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.duplicates).toEqual(['openplanr@legacy']);
    expect(inspection.operations).toEqual([]);
    expect(inspection.ready).toBe(false);
  });
});
