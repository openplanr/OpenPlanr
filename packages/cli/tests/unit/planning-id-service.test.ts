import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpenPlanrConfig } from '../../src/models/types.js';
import { previewPlanningIds, reservePlanningIds } from '../../src/services/planning-id-service.js';

let projectDir: string;
const config = {
  outputPaths: { agile: '.planr' },
} as OpenPlanrConfig;

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'openplanr-id-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('planning ID allocation', () => {
  it('previews project-global IDs without writing state', async () => {
    await expect(previewPlanningIds(projectDir, config, { SPEC: 1, US: 2, T: 1 })).resolves.toEqual(
      {
        SPEC: ['SPEC-001'],
        US: ['US-001', 'US-002'],
        T: ['T-001'],
      },
    );
    expect(existsSync(path.join(projectDir, '.planr'))).toBe(false);
  });

  it('allocates unique max-plus-one IDs across concurrent callers', async () => {
    const reservations = await Promise.all(
      Array.from({ length: 12 }, () => reservePlanningIds(projectDir, config, { T: 1 })),
    );
    expect(reservations.flatMap(({ T }) => T).sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => `T-${String(index + 1).padStart(3, '0')}`),
    );
  });

  it('scans existing artifacts and never reuses an allocated ID after deletion', async () => {
    const taskDir = path.join(projectDir, '.planr', 'specs', 'SPEC-040-x', 'tasks');
    await mkdir(taskDir, { recursive: true });
    const existing = path.join(taskDir, 'T-040-x.md');
    await writeFile(existing, '# T-040\n');
    await expect(reservePlanningIds(projectDir, config, { T: 1 })).resolves.toMatchObject({
      T: ['T-041'],
    });
    await unlink(existing);
    await expect(reservePlanningIds(projectDir, config, { T: 1 })).resolves.toMatchObject({
      T: ['T-042'],
    });
  });
});

describe('planning ID procedure', () => {
  const procedure = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../skills/planr-plan/references/planning-ids.md',
    ),
    'utf8',
  );

  it('documents the exact sequence file the CLI writes', async () => {
    const example = /```json\n([\s\S]*?)```/u.exec(procedure)?.[1];
    expect(example).toBeDefined();
    const specs = path.join(projectDir, '.planr', 'specs');
    await mkdir(path.join(specs, 'SPEC-003-x', 'stories'), { recursive: true });
    await writeFile(path.join(specs, 'SPEC-003-x', 'stories', 'US-014-x.md'), '');
    await writeFile(
      path.join(specs, '.id-sequence.json'),
      JSON.stringify({
        kind: 'planning-id-sequence',
        schemaVersion: '1.0.0',
        protocolVersion: '1.7.0',
        next: { SPEC: 4, US: 12, T: 41 },
      }),
    );
    await expect(reservePlanningIds(projectDir, config, { US: 1, T: 1 })).resolves.toEqual({
      SPEC: [],
      US: ['US-015'],
      T: ['T-041'],
    });
    expect(await readFile(path.join(specs, '.id-sequence.json'), 'utf8')).toBe(example);
  });

  it('names the lock file the CLI holds while reserving', () => {
    expect(procedure).toContain('`<specs root>/.id-sequence.lock`');
  });
});
