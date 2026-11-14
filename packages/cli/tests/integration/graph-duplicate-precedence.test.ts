import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPlanningModel as readPipelineModel } from '../../../pipeline/lib/dashboard/graph-reader.mjs';
import { readPlanningModel as readCliModel } from '../../src/services/graph-service.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'planr-graph-duplicates-'));
  roots.push(root);
  for (const [source, title] of Object.entries(files)) {
    const file = join(root, source);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\nid: SPEC-027\ntitle: ${title}\n---\n# ${title}\n`);
  }
  return root;
}

const cases: Array<{
  name: string;
  files: Record<string, string>;
  kept: string;
  skipped: string[];
}> = [
  {
    name: 'an id-named file beats a copy that sorts first',
    files: {
      'specs/SPEC-027-redesign/AAA-copy.md': 'Copy',
      'specs/SPEC-027-redesign/SPEC-027-redesign.md': 'Real',
    },
    kept: 'Real',
    skipped: ['specs/SPEC-027-redesign/AAA-copy.md'],
  },
  {
    name: 'an id-named file beats a later slug-named report',
    files: {
      'specs/SPEC-027-redesign/SPEC-027-redesign.md': 'Real',
      'specs/SPEC-027-redesign/qa-report.md': 'Report',
    },
    kept: 'Real',
    skipped: ['specs/SPEC-027-redesign/qa-report.md'],
  },
  {
    name: 'without an id-named file the lexically smallest path wins',
    files: {
      'specs/SPEC-027-redesign/notes.md': 'Notes',
      'specs/SPEC-027-redesign/brief.md': 'Brief',
    },
    kept: 'Brief',
    skipped: ['specs/SPEC-027-redesign/notes.md'],
  },
];

describe.each([
  ['CLI graph service', readCliModel],
  ['pipeline graph reader', readPipelineModel],
])('%s duplicate id precedence', (_reader, read) => {
  it.each(cases)('$name', ({ files, kept, skipped }) => {
    const model = read(project(files));
    expect(model.graph.nodes.map((node) => [node.id, node.title])).toEqual([['SPEC-027', kept]]);
    expect(
      model.diagnostics
        .filter((diagnostic) => diagnostic.reason === 'duplicate-identity')
        .map((diagnostic) => diagnostic.sourcePath),
    ).toEqual(skipped);
  });
});
