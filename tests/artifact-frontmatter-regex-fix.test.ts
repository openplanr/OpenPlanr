/**
 * Regression test for review finding M1 — `updateArtifactFields` must preserve
 * regex-special sequences (`$1`, `$&`, `` $` ``, `$'`, `$$`) verbatim when
 * writing Linear-sourced values (or any externally-supplied value) into
 * frontmatter. The underlying `frontmatter.replace(pattern, replacement)`
 * previously interpreted those sequences and silently corrupted the output.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { updateArtifactFields } from '../src/services/artifact-service.js';
import { ensureDir } from '../src/utils/fs.js';

describe('updateArtifactFields — regex backreference handling (M1)', () => {
  let projectDir: string;
  const config: OpenPlanrConfig = {
    projectName: 'test',
    targets: ['cursor'],
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
    createdAt: '2026-04-22',
  };
  const initialBody = `# EPIC-050: Sample\n\n## Overview\n\nContent.\n`;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'planr-fm-regex-'));
    await ensureDir(join(projectDir, '.planr', 'epics'));
    writeFileSync(
      join(projectDir, '.planr', 'epics', 'EPIC-050-sample.md'),
      `---\nid: "EPIC-050"\ntitle: "Sample"\nstatus: "planning"\n---\n\n${initialBody}`,
    );
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('preserves `$1` in a field value (pre-M1, this got eaten as a regex backreference)', async () => {
    await updateArtifactFields(projectDir, config, 'epic', 'EPIC-050', {
      title: 'Fix the $1 bug that bites on save',
    });
    const raw = readFileSync(join(projectDir, '.planr', 'epics', 'EPIC-050-sample.md'), 'utf-8');
    expect(raw).toContain('title: "Fix the $1 bug that bites on save"');
    expect(raw).not.toContain('title: "Fix the  bug that bites on save"'); // what the bug produced
  });

  it('preserves `$&` (whole-match specifier) in a field value', async () => {
    await updateArtifactFields(projectDir, config, 'epic', 'EPIC-050', {
      title: 'escaped $& stays literal',
    });
    const raw = readFileSync(join(projectDir, '.planr', 'epics', 'EPIC-050-sample.md'), 'utf-8');
    expect(raw).toContain('title: "escaped $& stays literal"');
  });

  it('preserves `$$` (would become `$` under string-replacement semantics)', async () => {
    await updateArtifactFields(projectDir, config, 'epic', 'EPIC-050', {
      title: 'double $$ stays double',
    });
    const raw = readFileSync(join(projectDir, '.planr', 'epics', 'EPIC-050-sample.md'), 'utf-8');
    expect(raw).toContain('title: "double $$ stays double"');
  });

  it('preserves a realistic Linear-style value containing a dollar sign', async () => {
    // A URL fragment or display name can legitimately contain `$` — the
    // writer must not mangle it regardless of source.
    await updateArtifactFields(projectDir, config, 'epic', 'EPIC-050', {
      linearProjectUrl: 'https://linear.app/team/project#section-$1',
    });
    const raw = readFileSync(join(projectDir, '.planr', 'epics', 'EPIC-050-sample.md'), 'utf-8');
    expect(raw).toContain('linearProjectUrl: "https://linear.app/team/project#section-$1"');
  });
});
