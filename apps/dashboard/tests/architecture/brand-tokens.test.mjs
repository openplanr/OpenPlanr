import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  contrast,
  palettes,
  rgb,
  statuses,
  surfaces,
  tint,
  tintRatios,
  types,
} from '../helpers/brand-contract.mjs';

const source = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const tokens = source('design-system/tokens.css');
const consoleTokens = source('design-system/planr-console-tokens.css');
const typography = source('design-system/typography.css');
const declarations = (css) =>
  Object.fromEntries(
    [...css.matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]),
  );
const dark = declarations(
  tokens.slice(tokens.indexOf(':root {'), tokens.indexOf(':root[data-theme="light"]')),
);
const lightBlock = tokens.slice(
  tokens.indexOf(':root[data-theme="light"]'),
  tokens.indexOf('@media (prefers-color-scheme: light)'),
);
const light = { ...dark, ...declarations(lightBlock) };
const aliases = {
  ...declarations(consoleTokens),
  ...declarations(typography.slice(0, typography.indexOf('html {'))),
};

function resolve(name, theme, visited = new Set()) {
  assert(!visited.has(name), `Circular token: ${name}`);
  visited.add(name);
  const value = { ...(theme === 'dark' ? dark : light), ...aliases }[name];
  assert(value, `Missing token: ${name}`);
  return value.replace(/var\((--[\w-]+)\)/gu, (_, alias) =>
    resolve(alias, theme, new Set(visited)),
  );
}

for (const theme of ['dark', 'light']) {
  test(`${theme} exposes exact brand colors through both token APIs`, () => {
    for (const [name, value] of Object.entries(palettes[theme])) {
      for (const namespace of ['op', 'pc'])
        assert.equal(resolve(`--${namespace}-${name}`, theme), value);
    }
    for (const [alias, canonical] of Object.entries({
      'op-canvas': 'bg',
      'op-surface': 'panel',
      'op-ink': 'text',
      'op-control': 'accent',
      'op-on-control': 'on-accent',
      'pc-surface-app': 'bg',
      'pc-surface-raised': 'raised',
      'pc-text-primary': 'text',
      'pc-text-secondary': 'body',
      'pc-text-tertiary': 'dim',
      'pc-type-story': 'type-us',
      'pc-type-task': 'type-t',
      'pc-type-backlog': 'type-bl',
    }))
      assert.equal(resolve(`--${alias}`, theme), palettes[theme][canonical]);
  });

  test(`${theme} small text and interactive boundaries meet contrast on every base`, () => {
    for (const base of surfaces) {
      for (const foreground of [
        'text',
        'heading',
        'body',
        'muted',
        'dim',
        'accent',
        'info',
        'danger',
        'warning',
        'addressed',
        ...types.map((kind) => `type-${kind}`),
      ]) {
        assert(
          contrast(rgb(palettes[theme][foreground]), rgb(palettes[theme][base])) >= 4.5,
          `${foreground} on ${base}`,
        );
      }
      const border = rgb(resolve('--pc-border-strong', theme));
      assert(contrast(border, rgb(palettes[theme][base])) >= 3, `control border on ${base}`);
    }
    assert(contrast(rgb(palettes[theme]['on-accent']), rgb(palettes[theme].accent)) >= 4.5);
  });

  test(`${theme} opaque chip tokens reproduce all 56 documented tint ratios`, () => {
    const chips = [
      ...types.map((kind) => [`type-${kind}`, `type-${kind}`]),
      ...Object.entries(statuses).map(([status, foreground]) => [`status-${status}`, foreground]),
    ];
    chips.forEach(([chip, foreground], row) => {
      surfaces.forEach((base, column) => {
        const fg = rgb(palettes[theme][foreground]);
        const bg = rgb(palettes[theme][base]);
        for (const namespace of ['op', 'pc']) {
          assert.equal(
            resolve(`--${namespace}-${chip}-bg-${base}`, theme),
            `color-mix(in srgb, ${palettes[theme][foreground]} 8%, ${palettes[theme][base]} 92%)`,
          );
          assert.equal(
            resolve(`--${namespace}-${chip}-bg`, theme),
            resolve(`--${namespace}-${chip}-bg-panel`, theme),
          );
        }
        const ratio = contrast(fg, tint(fg, bg));
        assert(ratio >= 4.5, `${chip} on ${base}: ${ratio}`);
        assert.equal(Number(ratio.toFixed(4)), tintRatios[theme][row][column]);
      });
    });
  });
}

test('plain contrast corrections retain their recomputed ratios', () => {
  for (const [theme, fg, bg, expected] of [
    ['light', 'accent', 'accent-soft', 5.2498],
    ['light', 'dim', 'raised', 5.1201],
    ['light', 'warning', 'raised', 5.1481],
    ['dark', 'line-strong', 'bg', 3.7595],
    ['dark', 'line-strong', 'raised', 3.2232],
  ])
    assert.equal(
      Number(contrast(rgb(palettes[theme][fg]), rgb(palettes[theme][bg])).toFixed(4)),
      expected,
    );
});

test('system light uses the same palette while the default stays dark', () => {
  assert.match(tokens, /:root \{\s*color-scheme: dark;/u);
  const system = tokens.slice(
    tokens.indexOf('@media (prefers-color-scheme: light)'),
    tokens.indexOf(':root[data-contrast="high"]'),
  );
  assert.match(system, /:root\[data-theme="system"\]/u);
  assert.deepEqual(declarations(system), declarations(lightBlock));
});

test('typography and geometry expose the brand scale and safe motion preferences', () => {
  for (const [name, value] of Object.entries({
    'type-display-size': '40px',
    'type-display-leading': '1.05',
    'type-display-weight': '800',
    'type-page-size': '28px',
    'type-page-weight': '700',
    'type-heading-size': '20px',
    'type-section-size': '16px',
    'type-body-size': '14px',
    'type-body-weight': '400',
    'type-control-size': '13px',
    'type-technical-size': '12px',
    'type-technical-weight': '500',
    'radius-tag': '6px',
    'radius-control': '8px',
    'radius-surface': '12px',
    'radius-sheet': '16px',
    'motion-duration': '120ms',
    'motion-panel-duration': '200ms',
    'motion-live-duration': '1600ms',
  }))
    assert.equal(resolve(`--op-${name}`, 'dark'), value);
  assert.match(typography, /font-optical-sizing: auto;/u);
  assert.match(typography, /font-variant-numeric: tabular-nums;/u);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(tokens, /--op-motion-panel-distance: 0px;/u);
  assert.match(tokens, /@media \(forced-colors: active\) \{\s*:root,\s*:root\[data-theme\]/u);
  assert.match(consoleTokens, /--pc-text-2xs: 12px;/u);
  assert.match(tokens, /:root\[data-density="compact"\]/u);
  for (const [name, value] of Object.entries({
    'density-row-block': 'var(--op-space-2)',
    'density-surface-block': 'var(--op-space-4)',
    'density-layout-gap': 'var(--op-space-5)',
  })) {
    const compact = tokens.slice(
      tokens.indexOf('@media (min-width: 801px)'),
      tokens.indexOf(':root[data-theme="light"]'),
    );
    assert.equal(declarations(compact)[`--op-${name}`], value);
  }
});

test('saved themes apply synchronously in the head, including an explicit system choice', () => {
  const html = source('index.html');
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert(script);
  assert(html.indexOf('<script>') < html.indexOf('</head>'));
  for (const stored of [null, 'dark', 'light', 'system', 'invalid']) {
    const attributes = new Map();
    vm.runInNewContext(script, {
      document: { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } },
      localStorage: {
        getItem: (key) => {
          assert.equal(key, 'op-theme');
          return stored;
        },
      },
    });
    assert.equal(
      attributes.get('data-theme'),
      ['light', 'system'].includes(stored) ? stored : 'dark',
    );
  }
  const attributes = new Map();
  vm.runInNewContext(script, {
    document: { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } },
    localStorage: {
      getItem: () => {
        throw new Error('Storage denied');
      },
    },
  });
  assert.equal(attributes.get('data-theme'), 'dark');
  assert.equal(attributes.get('data-theme-storage-error'), 'unavailable');
});
