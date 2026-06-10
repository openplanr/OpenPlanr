import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/cli/commands/status.js';
import { createDefaultConfig, saveConfig } from '../src/services/config-service.js';
import { collectDeliveryStatus } from '../src/services/delivery-status-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

let dir: string;
const config = createDefaultConfig('Test Project');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'planr-status-'));
  await saveConfig(dir, config);
  // A done spec (spec-driven mode)
  await ensureDir(join(dir, '.planr/specs/SPEC-001-alpha'));
  await writeFile(
    join(dir, '.planr/specs/SPEC-001-alpha/SPEC-001-alpha.md'),
    '---\nid: SPEC-001\ntitle: Alpha spec\nstatus: done\n---\n# Alpha\n',
  );
  // A done quick task linked to Linear
  await ensureDir(join(dir, '.planr/quick'));
  await writeFile(
    join(dir, '.planr/quick/QT-001-bar.md'),
    '---\nid: QT-001\ntitle: Bar task\nstatus: done\nlinearIssueIdentifier: MOD-114\ngithubIssue: 78\n---\n# Bar\n\n## Tasks\n\n- [x] 1.0 One\n- [x] 2.0 Two\n',
  );
  // An open backlog item (outstanding)
  await ensureDir(join(dir, '.planr/backlog'));
  await writeFile(
    join(dir, '.planr/backlog/BL-001-baz.md'),
    '---\nid: BL-001\ntitle: Baz item\nstatus: open\npriority: high\n---\n# Baz\n',
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('collectDeliveryStatus', () => {
  it('rolls up specs + quick + backlog in spec-driven mode (offline, no network)', async () => {
    const s = await collectDeliveryStatus(dir, config, {});
    expect(s.mode).toBe('spec-driven');
    expect(s.order).toEqual(expect.arrayContaining(['Specs', 'Backlog', 'Quick Tasks']));
    expect(s.groups.Specs.map((i) => i.id)).toContain('SPEC-001');
    expect(s.groups['Quick Tasks'][0].linear?.identifier).toBe('MOD-114');
    expect(s.groups['Quick Tasks'][0].progress).toEqual({ done: 2, total: 2 });
    expect(s.warnings).toEqual([]); // no --github/--linear → no network, no warnings
  });

  it('computes "done" semantics + outstanding correctly', async () => {
    const s = await collectDeliveryStatus(dir, config, {});
    const outstandingIds = s.outstanding.map((i) => i.id);
    expect(outstandingIds).toContain('BL-001'); // open backlog → outstanding
    expect(outstandingIds).not.toContain('SPEC-001'); // done spec
    expect(outstandingIds).not.toContain('QT-001'); // done quick
    const specSummary = s.summary.find((r) => r.label === 'Specs');
    expect(specSummary).toEqual({ label: 'Specs', done: 1, total: 1 });
  });

  it('scope filters to a single id', async () => {
    const s = await collectDeliveryStatus(dir, config, { scope: 'SPEC-001' });
    expect(s.groups.Specs.map((i) => i.id)).toEqual(['SPEC-001']);
    expect(s.groups['Quick Tasks']).toEqual([]); // filtered out
  });
});

describe('renderMarkdown', () => {
  it('produces a paste-ready delivery report with tables + outstanding section', async () => {
    const s = await collectDeliveryStatus(dir, config, {});
    const md = renderMarkdown(s);
    expect(md).toContain('# Test Project — Delivery Status');
    expect(md).toContain('## Summary');
    expect(md).toContain('| ID | Status | Title | Progress | PR | Linear |');
    expect(md).toContain('SPEC-001');
    expect(md).toContain('MOD-114');
    expect(md).toContain('## Outstanding work');
    expect(md).toContain('BL-001'); // the open item appears in Outstanding
  });
});
