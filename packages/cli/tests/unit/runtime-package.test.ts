import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inspectRuntimeLocator,
  inspectRuntimePackage,
  inspectThinRule,
  runtimeLocator,
  thinDiscoveryMetadata,
  thinSkillEntry,
} from '../../src/services/runtime-manager/runtime-package.js';

let root: string;
let sourceRoot: string;
let cacheRoot: string;
const sha = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-runtime-package-'));
  sourceRoot = join(root, 'source');
  cacheRoot = join(root, 'runtime', 'packages');
  const files = [
    [
      'skills/plan/SKILL.md',
      '---\nname: plan\ndescription: Plan a feature.\n---\nRead [contract](references/contract.md).\n',
    ],
    ['skills/plan/references/contract.md', '# Contract\n'],
    ['runtime/design/main.mjs', 'export const version = 1;\n'],
  ].map(([path, text]) => {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    const bytes = Buffer.from(text);
    writeFileSync(join(sourceRoot, path), bytes);
    return { path, digest: sha(bytes) };
  });
  writeFileSync(
    join(sourceRoot, '.openplanr-content.json'),
    JSON.stringify({ kind: 'openplanr-host-package-content', files }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function seed() {
  const runtime = inspectRuntimePackage(sourceRoot, cacheRoot, 'openai', '1.2.3');
  mkdirSync(dirname(runtime.root), { recursive: true });
  cpSync(sourceRoot, runtime.root, { recursive: true });
  return runtime;
}

describe('immutable runtime packages', () => {
  it('pins complete reviewed bytes outside thin native discovery and resolves them offline', () => {
    const runtime = seed();
    const entry = 'skills/plan/SKILL.md';
    const locator = runtimeLocator(runtime, entry);
    const directory = join(root, 'project', '.agents', 'skills', 'plan');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'SKILL.md'),
      thinSkillEntry(readFileSync(join(sourceRoot, entry)), locator),
    );
    writeFileSync(join(directory, 'openplanr.install.json'), JSON.stringify(locator));
    expect(inspectRuntimeLocator(directory)).toEqual(locator);
    expect(readFileSync(join(directory, 'SKILL.md'), 'utf8')).toContain(
      'Resolve every relative reference',
    );
    expect(
      readFileSync(join(locator.sourceRoot, 'skills/plan/references/contract.md'), 'utf8'),
    ).toBe('# Contract\n');
    expect(inspectRuntimePackage(sourceRoot, cacheRoot, 'openai', '1.2.3').root).toBe(runtime.root);
  });
  it('allows an interrupted exact package to be completed but never rewrites changed bytes', () => {
    const runtime = seed();
    rmSync(join(runtime.root, 'runtime/design/main.mjs'));
    expect(inspectRuntimePackage(sourceRoot, cacheRoot, 'openai', '1.2.3').files).toHaveLength(4);
    writeFileSync(join(runtime.root, 'skills/plan/SKILL.md'), 'owner edit\n');
    expect(() => inspectRuntimePackage(sourceRoot, cacheRoot, 'openai', '1.2.3')).toThrow(
      'immutable runtime package was changed',
    );
    expect(readFileSync(join(runtime.root, 'skills/plan/SKILL.md'), 'utf8')).toBe('owner edit\n');
  });
  it('rejects links, unknown files, bad digests and unsafe catalog paths', () => {
    writeFileSync(join(sourceRoot, 'unexpected.mjs'), 'unknown');
    expect(() => seed()).toThrow('differ from the reviewed content inventory');
    rmSync(join(sourceRoot, 'unexpected.mjs'));
    symlinkSync(join(sourceRoot, 'skills/plan/SKILL.md'), join(sourceRoot, 'unexpected.mjs'));
    expect(() => seed()).toThrow('symbolic link');
    rmSync(join(sourceRoot, 'unexpected.mjs'));
    const inventory = join(sourceRoot, '.openplanr-content.json');
    const parsed = JSON.parse(readFileSync(inventory, 'utf8'));
    parsed.files[0].path = '../outside';
    writeFileSync(inventory, JSON.stringify(parsed));
    expect(() => seed()).toThrow('unsafe or duplicate');
  });
  it('renders bare discovery metadata without changing namespaced native metadata', () => {
    const original = Buffer.from('default_prompt: "Use $planr:plan to plan."\n');
    expect(thinDiscoveryMetadata('agents/openai.yaml', original).toString()).toBe(
      'default_prompt: "Use $plan to plan."\n',
    );
    expect(original.toString()).toContain('$planr:plan');
  });
  it.each([
    ['openai', '`$plan`, `$ship`', '`$<name>`'],
    ['claude', '`/plan`, `/ship`', '`/<name>`'],
    ['cursor', '`planr-plan.mdc`, `planr-ship.mdc`', 'registered `planr-<name>.mdc` rules'],
  ])(
    'declares %s direct handoff and router invocation context without changing the suite',
    (host, examples, mapping) => {
      const runtime = inspectRuntimePackage(sourceRoot, cacheRoot, host, '1.2.3');
      const native = Buffer.from(
        '---\nname: plan\ndescription: Plan a feature.\n---\nInvoke `$planr:ship T-NNN` or `/planr:ship T-NNN`. Route `planr-plan` through the native namespace.\n',
      );
      const original = Buffer.from(native);
      const locator = runtimeLocator(runtime, 'skills/plan/SKILL.md');
      const direct = thinSkillEntry(native, locator).toString();
      expect(direct).toContain(examples);
      expect(direct).toContain(mapping);
      expect(direct).toContain('keep cached resource paths unchanged');
      expect(native).toEqual(original);
      expect(native.toString()).toContain('$planr:ship');
      expect(native.toString()).toContain('planr-plan');
    },
  );
  it('validates the complete package behind a thin Cursor rule', () => {
    const entry = 'rules/planr-plan.mdc';
    const content = Buffer.from('---\ndescription: Plan a feature.\n---\n# Plan\n');
    mkdirSync(join(sourceRoot, 'rules'));
    writeFileSync(join(sourceRoot, entry), content);
    const inventory = join(sourceRoot, '.openplanr-content.json');
    const manifest = JSON.parse(readFileSync(inventory, 'utf8'));
    manifest.files.push({ path: entry, digest: sha(content) });
    writeFileSync(inventory, JSON.stringify(manifest));
    const runtime = inspectRuntimePackage(sourceRoot, cacheRoot, 'cursor', '1.2.3');
    mkdirSync(dirname(runtime.root), { recursive: true });
    cpSync(sourceRoot, runtime.root, { recursive: true });
    const target = join(root, 'planr-plan.mdc');
    writeFileSync(target, thinSkillEntry(content, runtimeLocator(runtime, entry)));
    expect(inspectThinRule(target)?.sourceRoot).toBe(runtime.root);
    rmSync(join(runtime.root, 'runtime/design/main.mjs'));
    expect(() => inspectThinRule(target)).toThrow('differ from the reviewed content inventory');
  });
  it('detects a missing shared runtime before claiming a thin entry is usable', () => {
    const runtime = seed();
    const locator = runtimeLocator(runtime, 'skills/plan/SKILL.md');
    const directory = join(root, 'discovery');
    mkdirSync(directory);
    writeFileSync(
      join(directory, 'SKILL.md'),
      thinSkillEntry(readFileSync(join(sourceRoot, locator.entryPath)), locator),
    );
    writeFileSync(join(directory, 'openplanr.install.json'), JSON.stringify(locator));
    rmSync(join(runtime.root, 'runtime/design/main.mjs'));
    expect(() => inspectRuntimeLocator(directory)).toThrow(
      'differ from the reviewed content inventory',
    );
  });
});
