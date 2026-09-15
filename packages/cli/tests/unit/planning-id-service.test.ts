import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
