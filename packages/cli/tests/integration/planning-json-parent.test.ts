import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerFeatureCommand,
  registerStoryCommand,
} from '../../src/cli/commands/planning-artifacts.js';
import { readArtifact } from '../../src/services/artifact-service.js';
import {
  createTestProject,
  type TestProject,
  writeSampleEpic,
  writeSampleFeature,
} from '../helpers/test-project.js';

const projects: TestProject[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const project of projects.splice(0)) project.cleanup();
});

function command(projectDir: string, register: (program: Command) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--project-dir <path>', 'project directory', projectDir);
  register(program);
  return program;
}

describe('planning JSON parent inputs', () => {
  it('creates a feature from JSON epicId without requiring a duplicate flag', async () => {
    const project = await createTestProject('feature-json-parent');
    projects.push(project);
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Platform');
    const input = path.join(project.dir, 'feature.json');
    await writeFile(input, JSON.stringify({ title: 'Hosted review', epicId: 'EPIC-001' }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await command(project.dir, registerFeatureCommand).parseAsync([
      'node',
      'planr',
      'feature',
      'create',
      '--data',
      input,
      '--json',
    ]);

    const created = await readArtifact(project.dir, project.config, 'feature', 'FEAT-001');
    expect(created?.data).toMatchObject({ title: 'Hosted review', epicId: 'EPIC-001' });
  });

  it('creates a story from JSON featureId without requiring a duplicate flag', async () => {
    const project = await createTestProject('story-json-parent');
    projects.push(project);
    await writeSampleEpic(project.dir, project.config, 'EPIC-001', 'Platform');
    await writeSampleFeature(project.dir, project.config, 'FEAT-001', 'Hosted review', 'EPIC-001');
    const input = path.join(project.dir, 'story.json');
    await writeFile(input, JSON.stringify({ title: 'Review a diagram', featureId: 'FEAT-001' }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await command(project.dir, registerStoryCommand).parseAsync([
      'node',
      'planr',
      'story',
      'create',
      '--data',
      input,
      '--json',
    ]);

    const created = await readArtifact(project.dir, project.config, 'story', 'US-001');
    expect(created?.data).toMatchObject({ title: 'Review a diagram', featureId: 'FEAT-001' });
  });
});
