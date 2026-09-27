import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readArtifact,
  readArtifactRaw,
  resolveArtifactFilename,
  updateArtifact,
} from '../../src/services/artifact-service.js';
import { createDefaultConfig } from '../../src/services/config-service.js';
import { findGherkinContent } from '../../src/services/gherkin-service.js';
import { nextSpecId } from '../../src/services/spec-service.js';
import { spliceManagedBlock } from '../../src/utils/splice-managed-block.js';

const config = createDefaultConfig('artifact-id-lookup');
const STORY = '---\nid: "US-001"\ntitle: "Login"\nstatus: "pending"\n---\n# US-001: Login\n';
let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openplanr-artifact-id-'));
  const stories = join(projectDir, config.outputPaths.agile, 'stories');
  mkdirSync(stories, { recursive: true });
  writeFileSync(join(stories, 'US-001-login.md'), STORY);
  writeFileSync(join(stories, 'US-001-gherkin.feature'), 'Feature: Login\n');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('artifact lookups treat the id as a literal name', () => {
  it('still resolves an exact id', async () => {
    await expect(readArtifactRaw(projectDir, config, 'story', 'US-001')).resolves.toBe(STORY);
    await expect(resolveArtifactFilename(projectDir, config, 'story', 'US-001')).resolves.toBe(
      'US-001-login',
    );
    await expect(findGherkinContent(projectDir, config, 'US-001')).resolves.toBe(
      'Feature: Login\n',
    );
  });

  it('finds nothing for ids that would otherwise act as patterns', async () => {
    for (const hostile of ['.*', 'US-00.', '(', '[', 'US-001|x']) {
      await expect(readArtifactRaw(projectDir, config, 'story', hostile)).resolves.toBeNull();
      await expect(readArtifact(projectDir, config, 'story', hostile)).resolves.toBeNull();
      await expect(resolveArtifactFilename(projectDir, config, 'story', hostile)).resolves.toBe(
        hostile,
      );
      await expect(updateArtifact(projectDir, config, 'story', hostile, STORY)).rejects.toThrow(
        `Artifact ${hostile} not found.`,
      );
      await expect(findGherkinContent(projectDir, config, hostile)).resolves.toBeNull();
    }
  });

  it('matches a configured spec prefix literally', async () => {
    const specs = join(projectDir, 'specs');
    mkdirSync(join(specs, 'S.C-001-kept'), { recursive: true });
    mkdirSync(join(specs, 'SXC-004-decoy'), { recursive: true });
    await expect(nextSpecId(specs, 'S.C')).resolves.toBe('S.C-002');
    await expect(nextSpecId(specs, 'S(')).resolves.toBe('S(-001');
  });
});

describe('managed blocks are addressed by their literal marker name', () => {
  const block = (name: string, body: string) =>
    `<!-- ##planr-${name}:begin## (managed) -->\n${body}\n<!-- ##planr-${name}:end## -->`;

  it('leaves a block whose name only matches the marker as a pattern', () => {
    const existing = `${block('aXb', 'other')}\n`;
    const spliced = spliceManagedBlock(existing, 'a.b', 'mine');
    expect(spliced).toContain(block('aXb', 'other'));
    expect(spliced).toContain('##planr-a.b:begin##');
    expect(spliced).toContain('mine');
  });

  it('accepts a marker name with regular-expression syntax', () => {
    expect(() => spliceManagedBlock('', '(', 'body')).not.toThrow();
  });
});
