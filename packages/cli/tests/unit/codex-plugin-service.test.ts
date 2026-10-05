import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyCodexPluginIntegration,
  type CodexCommandRunner,
  inspectCodexPluginIntegration,
} from '../../src/services/codex-plugin-service.js';

let nativeHome: string;
let previousCodexHome: string | undefined;
beforeEach(() => {
  previousCodexHome = process.env.CODEX_HOME;
  nativeHome = mkdtempSync(path.join(tmpdir(), 'openplanr-codex-config-'));
  process.env.CODEX_HOME = nativeHome;
});
afterEach(() => {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  rmSync(nativeHome, { recursive: true, force: true });
});

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
          'The CLI bundled Codex host package is missing its OpenPlanr marketplace. Run openplanr setup --runtime codex to repair it.',
      });
      expect(() => applyCodexPluginIntegration(hostPackageRoot, inspection, runner)).toThrow(
        'Run openplanr setup --runtime codex to repair it.',
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
          'The CLI bundled Codex host marketplace does not declare planr. Run openplanr setup --runtime codex to repair it.',
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

  it('repairs an enabled legacy registration omitted from the current marketplace inventory', () => {
    const state = runnerState({ configured: true, installed: true });
    writeFileSync(
      path.join(nativeHome, 'config.toml'),
      `
# A quoted multiline value is not a plugin table.
notes = """[plugins."planr@unrelated"] enabled = true"""
[plugins."openplanr@openplanr-pipeline-local"]
enabled = true
[plugins."unrelated@custom"]
enabled = true
`,
    );
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.ready).toBe(false);
    expect(inspection.duplicates).toEqual(['openplanr@openplanr-pipeline-local']);
    expect(inspection.operations).toEqual([
      expect.objectContaining({ kind: 'remove', id: 'openplanr@openplanr-pipeline-local' }),
    ]);
    applyCodexPluginIntegration(state.fixture, inspection, state.runner);
    expect(state.calls).toContainEqual([
      'plugin',
      'remove',
      'openplanr@openplanr-pipeline-local',
      '--json',
    ]);
    expect(state.calls.some((args) => args.includes('unrelated@custom'))).toBe(false);
  });

  it('does not count a current plugin as ready while legacy removal remains pending', () => {
    const state = runnerState({ configured: true, installed: true, managedLegacy: true });
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.ready).toBe(false);
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['remove']);
    applyCodexPluginIntegration(state.fixture, inspection, state.runner);
    expect(
      inspectCodexPluginIntegration(
        state.fixture,
        'unified-plugin',
        'unified-plugin',
        state.runner,
      ),
    ).toMatchObject({ ready: true, operations: [] });
  });

  it('repairs disabled current discovery using native remove and install operations', () => {
    const state = runnerState({ configured: true, installed: true });
    writeFileSync(
      path.join(nativeHome, 'config.toml'),
      '[plugins."planr@openplanr-pipeline-local"]\nenabled = false\n',
    );
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.ready).toBe(false);
    expect(inspection.installed).toBe(false);
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['remove', 'install']);
  });

  it('does not confuse an available uninstalled plugin with installed discovery', () => {
    const state = runnerState({ configured: true });
    const runner: CodexCommandRunner = (args) =>
      args.join(' ') === 'plugin list --json'
        ? {
            status: 0,
            stderr: '',
            stdout: JSON.stringify([
              {
                pluginId: 'planr@openplanr-pipeline-local',
                name: 'planr',
                marketplaceName: 'openplanr-pipeline-local',
                version: '0.1.0',
                enabled: true,
                installed: false,
              },
            ]),
          }
        : state.runner(args);
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      undefined,
      runner,
    );
    expect(inspection).toMatchObject({ ready: false, installed: false });
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['install']);
  });

  it('preserves direct mode by retiring its conflicting managed plugins', () => {
    const state = runnerState({ configured: true, installed: true, managedLegacy: true });
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'direct',
      'direct',
      state.runner,
    );
    expect(inspection.ready).toBe(false);
    expect(inspection.operations.map(({ id }) => id)).toEqual([
      'planr@openplanr-pipeline-local',
      'openplanr@openplanr-pipeline-local',
    ]);
    applyCodexPluginIntegration(state.fixture, inspection, state.runner);
    expect(
      inspectCodexPluginIntegration(state.fixture, 'direct', 'direct', state.runner),
    ).toMatchObject({ ready: true, operations: [] });
  });

  it('repairs a same-version plugin whose cached skill payload is incomplete', () => {
    const state = runnerState({ configured: true, installed: true });
    const packaged = path.join(state.fixture, 'plugins', 'openplanr');
    mkdirSync(path.join(packaged, 'skills', 'plan'), { recursive: true });
    mkdirSync(path.join(packaged, 'skills', 'ship'), { recursive: true });
    writeFileSync(path.join(packaged, 'skills', 'plan', 'SKILL.md'), 'plan skill');
    writeFileSync(path.join(packaged, 'skills', 'ship', 'SKILL.md'), 'ship skill');
    const cache = path.join(
      nativeHome,
      'plugins',
      'cache',
      'openplanr-pipeline-local',
      'planr',
      '0.1.0',
    );
    mkdirSync(path.join(cache, 'skills', 'plan'), { recursive: true });
    writeFileSync(path.join(cache, 'skills', 'plan', 'SKILL.md'), 'plan skill');
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection).toMatchObject({
      ready: false,
      installedVersion: '0.1.0',
      payloadCurrent: false,
    });
    expect(inspection.operations.map(({ kind }) => kind)).toEqual(['remove', 'install']);
    expect(inspection.operations[0].description).toContain('incomplete');
    cpSync(packaged, cache, { recursive: true });
    expect(
      inspectCodexPluginIntegration(
        state.fixture,
        'unified-plugin',
        'unified-plugin',
        state.runner,
      ),
    ).toMatchObject({ ready: true, operations: [], payloadCurrent: true });
  });

  it('keeps malformed native configuration private and schedules no mutations', () => {
    const state = runnerState({ configured: true, installed: true });
    writeFileSync(path.join(nativeHome, 'config.toml'), 'private_key = "do-not-leak');
    const inspection = inspectCodexPluginIntegration(
      state.fixture,
      'unified-plugin',
      'unified-plugin',
      state.runner,
    );
    expect(inspection.error).toContain('Repair its TOML');
    expect(inspection.error).not.toContain('do-not-leak');
    expect(inspection.operations).toEqual([]);
  });

  it('reports off-schema Codex output as an inspection error naming the command and field', () => {
    const state = runnerState({ configured: true, installed: true });
    const runner: CodexCommandRunner = (args) =>
      args.join(' ') === 'plugin list --json'
        ? {
            status: 0,
            stderr: '',
            stdout: '{"installed":[{"pluginId":"planr@openplanr-pipeline-local","version":1}]}',
          }
        : state.runner(args);
    try {
      const inspection = inspectCodexPluginIntegration(
        state.fixture,
        'unified-plugin',
        'unified-plugin',
        runner,
      );
      expect(inspection.ready).toBe(false);
      expect(inspection.operations).toEqual([]);
      expect(inspection.error).toBe(
        'codex plugin list --json has an unexpected shape: (root): Invalid input: expected array, received object | installed.0.version: Invalid input: expected string, received number',
      );
    } finally {
      rmSync(state.fixture, { recursive: true, force: true });
    }
  });
});
