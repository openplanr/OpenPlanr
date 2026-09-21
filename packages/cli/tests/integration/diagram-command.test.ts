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
const swimlaneFixture = fileURLToPath(
  new URL(
    '../../../artifact/fixtures/diagram/grammars/swimlane.planr-diagram.json',
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
    expect(value.quality).toMatchObject({ status: 'pass', failedChecks: [], warningChecks: [] });

    for (const operation of ['inspect', 'check']) {
      const result = run(project, ['diagram', operation, value.manifest.path, '--json']);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        action: `diagram.${operation === 'check' ? 'checked' : 'inspected'}`,
        validation: { status: 'passed', changes: [] },
        quality: { status: 'pass', failedChecks: [], warningChecks: [] },
      });
    }
  });

  it('renders lane grammars as bands and passes their quality checks', () => {
    const project = temporary();
    const input = path.join(project, 'swimlane.planr-diagram.json');
    writeFileSync(input, readFileSync(swimlaneFixture));

    const rendered = run(project, ['diagram', 'render', input, '--output', '.', '--json']);

    expect(rendered.status, rendered.stderr).toBe(0);
    const value = JSON.parse(rendered.stdout);
    expect(value).toMatchObject({ ok: true, action: 'diagram.rendered' });
    expect(value.quality).toMatchObject({ status: 'pass', failedChecks: [] });
    expect(value.nextAction).toContain('planr artifact');
    const svg = readFileSync(
      value.artifacts.find((artifact: { path: string }) => artifact.path.endsWith('.svg')).path,
      'utf8',
    );
    expect(svg).toContain('data-lane-id="lane-main"');
    expect(svg).toContain('Primary lane');
  });

  it('surfaces an invalid quality report in the envelope and withholds the handover action', () => {
    const project = temporary();
    const input = path.join(project, 'flowchart-fixture.planr-diagram.json');
    writeFileSync(input, readFileSync(fixture));
    const rendered = run(project, ['diagram', 'render', input, '--output', '.', '--json']);
    expect(rendered.status, rendered.stderr).toBe(0);
    const manifest = JSON.parse(rendered.stdout).manifest.path;
    const report = path.join(project, 'diagrams/flowchart-fixture/flowchart-fixture.quality.json');
    writeFileSync(
      report,
      JSON.stringify({
        status: 'invalid',
        checks: [
          {
            id: 'semantic-coverage',
            status: 'fail',
            message: '1 semantic element was not rendered: lane-main.',
          },
        ],
      }),
    );

    const inspected = run(project, ['diagram', 'inspect', manifest, '--json']);

    expect(inspected.status, inspected.stderr).toBe(0);
    const value = JSON.parse(inspected.stdout);
    expect(value.ok).toBe(true);
    expect(value.quality).toEqual({
      status: 'invalid',
      failedChecks: ['semantic-coverage'],
      warningChecks: [],
    });
    expect(value.warnings.join('\n')).toContain('Quality fail semantic-coverage');
    expect(value.nextAction).toBeNull();
  });

  it('reports an unusable quality report as a warning instead of a summary or a crash', () => {
    const project = temporary();
    const input = path.join(project, 'flowchart-fixture.planr-diagram.json');
    writeFileSync(input, readFileSync(fixture));
    const rendered = run(project, ['diagram', 'render', input, '--output', '.', '--json']);
    expect(rendered.status, rendered.stderr).toBe(0);
    const manifest = JSON.parse(rendered.stdout).manifest.path;
    const report = path.join(project, 'diagrams/flowchart-fixture/flowchart-fixture.quality.json');

    // `check` and `rerender` are not exercised here: rewriting the report breaks manifest
    // custody, which they report first and for their own reasons.
    for (const [detail, content] of [
      ['truncated', '{"status":"pass"'],
      ['unknown status', '{"status":"degraded","checks":[]}'],
    ]) {
      writeFileSync(report, content);
      const inspected = run(project, ['diagram', 'inspect', manifest, '--json']);

      expect(inspected.status, `${detail}: ${inspected.stderr}`).toBe(0);
      const value = JSON.parse(inspected.stdout);
      expect(value.ok).toBe(true);
      expect(value.quality).toBeUndefined();
      expect(value.warnings.join('\n')).toContain('Quality report is unusable');
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
