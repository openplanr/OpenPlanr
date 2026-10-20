import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  contrast,
  palettes,
  rgb,
  statuses,
  surfaces,
  tint,
  tintRatios,
  types,
} from './brand-contract.mjs';

const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const commandArtboard = JSON.parse(
  readFileSync(
    resolve(dashboard, '../../packages/cli/tests/dashboard/fixtures/premium-artboard-records.json'),
    'utf8',
  ),
).artboards.Components;
export const brandGalleryStates = [
  'normal',
  'hover',
  'focus-visible',
  'active',
  'disabled',
  'loading',
  'empty',
  'error',
  'reduced-motion',
];
const fontFaces = [
  ...[400, 500, 600, 700, 800].map((weight) => ({
    family: 'Outfit',
    weight: String(weight),
    file: `@fontsource/outfit/files/outfit-latin-${weight}-normal.woff2`,
  })),
  ...[400, 500, 600].map((weight) => ({
    family: 'Source Code Pro',
    weight: String(weight),
    file: `@fontsource/source-code-pro/files/source-code-pro-latin-${weight}-normal.woff2`,
  })),
  {
    family: 'DM Sans Variable',
    weight: '100 1000',
    file: '@fontsource-variable/dm-sans/files/dm-sans-latin-standard-normal.woff2',
  },
];

export function brandGalleryStyles() {
  const css = [
    readFileSync(resolve(dashboard, '../../node_modules/tailwindcss/preflight.css'), 'utf8'),
    ...[
      'design-system/tokens.css',
      'design-system/typography.css',
      'design-system/planr-console-tokens.css',
      'design-system/components/planr-console.css',
      'design-system/components/artifact-row.css',
      'design-system/components/chip-menu.css',
      'design-system/components/governed-controls.css',
      'features/planning/list.css',
    ].map((path) =>
      readFileSync(resolve(dashboard, 'src', path), 'utf8').replace(/@import[^;]*;/gu, ''),
    ),
    ...fontFaces.map(({ family, weight, file }) => {
      const bytes = readFileSync(resolve(dashboard, '../../node_modules', file));
      return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2");font-display:block;}`;
    }),
  ].join('\n');
  // Keep forced states derived from the recipes so the fixture cannot hide style regressions.
  return css.replace(
    /:(hover|active|focus-visible|focus-within)\b/gu,
    (pseudo, state) => `:is(${pseudo},[data-fixture-${state}])`,
  );
}

export async function bundleBrandGalleryFixture() {
  const result = await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { BrandFixtureGallery } from './src/design-system/components/brand-fixture-gallery.tsx';
        import { ARTBOARD_FIXTURE_CLOCK, ARTBOARD_SOURCES, buildArtboardGraph } from '../../packages/cli/tests/dashboard/fixtures/premium-artboard-fixture.ts';
        let graph = buildArtboardGraph('brand-gallery');
        let currentState = document.documentElement.dataset.galleryState || 'normal';
        const NativeDate = Date;
        window.Date = class extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [ARTBOARD_FIXTURE_CLOCK])); }
          static now() { return NativeDate.parse(ARTBOARD_FIXTURE_CLOCK); }
        };
        const root = createRoot(document.getElementById('root'));
        function render(state) {
          currentState = state;
          flushSync(() => root.render(<BrandFixtureGallery state={state} graph={graph}
            sources={ARTBOARD_SOURCES} clock={ARTBOARD_FIXTURE_CLOCK} />));
          for (const element of document.querySelectorAll('[data-brand-gallery], [data-brand-gallery] *')) {
            for (const forced of ['hover','active','focus-visible','focus-within'])
              element.toggleAttribute('data-fixture-' + forced,
                state === forced || (state === 'focus-visible' && forced === 'focus-within'));
          }
          if (state === 'loading' || state === 'error') {
            const copy = document.querySelector('[data-gallery-recipe="command"] .pc-command-hint__copy');
            if (!copy) throw new Error('Gallery command recipe is missing its copy control.');
            queueMicrotask(() => copy.click());
          }
        }
        window.brandGalleryFixture = { setState: render,
          patchTitle: (id, title) => {
            if (!graph.nodes.some(node => node.id === id)) throw new Error('Cannot patch missing gallery node ' + id);
            graph = {...graph,nodes:graph.nodes.map(node => node.id === id ? {...node,title} : node)};
            render(currentState);
          }, clock: ARTBOARD_FIXTURE_CLOCK,
          nodeCount: graph.nodes.length };
        render(document.documentElement.dataset.galleryState || 'normal');
      `,
      loader: 'tsx',
      resolveDir: dashboard,
      sourcefile: 'brand-gallery-fixture.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

export async function brandGalleryDocument({ theme = 'dark', state = 'normal', code } = {}) {
  assert(['dark', 'light'].includes(theme), `Unknown gallery theme: ${theme}`);
  assert(brandGalleryStates.includes(state), `Unknown gallery state: ${state}`);
  const script = code ?? (await bundleBrandGalleryFixture());
  return `<!doctype html><html data-theme="${theme}" data-gallery-state="${state}"><head><style>${brandGalleryStyles()}</style></head><body><div id="root"></div><script>
    window.brandGalleryShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.brandGalleryShifts.push(entry.value);
      }
    }).observe({type:'layout-shift',buffered:true});
    Promise.all([
      ...[400,500,600,700,800].map(weight => document.fonts.load(weight + ' 16px "Outfit"')),
      ...[400,500,600].map(weight => document.fonts.load(weight + ' 12px "Source Code Pro"')),
      ...[400,500,600].map(weight => document.fonts.load(weight + ' 14px "DM Sans Variable"'))
    ]).then(() => document.fonts.ready).then(() => {${script.replaceAll('</script', '<\\/script')}});
  </script></body></html>`;
}

export async function mountBrandGallery(page, { theme = 'dark', state = 'normal', code } = {}) {
  await page.emulateMedia({
    reducedMotion: state === 'reduced-motion' ? 'reduce' : 'no-preference',
  });
  await page.setContent(await brandGalleryDocument({ theme, state, code }));
  await page.locator('[data-brand-gallery]').waitFor();
  if (state === 'loading' || state === 'error')
    await page
      .locator(
        `[data-gallery-recipe="command"] .pc-command-hint[data-state="${state === 'loading' ? 'pending' : 'blocked'}"]`,
      )
      .waitFor();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

const scalarTokens = {
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((unit) => [`space-${unit}`, `${unit * 4}px`]),
  ),
  'type-display-size': '40px',
  'type-display-leading': '1.05',
  'type-display-weight': '800',
  'type-page-size': '28px',
  'type-page-leading': '1.15',
  'type-page-weight': '700',
  'type-heading-size': '20px',
  'type-heading-leading': '1.3',
  'type-heading-weight': '600',
  'type-section-size': '16px',
  'type-section-leading': '1.3',
  'type-section-weight': '600',
  'type-body-size': '14px',
  'type-body-leading': '1.6',
  'type-body-weight': '400',
  'type-control-size': '13px',
  'type-control-leading': '20px',
  'type-control-weight': '500',
  'type-label-size': '13px',
  'type-label-weight': '500',
  'type-eyebrow-size': '12px',
  'type-eyebrow-leading': 'normal',
  'type-eyebrow-weight': '600',
  'type-technical-size': '12px',
  'type-technical-leading': '18px',
  'type-technical-weight': '500',
  'radius-tag': '6px',
  'radius-control': '8px',
  'radius-surface': '12px',
  'radius-card': '12px',
  'radius-sheet': '16px',
  'focus-width': '2px',
  'focus-offset': '2px',
  'motion-duration': '120ms',
  'motion-panel-duration': '200ms',
  'motion-live-duration': '1600ms',
  'motion-panel-distance': '24px',
  'motion-hover-ease': 'ease-out',
  'motion-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  'motion-reduced': '0.01ms',
  'tracking-display': '-0.03em',
  'tracking-title': '-0.02em',
  'tracking-eyebrow': '0.14em',
  'font-display': '"Outfit", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-ui': '"DM Sans Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-technical': '"Source Code Pro", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
const textStyles = {
  display: ['Outfit', 40, 800],
  page: ['Outfit', 28, 700],
  heading: ['Outfit', 20, 600],
  section: ['DM Sans Variable', 16, 600],
  body: ['DM Sans Variable', 14, 400],
  control: ['DM Sans Variable', 13, 500],
  label: ['DM Sans Variable', 13, 500],
  eyebrow: ['Source Code Pro', 12, 600],
  technical: ['Source Code Pro', 12, 500],
};
export function colorChannels(css) {
  const match = /^(rgba?|oklab|color)\((.+)\)$/u.exec(css);
  assert(match, `Unsupported computed colour: ${css}`);
  const space = match[1];
  if (space === 'color') assert(match[2].startsWith('srgb '), `Unsupported colour space: ${css}`);
  const channels = (space === 'color' ? match[2].slice(5) : match[2])
    .split('/')[0]
    .trim()
    .split(/[,\s]+/u)
    .map(Number);
  assert(
    channels.length >= 3 && channels.every(Number.isFinite),
    `Invalid colour channels: ${css}`,
  );
  const [lightness, a, b] = channels;
  if (space === 'color') return channels.slice(0, 3).map((channel) => channel * 255);
  if (space !== 'oklab') return channels.slice(0, 3);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => {
    const magnitude = Math.abs(channel);
    return (
      255 *
      (magnitude <= 0.0031308
        ? 12.92 * channel
        : Math.sign(channel) * (1.055 * magnitude ** (1 / 2.4) - 0.055))
    );
  });
}

export async function recordBrandGalleryEvidence(page, { theme, state }) {
  if (state === 'loading' || state === 'error')
    await page
      .locator(
        `[data-gallery-recipe="command"] .pc-command-hint[data-state="${state === 'loading' ? 'pending' : 'blocked'}"]`,
      )
      .waitFor();
  await page
    .locator('[data-gallery-recipe="button-primary"] .pc-button')
    .evaluate(async (button) => {
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
  const commandReference = await page.evaluate((source) => {
    const record = source.records.find((entry) => entry.attributes.class === 'cmd');
    if (!record) throw new Error('Components artboard has no command recipe.');
    const render = (entry) => {
      const element = document.createElement(entry.tag);
      for (const name of ['class', 'style']) {
        if (entry.attributes[name]) element.setAttribute(name, entry.attributes[name]);
      }
      for (const part of entry.content) {
        if (typeof part === 'string') element.append(part);
        else {
          const child = source.records.find((candidate) => candidate.id === part.recordId);
          if (!child) throw new Error(`Missing command artboard record ${part.recordId}.`);
          element.append(render(child));
        }
      }
      return element;
    };
    // Shadow isolation keeps the app's reset and recipe overrides out of the artboard measurement.
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:420px;pointer-events:none';
    host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    const styles = document.createElement('style');
    styles.textContent = source.styles.join('\n');
    const surface = document.createElement('div');
    surface.className = 'op t-dark';
    surface.style.lineHeight = 'normal';
    const command = render(record);
    surface.append(command);
    shadow.append(styles, surface);
    document.body.append(host);
    const css = getComputedStyle(command);
    const result = {
      source: source.source,
      recordId: record.id,
      height: command.getBoundingClientRect().height,
      paddingTop: css.paddingTop,
      paddingRight: css.paddingRight,
      fontSize: css.fontSize,
      fontFamily: css.fontFamily,
      keyHeight: command.querySelector('.kbd')?.getBoundingClientRect().height,
    };
    host.remove();
    return result;
  }, commandArtboard);
  const evidence = await page.evaluate(
    ({ theme, state, scalarNames, paletteNames, shadowValues, commandReference }) => {
      const root = document.querySelector('[data-brand-gallery]');
      if (!root) throw new Error('The brand gallery did not render.');
      const probe = document.createElement('span');
      root.append(probe);
      const colors = {};
      for (const namespace of ['op', 'pc']) {
        for (const name of paletteNames) {
          probe.style.color = `var(--${namespace}-${name})`;
          colors[`--${namespace}-${name}`] = getComputedStyle(probe).color;
        }
      }
      const tokens = Object.fromEntries(
        scalarNames.map((name) => [
          name,
          getComputedStyle(root).getPropertyValue(`--op-${name}`).trim(),
        ]),
      );
      const shadows = {};
      const shadowTokens = {};
      const expectedShadows = {};
      for (const namespace of ['op', 'pc']) {
        for (const name of ['shadow-menu', 'shadow-float', 'shadow-accent-edge']) {
          probe.style.boxShadow = `var(--${namespace}-${name})`;
          shadows[`--${namespace}-${name}`] = getComputedStyle(probe).boxShadow;
          shadowTokens[`--${namespace}-${name}`] = getComputedStyle(root)
            .getPropertyValue(`--${namespace}-${name}`)
            .trim();
        }
      }
      for (const [name, value] of Object.entries(shadowValues)) {
        probe.style.boxShadow = value;
        expectedShadows[name] = getComputedStyle(probe).boxShadow;
      }
      probe.remove();
      const fonts = [...root.querySelectorAll('[data-gallery-text-style]')].map((element) => {
        const css = getComputedStyle(element);
        return {
          name: element.dataset.galleryTextStyle,
          family: css.fontFamily,
          weight: css.fontWeight,
          size: css.fontSize,
          opticalSizing: css.fontOpticalSizing,
          loaded: document.fonts.check(
            `${css.fontWeight} ${css.fontSize} ${css.fontFamily.split(',')[0]}`,
          ),
        };
      });
      const pairings = [...root.querySelectorAll('[data-gallery-contrast]')].map((element) => {
        const chip = element.querySelector('.pc-artifact-tag, .pc-artifact');
        if (!chip)
          throw new Error(`Missing recipe for contrast pairing ${element.dataset.galleryContrast}`);
        const css = getComputedStyle(chip);
        return {
          kind: element.dataset.galleryContrast,
          surface: element.dataset.surface,
          foreground: css.color,
          background: css.backgroundColor,
          opacity: css.opacity,
          base: getComputedStyle(element.closest('[data-gallery-contrast-surface]'))
            .backgroundColor,
        };
      });
      const recipes = [...root.querySelectorAll('[data-gallery-recipe]')].map((element) => ({
        name: element.dataset.galleryRecipe,
        commandState: element.querySelector('.pc-command-hint')?.dataset.state,
        controls: [...element.querySelectorAll('button, input, [role="combobox"]')].map(
          (control) => ({
            tag: control.tagName,
            disabled:
              control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true',
            busy: control.getAttribute('aria-busy'),
          }),
        ),
        geometry: [
          ...element.querySelectorAll(
            '.pc-button, .pc-icon-button, .pc-input, .pc-chip, .pc-switch__track, .pc-segmented, .pc-command-hint__row, .pc-artifact-tag, .pc-artifact, tbody tr, .pc-toast, .pc-empty, .pc-kbd, .pc-priority, .pc-tabs__tab, .op-state-panel, .pc-artifact-row, .pc-skeleton-table, .pc-skeleton-table__row',
          ),
        ].map((child) => {
          const css = getComputedStyle(child);
          const rect = child.getBoundingClientRect();
          return {
            className: child.tagName === 'TR' ? 'table-row' : child.classList[0],
            variant: child.dataset.variant,
            commandVariant: child.closest('.pc-command-hint')?.dataset.variant,
            empty: Boolean(child.querySelector('.pc-table__empty')),
            width: rect.width,
            height: rect.height,
            radius: css.borderTopLeftRadius,
            padding: css.padding,
            paddingTop: css.paddingTop,
            paddingRight: css.paddingRight,
            minHeight: css.minHeight,
            gap: css.gap,
            font: css.fontFamily,
            outline: css.outlineWidth,
            outlineOffset: css.outlineOffset,
            background: css.backgroundColor,
          };
        }),
      }));
      return {
        theme,
        state,
        colors,
        tokens,
        shadows,
        shadowTokens,
        expectedShadows,
        fonts,
        pairings,
        recipes,
        commandReference,
        geometryCorrections: [
          {
            recipe: 'input',
            dimension: 'height',
            artboard: 40,
            currentRecipe: 36,
            difference: -4,
            reason: 'List.dc.html and finding F1 use 36px; Components.dc.html shows 40px.',
          },
        ],
        artboards: [...root.querySelectorAll('[data-gallery-artboard]')].map(
          (element) => element.dataset.galleryArtboard,
        ),
        clock: window.brandGalleryFixture.clock,
        now: new Date().toISOString(),
        nodeCount: window.brandGalleryFixture.nodeCount,
        shifts: window.brandGalleryShifts,
      };
    },
    {
      theme,
      state,
      commandReference,
      scalarNames: Object.keys(scalarTokens),
      paletteNames: [...Object.keys(palettes[theme]), 'line3', 'control-border'],
      shadowValues:
        theme === 'dark'
          ? {
              'shadow-menu': '0 1px 2px rgba(0,0,0,.28),0 8px 24px rgba(0,0,0,.24)',
              'shadow-float': '0 2px 6px rgba(0,0,0,.32),0 18px 44px rgba(0,0,0,.36)',
              'shadow-accent-edge': '0 0 0 1px rgba(94,234,212,.18)',
            }
          : {
              'shadow-menu': '0 2px 6px rgba(23,25,29,.06),0 16px 40px rgba(23,25,29,.1)',
              'shadow-float': '0 2px 6px rgba(23,25,29,.06),0 16px 40px rgba(23,25,29,.1)',
              'shadow-accent-edge': 'none',
            },
    },
  );
  for (const recipe of evidence.recipes) {
    for (const sample of recipe.geometry) {
      if (sample.className === 'pc-button' && sample.variant === 'primary')
        sample.backgroundSrgb = colorChannels(sample.background);
    }
  }
  return evidence;
}

export function assertBrandGalleryEvidence(evidence) {
  const { theme, state } = evidence;
  const label = `${theme} ${state}`;
  assert.deepEqual(evidence.artboards, ['Tokens', 'Components', 'States'], label);
  assert.equal(evidence.clock, '2026-10-18T12:00:00.000Z');
  assert.equal(evidence.now, evidence.clock);
  assert.equal(evidence.nodeCount, 708);
  assert.equal(
    evidence.shifts.reduce((sum, value) => sum + value, 0),
    0,
    `${label}: CLS`,
  );
  assertGalleryTokens(evidence);
  assertGalleryFonts(evidence);
  assertGalleryContrast(evidence);
  assertGalleryGeometry(evidence);
  if (state === 'hover' || state === 'active') {
    const primary = evidence.recipes
      .find((recipe) => recipe.name === 'button-primary')
      .geometry.find((sample) => sample.className === 'pc-button');
    const amount = state === 'hover' ? 0.92 : 0.88;
    const fg = rgb(palettes[theme].accent),
      ink = rgb(palettes[theme]['on-accent']);
    const actual = colorChannels(primary.background);
    const expected = fg.map((channel, index) => channel * amount + ink[index] * (1 - amount));
    actual.forEach((channel, index) => {
      assert(
        Math.abs(channel - expected[index]) < 0.02,
        `${label}: forced primary ${state} sRGB ${JSON.stringify(actual)} differs from ${JSON.stringify(expected)} (${primary.background})`,
      );
    });
  }
  assert.deepEqual(evidence.geometryCorrections, [
    {
      recipe: 'input',
      dimension: 'height',
      artboard: 40,
      currentRecipe: 36,
      difference: -4,
      reason: 'List.dc.html and finding F1 use 36px; Components.dc.html shows 40px.',
    },
  ]);
}

function assertGalleryTokens(evidence) {
  const { theme, state } = evidence;
  const label = `${theme} ${state}`;
  const expectedColors = {
    ...palettes[theme],
    line3: theme === 'dark' ? '#383f4a' : '#c7cdd5',
    'control-border': theme === 'dark' ? '#606c7f' : '#5d6470',
  };
  for (const [name, hex] of Object.entries(expectedColors)) {
    for (const namespace of ['op', 'pc'])
      assert.deepEqual(
        colorChannels(evidence.colors[`--${namespace}-${name}`]),
        rgb(hex),
        `${label}: ${namespace} ${name}`,
      );
  }
  for (const [name, expected] of Object.entries(scalarTokens)) {
    const value =
      state === 'reduced-motion' && name.startsWith('motion-')
        ? ({
            'motion-duration': '0.01ms',
            'motion-panel-duration': '0.01ms',
            'motion-live-duration': '0.01ms',
            'motion-panel-distance': '0px',
          }[name] ?? expected)
        : expected;
    assert.equal(evidence.tokens[name].replace(/\s+/gu, ' '), value, `${label}: ${name}`);
  }
  for (const name of ['shadow-menu', 'shadow-float', 'shadow-accent-edge']) {
    assert.equal(
      evidence.shadows[`--op-${name}`],
      evidence.shadows[`--pc-${name}`],
      `${label}: ${name}`,
    );
    assert.equal(
      evidence.shadows[`--op-${name}`],
      evidence.expectedShadows[name],
      `${label}: ${name} approved value`,
    );
  }
}

function assertGalleryFonts(evidence) {
  const label = `${evidence.theme} ${evidence.state}`;
  assert.equal(evidence.fonts.length, Object.keys(textStyles).length, label);
  for (const [name, [family, size, weight]] of Object.entries(textStyles)) {
    const sample = evidence.fonts.find((entry) => entry.name === name);
    assert(sample, `${label}: missing text style ${name}`);
    assert.equal(
      sample.family.split(',')[0].replaceAll('"', ''),
      family,
      `${label}: ${name} family`,
    );
    assert.equal(sample.size, `${size}px`, `${label}: ${name} size`);
    assert.equal(sample.weight, String(weight), `${label}: ${name} weight`);
    assert(sample.loaded, `${label}: ${name} local face unavailable`);
  }
}

function assertGalleryContrast(evidence) {
  const { theme, state } = evidence;
  const label = `${theme} ${state}`;
  const chips = [
    ...types.map((kind) => [`type-${kind}`, `type-${kind}`]),
    ...Object.entries(statuses).map(([status, foreground]) => [`status-${status}`, foreground]),
  ];
  assert.equal(evidence.pairings.length, chips.length * surfaces.length, label);
  chips.forEach(([kind, foreground], row) => {
    surfaces.forEach((surface, column) => {
      const matching = evidence.pairings.filter(
        (entry) => entry.kind === kind && entry.surface === surface,
      );
      assert.equal(matching.length, 1, `${label}: ${kind} on ${surface}`);
      const sample = matching[0];
      const fg = colorChannels(sample.foreground),
        bg = colorChannels(sample.background);
      assert.deepEqual(fg, rgb(palettes[theme][foreground]), `${label}: ${kind} foreground`);
      assert.deepEqual(
        colorChannels(sample.base),
        rgb(palettes[theme][surface]),
        `${label}: ${kind} base`,
      );
      const expectedTint = tint(fg, rgb(palettes[theme][surface]));
      assert.equal(sample.opacity, '1', `${label}: ${kind} opacity`);
      assert.doesNotMatch(
        sample.background,
        /(?:rgba\([^)]*,\s*0\.|\/\s*0\.)/u,
        `${label}: ${kind} tint must be opaque`,
      );
      bg.forEach((channel, index) => {
        assert(
          Math.abs(channel - expectedTint[index]) < 0.02,
          `${label}: ${kind} on ${surface} must use an opaque 8% tint`,
        );
      });
      const ratio = contrast(fg, bg);
      assert(ratio >= 4.5, `${label}: ${kind} on ${surface}: ${ratio}`);
      assert(
        Math.abs(ratio - tintRatios[theme][row][column]) < 0.001,
        `${label}: ${kind} on ${surface} differs from approved contrast matrix`,
      );
    });
  });
}

function assertGalleryGeometry(evidence) {
  const label = `${evidence.theme} ${evidence.state}`;
  assert.equal(evidence.commandReference.keyHeight, 22, `${label}: artboard command keycap`);
  assert.equal(evidence.commandReference.paddingTop, '10px');
  assert.equal(evidence.commandReference.paddingRight, '12px');
  assert.equal(evidence.commandReference.fontSize, '13px');
  const expectedRecipes = [
    'button-primary',
    'button-secondary',
    'button-ghost',
    'button-danger',
    'button-inverse',
    'icon-button',
    'input',
    'filter',
    'segmented',
    'switch',
    'command',
    'table',
    'trace',
    'toast',
    'empty',
    'inspector',
    'tooltip',
    'priority',
    'status',
    'tag',
    'keys',
    'tabs',
    'row',
    'state-booting',
    'state-first-use',
    'state-empty',
    'state-offline',
    'state-error',
    'state-incompatible',
  ];
  assert.deepEqual(
    evidence.recipes.map((recipe) => recipe.name).sort(),
    [...expectedRecipes].sort(),
    label,
  );
  for (const recipe of evidence.recipes) {
    assert(recipe.geometry.length > 0, `${label}: ${recipe.name} has no geometry evidence`);
    for (const sample of recipe.geometry)
      assertGeometrySample(sample, `${label}: ${recipe.name}`, evidence.commandReference);
  }
}

function assertGeometrySample(sample, label, commandReference) {
  const dimensions = {
    'pc-button': { height: 34, radius: 8 },
    'pc-icon-button': { height: 34, radius: 8 },
    'pc-input': { height: 36, radius: 8 },
    'pc-chip': { height: 32, radius: 999 },
    'pc-switch__track': { height: 19, radius: 999 },
    'pc-segmented': { height: 38, radius: 10 },
    'pc-artifact-tag': { height: 22, radius: 6 },
    'pc-artifact': { height: 22 },
    'pc-kbd': { height: 22 },
    'pc-priority': { height: 18 },
    'pc-tabs__tab': { height: 36 },
    'pc-artifact-row': { height: 44 },
    'pc-command-hint__row':
      sample.commandVariant === 'row'
        ? { height: 28, width: 28, radius: 8, paddingTop: 0, paddingRight: 0 }
        : { height: commandReference.height, radius: 8, paddingTop: 10, paddingRight: 12 },
    'pc-toast': { radius: 12, paddingTop: 14, paddingRight: 16, gap: 12 },
    'pc-empty': { paddingTop: 28, paddingRight: 16 },
    'op-state-panel': { minHeight: 180, paddingTop: 24 },
    'table-row': { height: 44 },
    'pc-skeleton-table': { radius: 12 },
    'pc-skeleton-table__row': { height: 34 },
  };
  assert(sample.width > 0 && sample.height > 0, `${label} is not measurable`);
  if (sample.className === 'pc-artifact' && ['glyph', 'legend'].includes(sample.variant)) return;
  if (sample.className === 'table-row' && sample.empty) return;
  for (const [property, expected] of Object.entries(dimensions[sample.className] ?? {})) {
    const actual = Number.parseFloat(sample[property]);
    assert(
      Math.abs(actual - expected) <= 2,
      `${label} ${sample.className} ${property}=${actual}, expected ${expected} +/-2px`,
    );
  }
}
