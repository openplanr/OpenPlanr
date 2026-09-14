import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readBoundedProfessionalSpecInput,
  registerSpecCommand,
} from '../../src/cli/commands/spec.js';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import { saveConfig } from '../../src/services/config-service.js';
import {
  createSpec,
  PROFESSIONAL_SPECIFICATION_CONTRACT,
  type ShapeSpecAnswers,
} from '../../src/services/spec-service.js';

function config(): OpenPlanrConfig {
  return {
    projectName: 'professional-spec-test',
    targets: ['codex'],
    outputPaths: {
      agile: '.planr',
      cursorRules: '.cursor/rules',
      claudeConfig: '.',
      codexConfig: '.',
    },
    idPrefix: {
      epic: 'EPIC',
      feature: 'FEAT',
      story: 'US',
      task: 'TASK',
      quick: 'QT',
      backlog: 'BL',
      sprint: 'SPRINT',
      spec: 'SPEC',
    },
    createdAt: '2026-08-24',
  };
}

function professionalInput(): ShapeSpecAnswers {
  return {
    kind: 'professional-specification',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    context: 'Operators need one reliable way to recover an interrupted import.',
    audience: {
      primary: 'Workspace operators',
      affected: ['Support engineers'],
    },
    outcome: {
      statement: 'Interrupted imports recover without duplicate records.',
      measure: 'Duplicate records observed after recovery',
      target: 'Zero duplicate records in the recovery suite',
      timeframe: 'Every candidate build before owner review',
    },
    functionalRequirements: ['The operator can resume one interrupted import safely'],
    constraints: ['Existing completed imports remain byte-for-byte unchanged'],
    evidenceExpectations: ['A crash-recovery test proves exact-once materialization'],
    failureModes: ['A replay can materialize the same record twice after a crash'],
    rollback: 'Disable resume and restore the prior read-only recovery path.',
    scope: {
      inScope: ['Interrupted local import recovery'],
      outOfScope: ['Remote production data repair remains separately governed'],
    },
    acceptanceCriteria: [
      'Given an interrupted import, when recovery resumes, then each record exists exactly once.',
    ],
    declaredSpecialists: ['data-integrity'],
    businessRules: [],
    decompositionNotes: '',
  };
}

let projectDir: string;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(tmpdir(), 'openplanr-professional-spec-'));
  await fs.mkdir(path.join(projectDir, '.planr'), { recursive: true });
  await saveConfig(projectDir, config());
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (projectDir && existsSync(projectDir)) {
    await fs.rm(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('professional spec CLI input', () => {
  it('reads the same bounded closed object from a file and stdin', async () => {
    const input = JSON.stringify(professionalInput());
    const inputPath = path.join(projectDir, 'professional-spec.json');
    await fs.writeFile(inputPath, input);

    await expect(readBoundedProfessionalSpecInput(inputPath)).resolves.toEqual(professionalInput());
    await expect(readBoundedProfessionalSpecInput('-', Readable.from([input]))).resolves.toEqual(
      professionalInput(),
    );
  });

  it('runs the non-interactive JSON journey and returns the next planning action', async () => {
    await createSpec(projectDir, config(), 'Crash-safe import');
    const inputPath = path.join(projectDir, 'professional-spec.json');
    await fs.writeFile(inputPath, JSON.stringify(professionalInput()));

    const writes: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...values) => {
      writes.push(values.map(String).join(' '));
    });
    const program = new Command().exitOverride();
    program.option('--project-dir <path>');
    registerSpecCommand(program);
    await program.parseAsync([
      'node',
      'planr',
      '--project-dir',
      projectDir,
      'spec',
      'shape',
      'SPEC-001',
      '--file',
      inputPath,
      '--json',
    ]);

    const result = JSON.parse(writes.join('').trim()) as Record<string, unknown>;
    expect(result).toMatchObject({
      ok: true,
      action: 'spec.professional-shaped',
      specId: 'SPEC-001',
      contract: PROFESSIONAL_SPECIFICATION_CONTRACT,
      status: 'shaped',
      next: '$planr:plan SPEC-001',
    });
    const shapedPath = path.join(
      projectDir,
      '.planr/specs/SPEC-001-crash-safe-import/SPEC-001-crash-safe-import.md',
    );
    const shaped = await fs.readFile(shapedPath, 'utf8');
    expect(shaped).toContain(`specificationContract: "${PROFESSIONAL_SPECIFICATION_CONTRACT}"`);
    expect(shaped).toContain('$planr:plan SPEC-001');
    expect(shaped).not.toContain('Owner-review stop');
  });
});
