import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';
import { applySetup, runtimeDoctor } from '../../src/services/runtime-manager-service.js';

const directories: string[] = [];

afterEach(async () => {
  delete process.env.OPENPLANR_HOME;
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('doctor guided Operating Board diagnostics', () => {
  it('reports adapter interaction capability, generated skill health, and expired sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-guided-operate-'));
    const projectRoot = join(root, 'project');
    const home = join(root, 'home');
    directories.push(root);
    await mkdir(join(projectRoot, '.planr'), { recursive: true });
    await writeFile(join(projectRoot, '.planr', 'config.json'), '{}\n');
    await mkdir(join(projectRoot, '.planr', 'operate'), { recursive: true });
    process.env.OPENPLANR_HOME = home;
    process.env.OPENPLANR_PIPELINE_ROOT = resolve('../planr-pipeline');
    await applySetup({
      projectDir: projectRoot,
      cliVersion: '1.15.0',
      runtime: 'codex',
      scope: 'user',
    });
    const sessions = resolveOperatingPaths(projectRoot, {
      localRoot: join(home, '.planr'),
    }).sessions;
    await mkdir(sessions, { recursive: true });
    await writeFile(
      join(sessions, 'GIS-expired-session.json'),
      `${JSON.stringify({ expiresAt: '2020-01-01T00:00:00.000Z' })}\n`,
    );

    const doctor = await runtimeDoctor(projectRoot);
    expect(
      doctor.diagnostics.find((entry) => entry.code === 'runtime-interaction-codex'),
    ).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('native guided questions'),
    });
    expect(doctor.diagnostics.find((entry) => entry.code === 'operate-skill')).toMatchObject({
      status: 'pass',
    });
    expect(
      doctor.diagnostics.find((entry) => entry.code === 'operate-guided-sessions'),
    ).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('1 expired'),
    });
  });
});
