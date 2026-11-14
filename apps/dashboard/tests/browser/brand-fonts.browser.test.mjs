import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../../../tests/support/browser-launcher.mjs';
import {
  contrast,
  palettes,
  rgb,
  statuses,
  surfaces,
  tintRatios,
  types,
} from '../helpers/brand-contract.mjs';
import { variationAxes } from '../helpers/font-tables.mjs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const manifest = () => JSON.parse(readFileSync(resolve(dist, 'dashboard-manifest.json'), 'utf8'));

function assertBuiltFonts() {
  const assets = manifest().assets;
  for (const [family, weights] of [
    ['outfit', [400, 500, 600, 700, 800]],
    ['source-code-pro', [400, 500, 600]],
  ]) {
    for (const weight of weights) {
      assert(
        assets.some(
          (asset) => asset.includes(`${family}-latin-${weight}-normal`) && asset.endsWith('.woff2'),
        ),
        `${family} ${weight} must survive bundling`,
      );
    }
  }
  for (const family of ['outfit', 'dm-sans', 'source-code-pro']) {
    const license = `licenses/${family}-OFL.txt`;
    assert(assets.includes(license));
    assert.match(
      readFileSync(resolve(dist, license), 'utf8'),
      /SIL OPEN FONT LICENSE Version 1\.1/iu,
    );
  }
  const variable = assets.filter((asset) => asset.includes('dm-sans-') && asset.endsWith('.woff2'));
  assert(variable.length > 0);
  for (const asset of variable) {
    const axes = variationAxes(readFileSync(resolve(dist, asset)));
    const opsz = axes.find((axis) => axis.tag === 'opsz');
    const wght = axes.find((axis) => axis.tag === 'wght');
    assert.equal(opsz?.min, 9);
    assert.equal(opsz?.max, 40);
    assert.equal(wght?.min, 100);
    assert.equal(wght?.max, 1000);
  }
  const css = assets
    .filter((asset) => asset.endsWith('.css'))
    .map((asset) => readFileSync(resolve(dist, asset), 'utf8'))
    .join('\n');
  assert.doesNotMatch(css, /https?:\/\/(?:fonts\.|[^\s"')]*cdn)/iu);
  for (const match of css.matchAll(/url\(["']?([^"')]+\.(?:woff2?|ttf))["']?\)/gu)) {
    const asset = `assets/${match[1].split('/').at(-1)}`;
    assert(assets.includes(asset), `Font absent from integrity manifest: ${asset}`);
    assert(readFileSync(resolve(dist, asset)).length > 0);
  }
}

async function localServer() {
  const server = createServer((request, response) => {
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'",
    );
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (pathname.startsWith('/api/')) {
      response
        .writeHead(503, { 'content-type': 'application/json' })
        .end('{"error":"Fixture has no live server"}');
      return;
    }
    try {
      const content = readFileSync(file);
      const type =
        {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
        }[extname(file)] ?? 'application/octet-stream';
      response
        .writeHead(200, {
          'content-type': type,
          'cache-control': /\.woff2?$/u.test(file)
            ? 'public, max-age=31536000, immutable'
            : 'no-store',
        })
        .end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const colorChannels = (css) => {
  if (css.startsWith('color(srgb '))
    return css
      .match(/[\d.]+/gu)
      .map(Number)
      .slice(0, 3)
      .map((channel) => channel * 255);
  return css
    .match(/[\d.]+/gu)
    .map(Number)
    .slice(0, 3);
};

test('production tokens, themes and local fonts work with external networking blocked', {
  timeout: 60_000,
}, async (t) => {
  assertBuiltFonts();
  const { server, origin } = await localServer();
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const chips = [
    ...types.map((kind) => [`type-${kind}`, `type-${kind}`]),
    ...Object.entries(statuses).map(([status, foreground]) => [`status-${status}`, foreground]),
  ];
  for (const scenario of [
    { stored: null, os: 'light', theme: 'dark' },
    { stored: 'dark', os: 'light', theme: 'dark' },
    { stored: 'light', os: 'dark', theme: 'light' },
    { stored: 'system', os: 'dark', theme: 'dark' },
    { stored: 'system', os: 'light', theme: 'light' },
  ]) {
    const context = await browser.newContext({
      colorScheme: scenario.os,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const external = [];
      context.on('request', (request) => {
        if (new URL(request.url()).origin !== origin) external.push(request.url());
      });
      await context.addInitScript(({ stored }) => {
        if (stored === null) localStorage.removeItem('op-theme');
        else localStorage.setItem('op-theme', stored);
        window.brandShifts = [];
        window.brandPaints = [];
        window.brandExternalBlocks = [];
        window.addEventListener('securitypolicyviolation', (event) => {
          if (
            /^https?:/u.test(event.blockedURI) &&
            new URL(event.blockedURI).origin !== location.origin
          ) {
            window.brandExternalBlocks.push(event.blockedURI);
          }
        });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!entry.hadRecentInput) window.brandShifts.push(entry.value);
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver(() => {
          window.brandPaints.push(document.documentElement.getAttribute('data-theme'));
        }).observe({ type: 'paint', buffered: true });
      }, scenario);
      const page = await context.newPage();
      for (let load = 0; load < 2; load += 1) {
        if (load === 0) await page.goto(origin);
        else await page.reload();
        await page.waitForSelector('.pc-shell');
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        const result = await page.evaluate(
          ({ names, chips: chipDefinitions, surfaces: bases }) => {
            const probe = document.createElement('span');
            probe.style.position = 'fixed';
            document.body.append(probe);
            const colors = {};
            const read = (name, property = 'color') => {
              probe.style[property] = `var(${name})`;
              return getComputedStyle(probe)[property];
            };
            for (const name of names) colors[name] = read(name);
            const tints = [];
            for (const namespace of ['op', 'pc']) {
              for (const [chip, foreground] of chipDefinitions) {
                for (const base of bases) {
                  tints.push({
                    namespace,
                    chip,
                    foreground,
                    base,
                    color: read(`--${namespace}-${chip}-bg-${base}`, 'backgroundColor'),
                  });
                }
              }
            }
            const geometries = [];
            probe.style.fontFamily = '"DM Sans Variable"';
            probe.style.fontWeight = '500';
            probe.style.display = 'inline-block';
            probe.textContent = 'Attention, pipeline 0123456789';
            for (const size of [14, 40]) {
              probe.style.fontSize = `${size}px`;
              probe.style.fontOpticalSizing = 'auto';
              const auto = probe.getBoundingClientRect();
              probe.style.fontOpticalSizing = 'none';
              const none = probe.getBoundingClientRect();
              probe.style.fontOpticalSizing = 'auto';
              const again = probe.getBoundingClientRect();
              geometries.push({
                size,
                auto: auto.width,
                none: none.width,
                again: again.width,
                height: auto.height,
              });
            }
            probe.remove();
            return {
              colors,
              tints,
              geometries,
              shifts: window.brandShifts,
              externalBlocks: window.brandExternalBlocks,
              paints: window.brandPaints,
              theme: document.documentElement.dataset.theme,
              fonts: performance
                .getEntriesByType('resource')
                .filter((entry) => /\.woff2?(?:\?|$)/u.test(entry.name))
                .map((entry) => ({ url: entry.name, transfer: entry.transferSize })),
            };
          },
          {
            names: Object.keys(palettes[scenario.theme]).flatMap((name) => [
              `--op-${name}`,
              `--pc-${name}`,
            ]),
            chips,
            surfaces,
          },
        );
        assert.equal(result.theme, scenario.stored ?? 'dark');
        assert(result.paints.every((paint) => paint === (scenario.stored ?? 'dark')));
        assert.equal(
          result.shifts.reduce((sum, shift) => sum + shift, 0),
          0,
        );
        assert.deepEqual(result.externalBlocks, []);
        for (const [name, value] of Object.entries(palettes[scenario.theme])) {
          for (const namespace of ['op', 'pc'])
            assert.deepEqual(
              colorChannels(result.colors[`--${namespace}-${name}`]),
              rgb(value),
              `${scenario.theme} ${namespace} ${name}`,
            );
        }
        result.tints.forEach(({ chip, foreground, base, color }) => {
          const ratio = contrast(rgb(palettes[scenario.theme][foreground]), colorChannels(color));
          assert(ratio >= 4.5);
          const row = chips.findIndex(([name]) => name === chip);
          assert(Math.abs(ratio - tintRatios[scenario.theme][row][surfaces.indexOf(base)]) < 0.001);
        });
        assert(result.fonts.length >= 9, 'All required normal faces must load locally');
        assert(result.fonts.every(({ url }) => new URL(url).origin === origin));
        if (load > 0) assert(result.fonts.every(({ transfer }) => transfer === 0));
        assert(result.geometries.every(({ auto, again, height }) => auto === again && height > 0));
        assert(
          result.geometries.some(({ auto, none }) => Math.abs(auto - none) > 0.01),
          'Optical sizing must change geometry at 14 or 40 px',
        );
      }
      for (let toggle = 0; toggle < 3; toggle += 1) {
        const current = await page.evaluate(() => document.documentElement.dataset.theme);
        const next = { dark: 'system', system: 'light', light: 'dark' }[current];
        await page.getByRole('button', { name: `Theme: ${current}. Switch to ${next}.` }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), next);
        assert.equal(await page.evaluate(() => localStorage.getItem('op-theme')), next);
      }
      assert.deepEqual(external, []);
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      const forced = await page.evaluate(() => {
        const probe = document.createElement('button');
        probe.style.cssText =
          'background:var(--op-panel);color:var(--pc-text-primary);border:1px solid var(--pc-border-strong)';
        const system = document.createElement('button');
        system.style.cssText = 'background:Canvas;color:CanvasText;border:1px solid ButtonText';
        document.body.append(probe, system);
        const values = (element) => {
          const css = getComputedStyle(element);
          return [css.backgroundColor, css.color, css.borderTopColor];
        };
        const report = {
          actual: values(probe),
          expected: values(system),
          panelMotion: getComputedStyle(document.documentElement)
            .getPropertyValue('--op-motion-panel-distance')
            .trim(),
        };
        probe.remove();
        system.remove();
        return report;
      });
      assert.deepEqual(forced.actual, forced.expected);
      assert.equal(forced.panelMotion, '0px');
    } finally {
      await context.close();
    }
  }
  const denied = await browser.newContext();
  try {
    await denied.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'getItem', {
        value() {
          throw new Error('Storage denied');
        },
      });
      Object.defineProperty(Storage.prototype, 'setItem', {
        value() {
          throw new Error('Storage denied');
        },
      });
    });
    const page = await denied.newPage();
    await page.goto(origin);
    await page.waitForSelector('.pc-shell');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.getByText('Theme preference could not be saved in this browser.').waitFor();
    await page.getByRole('button', { name: 'Theme: dark. Switch to system.' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'system');
    await page.getByText('Theme preference could not be saved in this browser.').waitFor();
  } finally {
    await denied.close();
  }
});
