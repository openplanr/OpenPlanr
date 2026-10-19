// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatibilityPage } from '../../../../apps/dashboard/src/features/diagnostics/CompatibilityPage.js';
import {
  DataHealth,
  type ReadDiagnostic,
} from '../../../../apps/dashboard/src/features/diagnostics/DataHealth.js';
import { SupportSummary } from '../../../../apps/dashboard/src/features/diagnostics/SupportSummary.js';
import type { DashboardBootstrap } from '../../../../apps/dashboard/src/lib/api/bootstrap.js';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Missing test fixture');
  return value;
}

const findings: readonly ReadDiagnostic[] = (
  [
    ['missing-reference', 'dependsOn'],
    ['ambiguous-reference', 'taskIds'],
    ['duplicate-identity', 'id'],
    ['dependency-cycle', 'dependsOn'],
    ['containment-cycle', 'parent'],
    ['invalid-date', 'startDate'],
    ['missing-date', 'endDate'],
    ['closed-before-start', 'closedAt'],
    ['end-before-start', 'endDate'],
  ] as const
).map(([reason, field], index) => ({
  nodeId:
    index < 5
      ? `SPEC-014/T-${String(index + 1).padStart(3, '0')}`
      : `SPRINT-${String(index).padStart(3, '0')}`,
  sourcePath: `.planr/${index < 5 ? 'specs/trace/tasks' : 'sprints'}/finding-${index}.md`,
  field,
  reason,
  classification: 'source-data',
}));

const reasonLabels = [
  'Unresolved reference',
  'Ambiguous reference',
  'Duplicate identity',
  'Dependency cycle',
  'Containment cycle',
  'Invalid authored date',
  'Missing authored date',
  'Closed before start',
  'End before start',
];

const bootstrap: DashboardBootstrap = {
  kind: 'dashboard-bootstrap',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  ui: {
    buildId: 'diagnostics-served',
    expectedBuildId: 'diagnostics-served',
    assetManifestHash: `sha256:${'a'.repeat(64)}`,
  },
  server: { packageVersion: '1.25.3' },
  capabilities: {
    planningGraph: { schemaVersion: '1.0.0' },
    operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
    operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: true },
    diagnostics: { schemaVersion: '1.0.0', available: true },
  },
  project: {
    projectId: `sha256:${'b'.repeat(64)}`,
    name: 'reference-test',
    branch: 'main',
    products: ['planning', 'operate'],
  },
  queryRoots: { planning: null, operate: null },
  origin: 'http://127.0.0.1:7473',
  compatibility: { status: 'compatible', reasonCodes: [] },
};

describe.each(['dark', 'light'])('Data health in %s theme', (theme) => {
  it('retains every observed finding with a safe source, field and canonical item link', () => {
    document.documentElement.dataset.theme = theme;
    render(<DataHealth read={{ diagnostics: findings }} />);

    const rows = within(screen.getByRole('list', { name: 'Data health findings' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(findings.length);
    expect(screen.getByRole('status').textContent).toBe('9 of 9 findings');
    for (const [index, finding] of findings.entries()) {
      const row = within(required(rows[index]));
      expect(row.getByText(required(reasonLabels[index]))).not.toBeNull();
      expect(row.getByText(finding.sourcePath)).not.toBeNull();
      expect(row.getByText(finding.field)).not.toBeNull();
      expect(row.getByRole('link', { name: finding.nodeId }).getAttribute('href')).toBe(
        `#/detail/${encodeURIComponent(finding.nodeId)}`,
      );
      expect(row.getByText(/Inspect the/).textContent).toMatch(/source|authored/);
    }
    expect(
      screen.getByText(/Inspection is read-only and does not repair authored files/),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: /repair|apply|execute/i })).toBeNull();
  });

  it('intersects category and query filters and restores all findings after an empty match', async () => {
    document.documentElement.dataset.theme = theme;
    const user = userEvent.setup();
    render(<DataHealth read={{ diagnostics: findings }} />);
    const category = screen.getByRole('combobox', { name: /^Data health category:/u });
    const query = screen.getByRole('textbox', { name: 'Filter data health' });

    for (const [label, count] of [
      ['References', 2],
      ['Identities', 1],
      ['Cycles', 2],
      ['Sprint dates', 4],
    ] as const) {
      await user.click(category);
      await user.click(screen.getByRole('option', { name: label, exact: true }));
      expect(screen.getByRole('status').textContent).toBe(`${count} of 9 findings`);
      expect(screen.getAllByRole('listitem')).toHaveLength(count);
    }
    await user.type(query, 'CLOSEDAT');
    expect(screen.getByRole('status').textContent).toBe('1 of 9 findings');
    expect(screen.getByRole('link', { name: 'SPRINT-007' })).not.toBeNull();
    await user.clear(query);
    await user.type(query, 'specs/trace');
    expect(screen.getByText('No findings match these filters')).not.toBeNull();
    expect(screen.queryByText('No source findings reported')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect((query as HTMLInputElement).value).toBe('');
    expect(category.textContent).toContain('All findings');
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    await user.type(query, 'finding-2.md');
    expect(screen.getByRole('status').textContent).toBe('1 of 9 findings');
    expect(screen.getByText('Duplicate identity')).not.toBeNull();
  });
});

describe('Data health evidence boundaries', () => {
  it('distinguishes unavailable diagnostics from a successful read with no findings', () => {
    const view = render(<DataHealth />);
    expect(screen.getByText('Source diagnostics are unavailable')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Inspect planning items' }).getAttribute('href')).toBe(
      '#/list',
    );
    expect(screen.queryByText('No source findings reported')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    view.rerender(<DataHealth read={{ diagnostics: [] }} />);
    expect(screen.getByText('No source findings reported')).not.toBeNull();
    expect(
      screen.getByText(/This is an observation of this read, not a source repair/),
    ).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('0 of 0 findings');
    expect(screen.queryByText('Source diagnostics are unavailable')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('does not render or search absolute paths, traversal, unsafe fields or unsafe item identities', async () => {
    const user = userEvent.setup();
    const unsafeSources = [
      '/Users/owner/private/source.md',
      'C:\\private\\source.md',
      '../private/source.md',
      '.planr/../private/source.md',
      '.planr/%2e%2e/private/source.md',
      'file:///private/source.md',
    ];
    const unsafeIdentities = ['/Users/owner/private', '../private', 'SPEC-014/../private'];
    const unsafeField = '/Users/owner/private/field';
    const diagnostics = [
      ...unsafeSources.map((sourcePath) => ({
        ...required(findings[0]),
        sourcePath,
        field: unsafeField,
      })),
      ...unsafeIdentities.map((nodeId) => ({ ...required(findings[0]), nodeId })),
    ];
    const view = render(<DataHealth read={{ diagnostics }} />);
    for (const unsafe of [...unsafeSources, ...unsafeIdentities, unsafeField]) {
      expect(view.container.textContent).not.toContain(unsafe);
      expect(view.container.innerHTML).not.toContain(unsafe);
    }
    expect(screen.getAllByText('Repository-relative source unavailable')).toHaveLength(
      unsafeSources.length,
    );
    expect(screen.getAllByText('Item identity unavailable')).toHaveLength(unsafeIdentities.length);
    expect(screen.getAllByText('Authored field')).toHaveLength(unsafeSources.length);
    expect(screen.getAllByRole('listitem')).toHaveLength(diagnostics.length);
    expect(screen.getAllByRole('link')).toHaveLength(unsafeSources.length);

    const query = screen.getByRole('textbox', { name: 'Filter data health' });
    for (const hiddenEvidence of ['private/source', 'private/field', 'owner/private']) {
      await user.clear(query);
      await user.type(query, hiddenEvidence);
      expect(screen.getByText('No findings match these filters')).not.toBeNull();
      expect(screen.getByRole('status').textContent).toBe(`0 of ${diagnostics.length} findings`);
    }
  });

  it('retains filters, the focused finding and scroll when the read refreshes', async () => {
    const user = userEvent.setup();
    const view = render(<DataHealth read={{ diagnostics: findings }} />);
    await user.click(screen.getByRole('combobox', { name: /^Data health category:/u }));
    await user.click(screen.getByRole('option', { name: 'References', exact: true }));
    await user.type(screen.getByRole('textbox', { name: 'Filter data health' }), 'trace');
    const focused = screen.getByRole('link', { name: required(findings[0]).nodeId });
    focused.focus();
    const scroller = required(view.container.firstElementChild);
    scroller.scrollTop = 120;

    view.rerender(
      <DataHealth
        read={{
          diagnostics: [
            ...findings,
            { ...required(findings[0]), sourcePath: '.planr/specs/trace/tasks/new.md' },
          ],
        }}
      />,
    );

    expect(screen.getByRole('link', { name: required(findings[1]).nodeId })).not.toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(scroller.scrollTop).toBe(120);
    expect(
      (screen.getByRole('textbox', { name: 'Filter data health' }) as HTMLInputElement).value,
    ).toBe('trace');
    expect(screen.getByRole('combobox', { name: /^Data health category:/u }).textContent).toContain(
      'References',
    );
    expect(screen.getByRole('status').textContent).toBe('3 of 10 findings');
  });
});

describe('Diagnostics navigation', () => {
  it('uses roving keyboard tabs while retaining compatibility, recovery and support guidance', async () => {
    const user = userEvent.setup();
    const onReturn = vi.fn();
    render(
      <CompatibilityPage
        embeddedBuildId="diagnostics-served"
        bootstrap={bootstrap}
        bootPhase="compatible"
        bootDetail={null}
        connection={{ state: 'connected', label: 'Connected', reason: 'Validated connection' }}
        onReturn={onReturn}
        dataHealth={{ diagnostics: findings }}
      />,
    );
    const compatibility = screen.getByRole('tab', { name: 'Compatibility' });
    const health = screen.getByRole('tab', { name: /Data health/ });
    const recovery = screen.getByRole('tab', { name: 'Recovery' });
    const support = screen.getByRole('tab', { name: 'Support summary' });
    expect(screen.getByRole('tablist', { name: 'Diagnostics sections' })).not.toBeNull();
    expect(screen.getByText('Dashboard compatibility is certified')).not.toBeNull();
    compatibility.focus();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(document.activeElement).toBe(health));
    expect(compatibility.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    expect(health.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('list', { name: 'Data health findings' })).not.toBeNull();
    expect(document.getElementById(required(health.getAttribute('aria-controls')))?.hidden).toBe(
      false,
    );

    await user.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(recovery));
    expect(recovery.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('openplanr dashboard')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open governed Operate recovery' }).getAttribute('href'),
    ).toBe('#/operate/recovery');

    await user.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(support));
    await user.keyboard(' ');
    expect(support.getAttribute('aria-selected')).toBe('true');
    const bundle = screen.getByRole('textbox', {
      name: 'Support bundle text',
    }) as HTMLTextAreaElement;
    expect(bundle.readOnly).toBe(true);
    expect(bundle.value).toContain('Embedded dashboard build: diagnostics-served');
    expect(bundle.value).toContain('Planning graph schema: 1.0.0');
    expect(bundle.value).toContain('Project name: reference-test');

    await user.keyboard('{Home}');
    await waitFor(() => expect(document.activeElement).toBe(compatibility));
    await user.keyboard('{Enter}');
    expect(screen.getByText('Dashboard compatibility is certified')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Support bundle text' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Return to dashboard' }));
    expect(onReturn).toHaveBeenCalledOnce();
  });
});

describe('Support summary redaction', () => {
  it('redacts private paths from embedded and served builds while retaining public support fields', () => {
    const privatePath = '/Users/owner/private/dashboard-build';
    const view = render(
      <SupportSummary
        embeddedBuildId={privatePath}
        bootstrap={{
          ...bootstrap,
          ui: { ...bootstrap.ui, buildId: privatePath },
          project: { ...bootstrap.project, name: privatePath },
        }}
      />,
    );
    const bundle = screen.getByRole('textbox', {
      name: 'Support bundle text',
    }) as HTMLTextAreaElement;
    expect(bundle.value).not.toContain(privatePath);
    expect(view.container.innerHTML).not.toContain(privatePath);
    expect(bundle.value).toContain('Embedded dashboard build: Redacted');
    expect(bundle.value).toContain('Served dashboard build: Redacted');
    expect(bundle.value).toContain('Project name: Redacted');
    expect(bundle.value).toContain('Bootstrap protocol: 1.2.0');
    expect(bundle.value).toContain('Project branch: main');
  });
});
