// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../../../apps/dashboard/src/app/App.js';
import {
  GovernedButton,
  StatePanel,
} from '../../../../apps/dashboard/src/design-system/components/index.js';
import { renderDashboardComponent } from '../../../../apps/dashboard/src/test/component-harness.js';

const enabledContract = {
  children: 'Run exact action',
  onInvoke: () => undefined,
} satisfies Parameters<typeof GovernedButton>[0];

const missingInvocationContract: Parameters<typeof GovernedButton>[0] = {
  children: 'Missing invocation',
};

const nativeEscapeContract: Parameters<typeof GovernedButton>[0] = {
  ...enabledContract,
  // @ts-expect-error Governed controls never accept native form submission.
  type: 'submit',
};

const nativeEventEscapeContract: Parameters<typeof GovernedButton>[0] = {
  ...enabledContract,
  // @ts-expect-error Governed controls never accept alternate activation handlers.
  onDoubleClick: () => undefined,
};

void missingInvocationContract;
void nativeEscapeContract;
void nativeEventEscapeContract;

const testRoot = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(testRoot, '../../../../apps/dashboard/src');
const tokens = readFileSync(resolve(dashboardRoot, 'design-system/tokens.css'), 'utf8');
const typography = readFileSync(resolve(dashboardRoot, 'design-system/typography.css'), 'utf8');
const shell = readFileSync(resolve(dashboardRoot, 'features/shell/unified-shell.css'), 'utf8');
const consoleShell = readFileSync(
  resolve(dashboardRoot, 'features/shell/console-shell.css'),
  'utf8',
);

const APPROVED_COLORS = new Set([
  '#f6f3ec',
  '#fcfbf8',
  '#1b1815',
  '#726960',
  '#d9d2c7',
  '#5c750c',
  '#f0fbce',
  '#1d6152',
  '#94600a',
  '#9c2c15',
  '#221f1b',
  '#ffffff',
  '#141210',
  '#b9afa3',
  '#3a342f',
  '#bce633',
  '#2a2622',
  '#8fcfbb',
  '#f5c563',
  '#f4a392',
  '#0e0c0b',
]);

function colors(source: string) {
  return [...source.matchAll(/#[\da-f]{6}\b/giu)].map((match) => match[0].toLowerCase());
}

describe('OpenPlanr design system', () => {
  it('owns the approved light and dark palette without introducing a generic theme', () => {
    expect(new Set(colors(tokens))).toEqual(APPROVED_COLORS);
    expect(colors(shell)).toEqual([]);
    expect(tokens).toContain(':root[data-theme="dark"]');
    expect(tokens).toContain(':root:not([data-theme="light"])');
    expect(tokens).toContain(':root[data-contrast="high"]');
    expect(tokens).toContain('@media (forced-colors: active)');
  });

  it('is the local Tailwind v4 source entry and replaces its generic theme with OpenPlanr semantics', () => {
    expect(tokens.startsWith('@import "tailwindcss";')).toBe(true);
    expect(tokens).toContain('@theme inline');
    expect(tokens).toContain('--color-*: initial;');
    expect(tokens).toContain('--color-primary: var(--op-control);');
    expect(tokens).toContain('--radius-*: initial;');
    expect(tokens).not.toMatch(/https?:|url\(/u);
  });

  it('defines semantic color, type, spacing, elevation, radius, density, motion, and focus tokens', () => {
    for (const contract of [
      '--op-canvas:',
      '--op-font-display:',
      '--op-space-1:',
      '--op-elevation-sheet:',
      '--op-radius-control:',
      '--op-density-control:',
      '--op-density-row-block:',
      '--op-density-surface-block:',
      '--op-density-layout-gap:',
      '--op-motion-duration:',
      '--op-focus-width:',
    ])
      expect(`${tokens}\n${typography}`).toContain(contract);
    expect(typography).not.toMatch(/https?:|@font-face|url\(/u);
    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)');
    expect(tokens).toContain(':root[data-density="compact"]');
    expect(tokens).toContain('--op-density-control: 44px');
    expect(tokens).toMatch(
      /:root\[data-density="compact"\][\s\S]*--op-density-row-block: var\(--op-space-2\);/u,
    );
    expect(tokens.indexOf('@media (prefers-color-scheme: dark)')).toBeLessThan(
      tokens.indexOf(':root[data-contrast="high"]'),
    );
  });

  it('makes the real shell consume semantic typography, spacing, radius, and state-signal tokens', () => {
    for (const role of ['display', 'page', 'section', 'body', 'control', 'eyebrow', 'technical'])
      expect(`${tokens}\n${typography}\n${shell}`).toContain(`--op-type-${role}-`);
    for (const token of [
      'font-sans',
      'text-primary',
      'surface-app',
      'gutter',
      'radius-sm',
      'text-inverse',
      'surface-inverse',
    ]) {
      expect(consoleShell).toContain(`var(--pc-${token})`);
    }
    expect(consoleShell).not.toMatch(/font-size:\s*\d/u);
    expect(consoleShell).not.toMatch(/border-radius:(?!\s*(?:var\(|50%|0))/u);
    expect(consoleShell).toContain('.pc-watcher__dot');
    expect(consoleShell).toContain('.pc-watcher__label');
  });

  it('renders every honest boot and first-use state with text beyond color', () => {
    for (const state of [
      'booting',
      'first-use',
      'ready-to-resume',
      'unavailable',
      'incompatible',
      'offline',
    ] as const) {
      const html = renderToStaticMarkup(
        <StatePanel state={state} eyebrow="State" title={`${state} title`} description="Reason" />,
      );
      expect(html).toContain(`data-state="${state}"`);
      expect(html).toContain(`${state} title`);
      expect(html).toContain('Reason');
    }
  });

  it('generates distinct state-panel heading relationships when callers do not own an id', () => {
    const html = renderToStaticMarkup(
      <>
        <StatePanel state="booting" eyebrow="One" title="First panel" description="First reason" />
        <StatePanel
          state="offline"
          eyebrow="Two"
          title="Second panel"
          description="Second reason"
        />
      </>,
    );
    const headingIds = [...html.matchAll(/<h2 id="([^"]+)"/gu)].map((match) => match[1]);
    const relationships = [...html.matchAll(/aria-labelledby="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(headingIds).toHaveLength(2);
    expect(new Set(headingIds).size).toBe(2);
    expect(relationships).toEqual(headingIds);
  });

  it('exposes a persistent disabled reason and never invokes a disabled governed action', async () => {
    const onInvoke = vi.fn();
    const harness = renderDashboardComponent(
      <GovernedButton disabled disabledReason="Exact approval is still required">
        Execute exact action
      </GovernedButton>,
    );
    try {
      const button = harness.result.getByRole('button', { name: 'Execute exact action' });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBeTruthy();
      expect(harness.result.getByText('Exact approval is still required')).toBeTruthy();
      await harness.user.click(button);
      expect(onInvoke).not.toHaveBeenCalled();
      expect((await harness.audit()).violations).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it('renders only a non-submitting button and drops alternate native activation channels', () => {
    const alternate = vi.fn();
    const onInvoke = vi.fn();
    const unsafeProps = {
      type: 'submit',
      formAction: '/foreign',
      onDoubleClick: alternate,
      onPointerDown: alternate,
      onInvoke,
    };
    const UnsafeGovernedButton = GovernedButton as unknown as (
      props: Record<string, unknown>,
    ) => ReactNode;
    const harness = renderDashboardComponent(
      createElement(
        UnsafeGovernedButton,
        unsafeProps,
        'Execute reviewed invocation',
      ) as ReactElement,
    );
    try {
      const button = harness.result.getByRole('button', { name: 'Execute reviewed invocation' });
      expect(button.getAttribute('type')).toBe('button');
      expect(button.hasAttribute('formaction')).toBe(false);
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(alternate).not.toHaveBeenCalled();
      expect(onInvoke).not.toHaveBeenCalled();
    } finally {
      harness.cleanup();
    }
  });

  it('locks a governed action synchronously while its supplied invocation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const onInvoke = vi.fn(() => pending);
    const harness = renderDashboardComponent(
      <GovernedButton onInvoke={onInvoke}>Create reviewed SPEC</GovernedButton>,
    );
    try {
      const button = harness.result.getByRole('button', { name: 'Create reviewed SPEC' });
      await Promise.all([harness.user.click(button), harness.user.click(button)]);
      expect(onInvoke).toHaveBeenCalledTimes(1);
      const pendingButton = harness.result.getByRole('button', {
        name: 'Waiting for durable acceptance',
      });
      expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
      expect(pendingButton.getAttribute('aria-busy')).toBe('true');
      release();
    } finally {
      harness.cleanup();
    }
  });

  it('keeps the real route-aware App stable while its first projection is loading', () => {
    const html = renderToStaticMarkup(
      <App
        buildId="design-system-test"
        initialHash="#/operate/today"
        connection={{ state: 'offline', label: 'Offline', reason: 'Loopback unavailable' }}
      />,
    );
    expect(html).toContain('data-route-kind="operate.today"');
    expect(html).toContain('Offline — the watcher is not reachable');
    expect(html).toContain('data-route-pending="booting"');
    expect(html).toContain('Loading Today');
    expect(html).not.toContain('Verifying this dashboard');
  });

  it('uses a readable semantic foreground for code surfaces in light and dark modes', () => {
    expect(tokens).toMatch(/:root\s*\{[\s\S]*--op-on-code: #f6f3ec;/u);
    expect(tokens).toMatch(/:root\[data-theme="dark"\][\s\S]*--op-on-code: var\(--op-ink\);/u);
    expect(consoleShell).toMatch(/\.pc-skip-link[\s\S]*color: var\(--pc-text-inverse\);/u);
    expect(tokens).toMatch(/\.op-governed-tooltip[\s\S]*color: var\(--op-on-code\);/u);
  });

  it('uses local assets, 44px controls, compact responsive states, and no browser authority', () => {
    const source = [
      tokens,
      typography,
      shell,
      readFileSync(resolve(dashboardRoot, 'design-system/components/governed-button.tsx'), 'utf8'),
      readFileSync(resolve(dashboardRoot, 'design-system/components/state-panel.tsx'), 'utf8'),
    ].join('\n');
    expect(source).not.toMatch(/https?:\/\/|@font-face|localStorage|sessionStorage|\bfetch\s*\(/u);
    expect(source).not.toMatch(
      /previewHash|actionReference|operate\.dispatch|start PLAN|start SHIP/u,
    );
    expect(tokens).toContain('@media (max-width: 640px)');
    expect(tokens).toContain('grid-template-columns: 4px minmax(0, 1fr)');
    expect(shell).not.toMatch(/--op-(?:indigo|teal|amber|coral)/u);
    expect(colors(shell)).toEqual([]);
  });
});
