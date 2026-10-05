/**
 * Design-engine rounds end to end through `openplanr-pipeline design-engine`: variants are
 * generated (GPT Image through a stubbed OpenAI API, or recorded claude-svg), boarded on a real
 * daemon, and checked in the documents the board shows the reviewer.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';

import { findRunningDaemon, killRunningDaemon } from '../../lib/design-engine/daemon.mjs';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MODEL,
  DEFAULT_QUALITY,
  DEFAULT_SIZE,
} from '../../lib/design-engine/providers/openai.mjs';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PIPELINE_BIN = join(here, '..', '..', 'bin', 'openplanr-pipeline.mjs');
const OPENAI_STUB = pathToFileURL(join(here, 'openai-stub.mjs')).href;
const runBrowser = process.env.PLANR_BROWSER_TESTS === '1';

const GPT_IMAGE_VARIANTS = [
  { id: 'A', brief: 'Pricing hero, three tiers, calm indigo', width: 1024, height: 1024 },
  { id: 'B', brief: 'Pricing hero, comparison table first', width: 1536, height: 1024 },
  { id: 'C', brief: 'Pricing hero, one plan and a calculator', width: 1024, height: 1536 },
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
    stub: join(root, 'openai'),
  };
  for (const dir of [paths.home, paths.cwd, paths.stub]) mkdirSync(dir);
  const env = { ...process.env, PLANR_HOME: paths.home };
  delete env.OPENAI_API_KEY;
  t.after(async () => {
    await killRunningDaemon(await findRunningDaemon({ env }));
    rmSync(root, { recursive: true, force: true });
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

/** Generates the three variants in parallel, as the loop's per-variant agents do, then boards them. */
async function gptImageRound(t) {
  const round = roundFixture(t);
  const pngs = {};
  const images = {};
  for (const { id, brief, width, height } of GPT_IMAGE_VARIANTS) {
    pngs[id] = solidPng(width, height, COLORS[id]);
    writeFileSync(join(round.stub, `${id}.png`), pngs[id]);
    images[brief] = `${id}.png`;
  }
  writeFileSync(join(round.stub, 'images.json'), `${JSON.stringify(images)}\n`);
  const env = {
    ...round.env,
    OPENAI_API_KEY: 'sk-openplanr-test-stub',
    OPENPLANR_OPENAI_STUB_DIR: round.stub,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${OPENAI_STUB}`].filter(Boolean).join(' '),
  };
  const generated = await Promise.all(
    GPT_IMAGE_VARIANTS.map(({ id, brief, width, height }) =>
      designEngine(
        [
          'generate',
          '--provider',
          'openai',
          '--brief',
          brief,
          '--variant',
          id,
          '--target',
          'pricing',
          '--project',
          'round',
          '--session-dir',
          round.session,
          ...(`${width}x${height}` === DEFAULT_SIZE ? [] : ['--size', `${width}x${height}`]),
        ],
        { env, cwd: round.cwd },
      ),
    ),
  );
  const sessionFiles = readdirSync(round.session).sort();
  const board = await designEngine(['board', '--dir', round.session, '--id', 'round-pricing'], {
    env,
    cwd: round.cwd,
  });
  const url = /^BOARD_URL: (\S+)$/m.exec(board.stderr)?.[1];
  return { round, pngs, generated, sessionFiles, board, url };
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

test('a GPT Image round reaches the board as one image per variant', async (t) => {
  const { round, pngs, generated, sessionFiles, board, url } = await gptImageRound(t);

  for (const [index, result] of generated.entries()) {
    const { id } = GPT_IMAGE_VARIANTS[index];
    assert.equal(result.code, 0, `generate ${id} failed: ${result.stderr}`);
    const { ok, provider, variant, outputPath } = JSON.parse(result.stdout);
    assert.deepEqual(
      { ok, provider, variant, outputPath },
      {
        ok: true,
        provider: 'openai',
        variant: id,
        outputPath: join(round.session, `variant-${id}.png`),
      },
    );
  }
  const requests = readFileSync(join(round.stub, 'requests.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .sort((left, right) => left.brief.localeCompare(right.brief));
  assert.deepEqual(
    requests,
    [...GPT_IMAGE_VARIANTS]
      .sort((left, right) => left.brief.localeCompare(right.brief))
      .map(({ brief, width, height }) => ({
        model: DEFAULT_MODEL,
        tool: {
          type: 'image_generation',
          model: DEFAULT_IMAGE_MODEL,
          size: `${width}x${height}`,
          quality: DEFAULT_QUALITY,
        },
        brief,
        previousResponseId: null,
      })),
    'one image-generation request per variant, on the default models',
  );
  assert.deepEqual(
    sessionFiles,
    [
      '.gitignore',
      'session-A.json',
      'session-B.json',
      'session-C.json',
      'variant-A.png',
      'variant-B.png',
      'variant-C.png',
    ],
    'generate writes each image and its session, and no viewer files',
  );
  for (const { id } of GPT_IMAGE_VARIANTS) {
    assert.ok(
      readFileSync(join(round.session, `variant-${id}.png`)).equals(pngs[id]),
      `variant-${id}.png holds the generated image`,
    );
  }

  assert.equal(board.code, 0, `board failed: ${board.stderr}`);
  assert.ok(url, `board printed no BOARD_URL: ${board.stderr}`);
  assert.deepEqual(JSON.parse(board.stdout).variants, ['A', 'B', 'C']);
  await assertBoardShowsImages(
    url,
    GPT_IMAGE_VARIANTS.map(({ id, width, height }) => ({
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
    GPT_IMAGE_VARIANTS.map(({ id }) => [id, 'png']),
  );
  for (const source of sources) {
    const download = await fetch(new URL(source.url, url));
    assert.equal(download.status, 200, `variant ${source.artifactId} source downloads`);
    assert.ok(
      Buffer.from(await download.arrayBuffer()).equals(pngs[source.artifactId]),
      `variant ${source.artifactId} downloads the generated PNG`,
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

test('the board shows every GPT Image variant in the browser', {
  skip: runBrowser ? false : 'browser-gated: set PLANR_BROWSER_TESTS=1',
  timeout: 90_000,
}, async (t) => {
  const { board, url } = await gptImageRound(t);
  assert.equal(board.code, 0, `board failed: ${board.stderr}`);
  const { launchBrowser } = await import('../../../../tests/support/browser-launcher.mjs');
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    for (const { id, width, height } of GPT_IMAGE_VARIANTS) {
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
