import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectCodexSkillDiscovery } from '../../src/services/runtime-manager/codex-discovery.js';

let root: string;
let previousHome: string | undefined;
let previousCodexHome: string | undefined;
let packaged: string;
let nativeHome: string;
let project: string;
beforeEach(() => {
  previousHome = process.env.OPENPLANR_HOME;
  previousCodexHome = process.env.CODEX_HOME;
  root = mkdtempSync(path.join(tmpdir(), 'openplanr-discovery-'));
  process.env.OPENPLANR_HOME = path.join(root, 'home');
  nativeHome = path.join(root, 'ada');
  process.env.CODEX_HOME = nativeHome;
  project = path.join(root, 'project');
  packaged = path.join(root, 'host', 'openplanr', 'skills', 'design');
  mkdirSync(packaged, { recursive: true });
  mkdirSync(nativeHome, { recursive: true });
  writeFileSync(path.join(packaged, 'SKILL.md'), '# Design\n');
  writeFileSync(path.join(packaged, 'support.mjs'), 'export const complete = true;\n');
  writeFileSync(
    path.join(packaged, 'openplanr.skill.json'),
    JSON.stringify({ skillId: 'planr-design', skillVersion: '2.1.0', protocolVersion: '1.8.0' }),
  );
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.OPENPLANR_HOME;
  else process.env.OPENPLANR_HOME = previousHome;
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  rmSync(root, { recursive: true, force: true });
});
function inspect() {
  return inspectCodexSkillDiscovery({
    hostPackageRoot: path.join(root, 'host'),
    projectDir: project,
    mode: 'direct',
    packageVersion: '2.2640.6',
    ownershipStatePath: path.join(root, 'ownership.json'),
  });
}
describe('Codex skill discovery provenance', () => {
  it('separates package and skill versions and reads only the effective account', () => {
    const target = path.join(nativeHome, 'skills', 'design');
    cpSync(packaged, target, { recursive: true });
    const unrelated = path.join(root, 'home', '.codex', 'skills', 'design');
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(path.join(unrelated, 'SKILL.md'), 'another account');
    const report = inspect();
    expect(report.effectiveHome).toBe(realpathSync(nativeHome));
    expect(report.sessionResolution).toBe('restart-required-to-confirm');
    expect(report.skills[0]).toMatchObject({
      resolution: 'current',
      entrypoint: path.join(realpathSync(target), 'SKILL.md'),
    });
    expect(report.skills[0].copies[1]).toMatchObject({
      skillVersion: '2.1.0',
      protocolVersion: '1.8.0',
      packageVersion: null,
      sourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      current: true,
    });
    expect(JSON.stringify(report)).not.toContain('another account');
  });
  it('detects incomplete support closures even when the entrypoint and version are identical', () => {
    const target = path.join(nativeHome, 'skills', 'design');
    cpSync(packaged, target, { recursive: true });
    rmSync(path.join(target, 'support.mjs'));
    expect(inspect().skills[0]).toMatchObject({ resolution: 'stale' });
    expect(inspect().skills[0].copies[1].current).toBe(false);
  });
  it('reports disabled legacy caches without claiming they are active or modifying them', () => {
    const target = path.join(nativeHome, 'skills', 'design');
    cpSync(packaged, target, { recursive: true });
    const legacy = path.join(
      nativeHome,
      'plugins',
      'cache',
      'openplanr-local',
      'openplanr',
      '0.1.0',
      'skills',
      'planr-design',
    );
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, 'SKILL.md'), 'old skill');
    const config = '[plugins."openplanr@openplanr-local"]\nenabled = false\n';
    writeFileSync(path.join(nativeHome, 'config.toml'), config);
    const report = inspect();
    expect(report.skills[0].resolution).toBe('current');
    expect(report.skills[0].copies).toContainEqual(
      expect.objectContaining({
        kind: 'plugin-cache',
        packageVersion: '0.1.0',
        enabled: false,
        current: false,
      }),
    );
    expect(readFileSync(path.join(nativeHome, 'config.toml'), 'utf8')).toBe(config);
    expect(readFileSync(path.join(legacy, 'SKILL.md'), 'utf8')).toBe('old skill');
  });
  it('does not treat historical versions of the enabled plugin as multiple active installations', () => {
    for (const version of ['0.1.0', '2.2640.6']) {
      cpSync(
        packaged,
        path.join(
          nativeHome,
          'plugins',
          'cache',
          'openplanr-local',
          'planr',
          version,
          'skills',
          'design',
        ),
        { recursive: true },
      );
    }
    writeFileSync(
      path.join(nativeHome, 'config.toml'),
      '[plugins."planr@openplanr-local"]\nenabled = true\n',
    );
    const report = inspectCodexSkillDiscovery({
      hostPackageRoot: path.join(root, 'host'),
      projectDir: project,
      mode: 'unified-plugin',
      packageVersion: '2.2640.6',
      ownershipStatePath: path.join(root, 'ownership.json'),
      activePlugin: { id: 'planr@openplanr-local', version: '2.2640.6' },
    });
    expect(report.skills[0]).toMatchObject({ resolution: 'current' });
    expect(report.skills[0].copies.filter((copy) => copy.enabled)).toHaveLength(1);
  });
  it('reports duplicate project and user discovery without choosing a session path', () => {
    cpSync(packaged, path.join(nativeHome, 'skills', 'design'), { recursive: true });
    cpSync(packaged, path.join(project, '.agents', 'skills', 'design'), { recursive: true });
    expect(inspect().skills[0]).toMatchObject({ resolution: 'ambiguous', entrypoint: null });
  });
});

describe('Codex discovery failure diagnostics', () => {
  it('reports malformed native configuration without including its private values', () => {
    const config = '[plugins."planr@openplanr-local"]\nenabled = "private-placeholder\n';
    writeFileSync(path.join(nativeHome, 'config.toml'), config);
    const report = inspect();
    expect(report.issues).toEqual([expect.stringContaining('config.toml')]);
    expect(JSON.stringify(report)).not.toContain('private-placeholder');
    expect(readFileSync(path.join(nativeHome, 'config.toml'), 'utf8')).toBe(config);
  });
  it('reports unavailable bundled skills instead of claiming an empty current installation', () => {
    rmSync(path.join(root, 'host'), { recursive: true });
    const report = inspect();
    expect(report.skills).toEqual([]);
    expect(report.issues).toContainEqual(
      expect.stringContaining('bundled Codex skills are unavailable'),
    );
  });
  it('reports symlinked skill copies as unreadable evidence without following or changing them', () => {
    const outside = path.join(root, 'outside');
    cpSync(packaged, outside, { recursive: true });
    mkdirSync(path.join(nativeHome, 'skills'), { recursive: true });
    const link = path.join(nativeHome, 'skills', 'design');
    symlinkSync(outside, link, 'dir');
    const before = readFileSync(path.join(outside, 'SKILL.md'), 'utf8');
    const report = inspect();
    expect(report.skills[0]).toMatchObject({ resolution: 'unreadable' });
    expect(report.skills[0].copies).toContainEqual(
      expect.objectContaining({
        kind: 'user',
        sourceHash: null,
        issue: expect.stringContaining('regular skill closure'),
      }),
    );
    expect(realpathSync(link)).toBe(realpathSync(outside));
    expect(readFileSync(path.join(outside, 'SKILL.md'), 'utf8')).toBe(before);
  });
});
