/**
 * Design-engine rounds end to end through `openplanr-pipeline design-engine`: variants are
 * recorded claude-svg sheets or PNG images placed in the session, boarded on a real daemon, and
 * checked in the documents the board shows the reviewer.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';

import { findRunningDaemon, killRunningDaemon } from '../../lib/design-engine/daemon.mjs';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PIPELINE_BIN = join(here, '..', '..', 'bin', 'openplanr-pipeline.mjs');
const runBrowser = process.env.PLANR_BROWSER_TESTS === '1';

const IMAGE_VARIANTS = [
  { id: 'A', width: 1024, height: 1024 },
  { id: 'B', width: 1536, height: 1024 },
  { id: 'C', width: 1024, height: 1536 },
];
const COLORS = { A: [79, 70, 229], B: [13, 148, 136], C: [234, 88, 12] };

function solidPng(width, height, [red, green, blue]) {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** A private PLANR_HOME, working directory and session directory; the daemon stops afterwards. */
function roundFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'planr-board-round-'));
  const paths = {
    home: join(root, 'home'),
    cwd: join(root, 'cwd'),
    session: join(root, 'session'),
  };
  for (const dir of [paths.home, paths.cwd]) mkdirSync(dir);
  const env = { ...process.env, PLANR_HOME: paths.home };
  t.after(async () => {
    try {
      const running = await findRunningDaemon({ env });
      if (running) assert.equal(await killRunningDaemon(running, { env }), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  return { ...paths, env };
}

async function designEngine(args, { env, cwd }) {
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [PIPELINE_BIN, 'design-engine', ...args],
      { env, cwd, encoding: 'utf8' },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

/** Places one PNG per variant in the session directory, as images from any tool, then boards them. */
async function imageRound(t) {
  const round = roundFixture(t);
  mkdirSync(round.session);
  const pngs = {};
  for (const { id, width, height } of IMAGE_VARIANTS) {
    pngs[id] = solidPng(width, height, COLORS[id]);
    writeFileSync(join(round.session, `variant-${id}.png`), pngs[id]);
  }
  const board = await designEngine(['board', '--dir', round.session, '--id', 'round-pricing'], {
    env: round.env,
    cwd: round.cwd,
  });
  const url = /^BOARD_URL: (\S+)$/m.exec(board.stderr)?.[1];
  return { pngs, board, url };
}

async function boardArtifacts(url) {
  const response = await fetch(new URL('api/envelope', url));
  assert.equal(response.status, 200, `${url}api/envelope answers`);
  return (await response.json()).envelope.artifacts;
}

/** Asserts the board frames each variant as exactly its image, at the image's own size. */
async function assertBoardShowsImages(url, expected) {
  const artifacts = await boardArtifacts(url);
  assert.deepEqual(
    artifacts.map(({ id, viewport }) => [id, viewport]),
    expected.map(({ id, width, height }) => [id, { width, height }]),
  );
  for (const { id, mediaType, bytes } of expected) {
    const image = `<img data-planr-id="design-variant-${id}" src="data:${mediaType};base64,${bytes.toString('base64')}"`;
    const { html } = artifacts.find((artifact) => artifact.id === id);
    assert.ok(html.includes(image), `variant ${id} is its own image under its anchor`);
    assert.doesNotMatch(html, /<script/i, `variant ${id} needs no script runtime`);
    const frame = await fetch(new URL(`artifacts/${encodeURIComponent(id)}`, url));
    assert.equal(frame.status, 200, `the board serves the frame document for variant ${id}`);
    assert.ok((await frame.text()).includes(image), `the frame for variant ${id} shows the image`);
  }
}

test('an image round reaches the board as one image per variant', async (t) => {
  const { pngs, board, url } = await imageRound(t);
  assert.equal(board.code, 0, `board failed: ${board.stderr}`);
  assert.ok(url, `board printed no BOARD_URL: ${board.stderr}`);
  assert.deepEqual(JSON.parse(board.stdout).variants, ['A', 'B', 'C']);
  await assertBoardShowsImages(
    url,
    IMAGE_VARIANTS.map(({ id, width, height }) => ({
      id,
      width,
      height,
      mediaType: 'image/png',
      bytes: pngs[id],
    })),
  );
  const { sources } = await (await fetch(new URL('api/sources', url))).json();
  assert.deepEqual(
    sources.map(({ artifactId, kind }) => [artifactId, kind]),
    IMAGE_VARIANTS.map(({ id }) => [id, 'png']),
  );
  for (const source of sources) {
    const download = await fetch(new URL(source.url, url));
    assert.equal(download.status, 200, `variant ${source.artifactId} source downloads`);
    assert.ok(
      Buffer.from(await download.arrayBuffer()).equals(pngs[source.artifactId]),
      `variant ${source.artifactId} downloads its PNG`,
    );
  }
});

test('a recorded claude-svg round reaches the board as the SVG', async (t) => {
  const round = roundFixture(t);
  const common = ['--target', 'logo', '--project', 'round', '--session-dir', round.session];
  const authored = await designEngine(
    ['generate', '--brief', 'Geometric W mark', '--variant', 'A', ...common],
    round,
  );
  assert.equal(authored.code, 0, `generate failed: ${authored.stderr}`);
  const { writeTo, contract } = JSON.parse(authored.stdout);
  // Written with explicit end tags: the board's bundler re-serializes SVG, and this form
  // survives byte for byte.
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${contract.width}" height="${contract.height}" viewBox="0 0 ${contract.width} ${contract.height}">`,
    '<g id="tile-light"><g id="section-mark"><circle cx="160" cy="200" r="80" fill="#4f46e5"></circle></g>',
    '<g id="section-wordmark"><text x="300" y="220" font-family="system-ui" font-size="64">w</text></g>',
    '<g id="section-lockup"><text x="160" y="500" font-family="system-ui" font-size="32">w mark</text></g></g>',
    '<g id="tile-dark"><rect x="600" width="600" height="800" fill="#111"></rect><text x="700" y="420" fill="#fff" font-family="system-ui">w</text></g>',
    '</svg>',
  ].join('');
  writeFileSync(writeTo, svg);

  const recorded = await designEngine(
    ['record', '--variant', 'A', '--file', writeTo, '--brief', 'Geometric W mark', ...common],
    round,
  );
  assert.equal(recorded.code, 0, `record failed: ${recorded.stderr}`);
  assert.deepEqual(
    readdirSync(round.session).sort(),
    ['.gitignore', 'session-A.json', 'variant-A.svg'],
    'record writes the session and no viewer files',
  );

  const board = await designEngine(['board', '--dir', round.session, '--id', 'round-logo'], round);
  assert.equal(board.code, 0, `board failed: ${board.stderr}`);
  const url = /^BOARD_URL: (\S+)$/m.exec(board.stderr)?.[1];
  assert.ok(url, `board printed no BOARD_URL: ${board.stderr}`);
  await assertBoardShowsImages(url, [
    {
      id: 'A',
      width: contract.width,
      height: contract.height,
      mediaType: 'image/svg+xml',
      bytes: Buffer.from(svg),
    },
  ]);
});

test('the board shows every image variant in the browser', {
  skip: runBrowser ? false : 'browser-gated: set PLANR_BROWSER_TESTS=1',
  timeout: 90_000,
}, async (t) => {
  const { board, url } = await imageRound(t);
  assert.equal(board.code, 0, `board failed: ${board.stderr}`);
  const { launchBrowser } = await import('../../../../tests/support/browser-launcher.mjs');
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    for (const { id, width, height } of IMAGE_VARIANTS) {
      await page.locator(`[role="tab"][data-artifact-id="${id}"]`).click();
      const frame = page.locator(
        `iframe[data-planr-artifact-frame="${id}"][data-planr-bridge-trusted="true"]`,
      );
      await frame.waitFor({ state: 'visible' });
      const image = page
        .frameLocator(`iframe[data-planr-artifact-frame="${id}"]`)
        .locator(`img[data-planr-id="design-variant-${id}"]`);
      await image.waitFor({ state: 'visible' });
      assert.deepEqual(
        await image.evaluate((img) => ({
          complete: img.complete,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })),
        { complete: true, width, height },
        `variant ${id} shows its ${width}x${height} image`,
      );
      const box = await frame.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `variant ${id} is on screen`);
    }
    assert.deepEqual(errors, [], 'the board raised no page errors');
  } finally {
    await browser.close();
  }
});
