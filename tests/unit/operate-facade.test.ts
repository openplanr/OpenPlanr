import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';

describe('operate runtime-neutral facade', () => {
  it('reports the effective isolated state root during inspection', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-inspect-'));
    const localRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-state-'));
    const result = await executeOperateAction({
      action: 'inspect',
      interactive: false,
      options: { json: true, localRoot },
      projectRoot,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        machineLocalState: expect.stringContaining(join(localRoot, 'operate')),
      },
    });
  });

  it('uses the documented invalid-invocation exit class', async () => {
    await expect(
      executeOperateAction({
        action: 'not-a-real-action',
        arguments: {},
        interactive: false,
        options: { json: true },
        projectRoot: process.cwd(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'E_OPERATE_ACTION_UNKNOWN',
      state: null,
      paths: {},
      counts: {},
      warnings: [],
      nextActions: ['planr operate diagnostics export'],
      exitCode: 2,
    });
  });

  it('returns canonical questions for missing non-interactive governance input', async () => {
    await expect(
      executeOperateAction({
        action: 'init',
        arguments: {},
        interactive: false,
        options: { json: true, preview: true },
        projectRoot: process.cwd(),
      }),
    ).resolves.toMatchObject({
      // FR7/E-007: a guided-stage advance is an `ok: true` handoff, not exit 4.
      ok: true,
      flow: 'handoff',
      action: 'input_required',
      code: 'E_OPERATE_INPUT_REQUIRED',
      questionnaire: {
        kind: 'guided-questionnaire',
        stage: 'foundation',
      },
    });
  });

  it('normalizes malformed custom profile input without leaking parser excerpts', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-profile-'));
    await writeFile(join(projectRoot, 'profile.json'), 'import { rawSecret } from "elsewhere";\n');

    const result = await executeOperateAction({
      action: 'profiles.validate',
      arguments: { file: 'profile.json' },
      interactive: false,
      options: { json: true },
      projectRoot,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'E_OPERATE_CONFIG_INVALID',
      exitCode: 2,
      message: 'Custom profile must be a valid bounded JSON object.',
    });
    expect(JSON.stringify(result)).not.toContain('rawSecret');
  });

  it('rejects and never echoes unknown custom-profile fields', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-profile-secret-'));
    await writeFile(
      join(projectRoot, 'profile.json'),
      JSON.stringify({
        id: 'custom',
        enabledRoles: ['technology-risk'],
        enabledProviders: ['repository'],
        apiKey: 'must-never-be-echoed',
      }),
    );

    const result = await executeOperateAction({
      action: 'profiles.validate',
      arguments: { file: 'profile.json' },
      interactive: false,
      options: { json: true },
      projectRoot,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'E_OPERATE_CONFIG_INVALID',
      exitCode: 2,
    });
    expect(JSON.stringify(result)).not.toContain('must-never-be-echoed');
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });

  it('uses the same strict custom-profile parser during initialization', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-init-profile-'));
    await writeFile(join(projectRoot, 'profile.json'), '{"enabledRoles": [}');

    const result = await executeOperateAction({
      action: 'init',
      arguments: {},
      interactive: false,
      options: {
        json: true,
        preview: true,
        profile: 'custom',
        profileFile: 'profile.json',
        decisionOwner: 'Owner',
        planningEngine: 'openplanr',
      },
      projectRoot,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'E_OPERATE_CONFIG_INVALID',
      exitCode: 2,
      message: 'Custom profile must be a valid bounded JSON object.',
    });
  });

  it('classifies and redacts unexpected internal failures', async () => {
    const result = await executeOperateAction({
      action: 'profiles.validate',
      arguments: { file: 'missing.json' },
      interactive: false,
      options: { json: true },
      projectRoot: '/definitely/not/a/project',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'E_OPERATE_INTERNAL',
      exitCode: 1,
      message: 'An unexpected internal Operating Board error occurred.',
    });
    expect(result.message).not.toContain('/definitely/not/a/project');
  });

  it('returns a stable recovery action for an absent guided session', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-session-missing-'));
    const localRoot = await mkdtemp(join(tmpdir(), 'openplanr-operate-session-state-'));
    const result = await executeOperateAction({
      action: 'init',
      arguments: {},
      interactive: false,
      options: {
        json: true,
        localRoot,
        resume: 'GIS-12345678',
      },
      projectRoot,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'E_OPERATE_SESSION_INVALID',
      exitCode: 2,
      nextActions: ['planr operate init --json'],
    });
  });
});
