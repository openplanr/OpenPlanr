import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LinearMappingTableRow, OpenPlanrConfig } from '../src/models/types.js';
import {
  collectLinearMappingTable,
  formatLinearMappingTable,
} from '../src/services/linear-mapping-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

describe('formatLinearMappingTable', () => {
  it('renders column headers and rows', () => {
    const rows: LinearMappingTableRow[] = [
      {
        kind: 'epic',
        openPlanrId: 'EPIC-001',
        linearIdentifier: 'my-proj',
        linearUrl: 'https://linear.app/p/1',
        lastKnownState: '—',
      },
      {
        kind: 'feature',
        openPlanrId: 'FEAT-001',
        linearIdentifier: 'ENG-12',
        linearUrl: 'https://linear.app/i/1',
        lastKnownState: 'in-progress',
        note: 'stale-id (value does not look like a Linear issue id; re-run `planr linear push`)',
      },
    ];
    const out = formatLinearMappingTable(rows);
    expect(out).toContain('EPIC-001');
    expect(out).toContain('FEAT-001');
    expect(out).toContain('OpenPlanr id');
    expect(out).toContain('stale-id');
  });

  it('prints full URLs without ellipsis truncation (copy-paste needs exact URL)', async () => {
    const longUrl =
      'https://linear.app/moduluniversity/issue/MUV-18/muvi-notification-preferences-per-user-toggles-digest-mode-quiet-hours';
    const rows: LinearMappingTableRow[] = [
      {
        kind: 'quick',
        openPlanrId: 'QT-001',
        linearIdentifier: 'MUV-18',
        linearUrl: longUrl,
        lastKnownState: 'pending',
      },
    ];
    const out = formatLinearMappingTable(rows);
    expect(out).toContain(longUrl);
    expect(out).not.toContain('…'); // no ellipsis anywhere — URL fits or overflows, never truncated
  });
});

// ---------------------------------------------------------------------------
// Strategy-aware epic rows (Gap B) — after a milestone-of / label-on push,
// the identifier column must be meaningful, not `(no identifier)`.
// ---------------------------------------------------------------------------

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'mapping-table-test',
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
}

describe('collectLinearMappingTable — strategy-aware epic rows', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'planr-mapping-'));
    config = baseConfig();
    await ensureDir(join(projectDir, '.planr', 'epics'));
    await ensureDir(join(projectDir, '.planr', 'features'));
    await ensureDir(join(projectDir, '.planr', 'stories'));
    await ensureDir(join(projectDir, '.planr', 'tasks'));
    await ensureDir(join(projectDir, '.planr', 'quick'));
    await ensureDir(join(projectDir, '.planr', 'backlog'));
    await writeFile(join(projectDir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('milestone-of epic shows `milestone:<id-prefix>` and the project URL', async () => {
    const fm = [
      'id: "EPIC-001"',
      'title: "Epic One"',
      'linearProjectId: "proj-uuid"',
      'linearMappingStrategy: "milestone-of"',
      'linearMilestoneId: "9b2f4c3e-1234-4abc-89de-0123456789ab"',
      'linearProjectUrl: "https://linear.app/team/project/muvi"',
    ].join('\n');
    await writeFile(
      join(projectDir, '.planr', 'epics', 'EPIC-001-test.md'),
      `---\n${fm}\n---\n\n# EPIC-001\n`,
    );
    const rows = await collectLinearMappingTable(projectDir, config, 'EPIC-001');
    const epicRow = rows.find((r) => r.kind === 'epic');
    expect(epicRow?.linearIdentifier).toMatch(/^milestone:/);
    expect(epicRow?.linearIdentifier).not.toContain('no identifier');
    expect(epicRow?.linearUrl).toContain('linear.app');
  });

  it('label-on epic shows `label:<id-prefix>`', async () => {
    const fm = [
      'id: "EPIC-001"',
      'title: "Epic One"',
      'linearProjectId: "proj-uuid"',
      'linearMappingStrategy: "label-on"',
      'linearLabelId: "label-uuid-abc123"',
      'linearProjectUrl: "https://linear.app/team/project/muvi"',
    ].join('\n');
    await writeFile(
      join(projectDir, '.planr', 'epics', 'EPIC-001-test.md'),
      `---\n${fm}\n---\n\n# EPIC-001\n`,
    );
    const rows = await collectLinearMappingTable(projectDir, config, 'EPIC-001');
    const epicRow = rows.find((r) => r.kind === 'epic');
    expect(epicRow?.linearIdentifier).toMatch(/^label:/);
  });

  it('project strategy still shows the project identifier', async () => {
    const fm = [
      'id: "EPIC-001"',
      'title: "Epic One"',
      'linearProjectId: "proj-uuid"',
      'linearMappingStrategy: "project"',
      'linearProjectIdentifier: "epic-one-slug"',
      'linearProjectUrl: "https://linear.app/team/project/x"',
    ].join('\n');
    await writeFile(
      join(projectDir, '.planr', 'epics', 'EPIC-001-test.md'),
      `---\n${fm}\n---\n\n# EPIC-001\n`,
    );
    const rows = await collectLinearMappingTable(projectDir, config, 'EPIC-001');
    const epicRow = rows.find((r) => r.kind === 'epic');
    expect(epicRow?.linearIdentifier).toBe('epic-one-slug');
  });

  it('unpushed epic shows `(not pushed)` regardless of strategy', async () => {
    const fm = ['id: "EPIC-001"', 'title: "Epic One"'].join('\n');
    await writeFile(
      join(projectDir, '.planr', 'epics', 'EPIC-001-test.md'),
      `---\n${fm}\n---\n\n# EPIC-001\n`,
    );
    const rows = await collectLinearMappingTable(projectDir, config, 'EPIC-001');
    expect(rows[0]?.linearIdentifier).toBe('(not pushed)');
  });

  it('scope=EPIC-X lists any linked QT/BL alongside the epic row', async () => {
    await writeFile(
      join(projectDir, '.planr', 'epics', 'EPIC-001-test.md'),
      `---\nid: "EPIC-001"\ntitle: "Epic One"\nlinearProjectId: "p"\nlinearMappingStrategy: "milestone-of"\nlinearMilestoneId: "m"\n---\n`,
    );
    await writeFile(
      join(projectDir, '.planr', 'quick', 'QT-100-test.md'),
      `---\nid: "QT-100"\ntitle: "Quick"\nstatus: "pending"\nepicId: "EPIC-001"\nlinearIssueId: "9b2f4c3e-1234-4abc-89de-0123456789ab"\nlinearIssueIdentifier: "ENG-8"\nlinearIssueUrl: "https://linear.app/i/8"\n---\n`,
    );
    await writeFile(
      join(projectDir, '.planr', 'backlog', 'BL-100-test.md'),
      `---\nid: "BL-100"\ntitle: "Bl"\npriority: "medium"\nstatus: "open"\nepicId: "EPIC-001"\n---\n`,
    );
    const rows = await collectLinearMappingTable(projectDir, config, 'EPIC-001');
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain('quick');
    expect(kinds).toContain('backlog');
    const qtRow = rows.find((r) => r.kind === 'quick');
    expect(qtRow?.linearIdentifier).toBe('ENG-8');
  });
});
