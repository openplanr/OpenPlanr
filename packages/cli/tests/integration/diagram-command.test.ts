import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const fixture = fileURLToPath(
  new URL(
    '../../../artifact/fixtures/diagram/grammars/flowchart.planr-diagram.json',
    import.meta.url,
  ),
);
const temporaryRoots: string[] = [];

function temporary(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'openplanr-diagram-command-'));
  temporaryRoots.push(value);
  return value;
}

function run(projectDir: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('planr diagram public machine surface', () => {
  it('exposes all five operations and the complete searchable gallery', () => {
    const project = temporary();
    const help = run(project, ['diagram', '--help']);
    expect(help.status, help.stderr).toBe(0);
    for (const command of ['render', 'inspect', 'check', 'gallery', 'rerender']) {
      expect(help.stdout).toMatch(new RegExp(`^  ${command}(?: |$)`, 'mu'));
    }

    const gallery = run(project, ['diagram', 'gallery', '--json']);
    expect(gallery.status, gallery.stderr).toBe(0);
    expect(JSON.parse(gallery.stdout)).toMatchObject({
      ok: true,
      action: 'diagram.gallery',
      status: 'passed',
      count: 39,
    });
  });

  it('renders, inspects, and checks one offline set with exact paths', () => {
    const project = temporary();
    const input = path.join(project, 'flowchart.planr-diagram.json');
    writeFileSync(input, readFileSync(fixture));
    const rendered = run(project, ['diagram', 'render', input, '--output', '.', '--json']);
    expect(rendered.status, rendered.stderr).toBe(0);
    const value = JSON.parse(rendered.stdout);
    expect(value).toMatchObject({
      ok: true,
      action: 'diagram.rendered',
      status: 'created',
      diagramId: 'flowchart-fixture',
      validation: { status: 'passed', changes: [] },
      editability: { source: 'canonical-ir' },
    });
    expect(value.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: path.join(project, 'diagrams/flowchart-fixture/flowchart-fixture.svg'),
        }),
        expect.objectContaining({
          path: path.join(project, 'diagrams/flowchart-fixture/flowchart-fixture.png'),
        }),
        expect.objectContaining({
          path: path.join(project, 'diagrams/flowchart-fixture/flowchart-fixture.html'),
        }),
      ]),
    );
    expect(value.nextAction).toContain('planr artifact');
    expect(value.nextAction).toContain('flowchart-fixture.manifest.json');
    expect(value.nextAction).not.toContain('flowchart-fixture.html');

    for (const operation of ['inspect', 'check']) {
      const result = run(project, ['diagram', operation, value.manifest.path, '--json']);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        action: `diagram.${operation === 'check' ? 'checked' : 'inspected'}`,
        validation: { status: 'passed', changes: [] },
      });
    }
  });

  it('canonicalizes a digestless agent-authored draft without package discovery', () => {
    const project = temporary();
    const input = path.join(project, 'draft.planr-diagram.json');
    const draft = JSON.parse(readFileSync(fixture, 'utf8'));
    delete draft.documentDigest;
    draft.diagramId = 'agent-authored-draft';
    writeFileSync(input, `${JSON.stringify(draft, null, 2)}\n`);

    const rendered = run(project, ['diagram', 'render', input, '--output', '.', '--json']);

    expect(rendered.status, rendered.stderr).toBe(0);
    expect(JSON.parse(rendered.stdout)).toMatchObject({
      ok: true,
      action: 'diagram.rendered',
      status: 'created',
      diagramId: 'agent-authored-draft',
    });
  });

  it('returns the exact invalid field in bounded schema diagnostics', () => {
    const project = temporary();
    const input = path.join(project, 'invalid.planr-diagram.json');
    const draft = JSON.parse(readFileSync(fixture, 'utf8'));
    delete draft.documentDigest;
    draft.highlight = { targetId: 'item-a' };
    writeFileSync(input, `${JSON.stringify(draft, null, 2)}\n`);

    const result = run(project, ['diagram', 'render', input, '--output', '.', '--json']);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'E_DIAGRAM_SCHEMA_INVALID',
      problem: 'Diagram document does not satisfy Protocol 1.6.',
      diagnostics: [
        { path: '$', rule: 'additionalProperties', detail: "unknown property 'highlight'" },
      ],
    });
  });

  it('returns one bounded JSON failure when generated bytes drift', () => {
    const project = temporary();
    const input = path.join(project, 'flowchart.planr-diagram.json');
    writeFileSync(input, readFileSync(fixture));
    const rendered = JSON.parse(
      run(project, ['diagram', 'render', input, '--output', '.', '--json']).stdout,
    );
    const svg = path.join(project, `diagrams/${rendered.diagramId}/${rendered.diagramId}.svg`);
    writeFileSync(svg, '<svg>changed</svg>\n');
    const result = run(project, ['diagram', 'check', rendered.manifest.path, '--json']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'E_DIAGRAM_OUTPUT_CONFLICT',
      problem: 'Diagram files differ from their manifest.',
    });
  });
});
