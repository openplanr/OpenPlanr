import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import {
  ARTIFACT_THEME_ERROR_CODES,
  ArtifactThemeError,
  loadArtifactTheme,
  normalizeArtifactTheme,
  renderArtifactThemeCss,
  renderArtifactThemeJson,
  validateArtifactTheme,
} from '../../lib/artifact/ui/tokens.mjs';
import {
  ArtifactThemeGenerationError,
  renderArtifactThemeAssets,
  runArtifactThemeGenerator,
  staleArtifactThemeTargets,
  writeArtifactThemeAssets,
} from '../../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = join(root, 'registry', 'artifact-theme.json');
const schemaPath = join(root, 'schemas', 'v1.1.0', 'artifact-theme.schema.json');
const canonical = JSON.parse(readFileSync(registryPath, 'utf8'));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const temporaryRoots = [];

function clone(value = canonical) {
  return structuredClone(value);
}
function temporaryProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-artifact-theme-'));
  temporaryRoots.push(projectRoot);
  mkdirSync(join(projectRoot, 'registry'), { recursive: true });
  copyFileSync(registryPath, join(projectRoot, 'registry', 'artifact-theme.json'));
  return projectRoot;
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

test('canonical registry satisfies the strict Protocol v1.1 theme schema', () => {
  assert.deepEqual(validateJson(canonical, schema), []);
  assert.deepEqual(loadArtifactTheme(), normalizeArtifactTheme(canonical));
});

test('missing and unknown tokens return stable named errors', () => {
  const missing = clone();
  delete missing.themes.dark.text;
  assert.throws(
    () => validateArtifactTheme(missing),
    (error) => error instanceof ArtifactThemeError
      && error.code === ARTIFACT_THEME_ERROR_CODES.TOKEN_MISSING
      && error.details.issues[0].path === '$.themes.dark',
  );

  const unknown = clone();
  unknown.layout.sidebarWidth = 400;
  assert.throws(
    () => validateArtifactTheme(unknown),
    (error) => error instanceof ArtifactThemeError
      && error.code === ARTIFACT_THEME_ERROR_CODES.TOKEN_UNKNOWN
      && error.details.issues[0].path === '$.layout',
  );
});

test('invalid colors, layout constants, motion ranges, and unsupported schema values are named', () => {
  const color = clone();
  color.themes.light.primary = 'teal';
  assert.throws(
    () => validateArtifactTheme(color),
    (error) => error.code === ARTIFACT_THEME_ERROR_CODES.FORMAT,
  );

  const layout = clone();
  layout.layout.toolbarHeight = 52;
  assert.throws(
    () => validateArtifactTheme(layout),
    (error) => error.code === ARTIFACT_THEME_ERROR_CODES.LAYOUT,
  );

  const motion = clone();
  motion.layout.motionFastMs = 90;
  assert.throws(
    () => validateArtifactTheme(motion),
    (error) => error.code === ARTIFACT_THEME_ERROR_CODES.MOTION,
  );

  const version = clone();
  version.schemaVersion = '2.0.0';
  assert.throws(
    () => validateArtifactTheme(version),
    (error) => error.code === ARTIFACT_THEME_ERROR_CODES.SCHEMA,
  );
});

test('every declared foreground/background pair must meet WCAG AA', () => {
  const invalid = clone();
  invalid.themes.dark.textMuted = invalid.themes.dark.background;
  assert.throws(
    () => validateArtifactTheme(invalid),
    (error) => error instanceof ArtifactThemeError
      && error.code === ARTIFACT_THEME_ERROR_CODES.CONTRAST
      && error.details.theme === 'dark'
      && error.details.ratio === 1,
  );
});

test('CSS and JSON renderers are deterministic, portable, and newline-normalized', () => {
  const firstCss = renderArtifactThemeCss(canonical);
  const secondCss = renderArtifactThemeCss(clone());
  const firstJson = renderArtifactThemeJson(canonical);
  const secondJson = renderArtifactThemeJson(clone());

  assert.equal(firstCss, secondCss);
  assert.equal(firstJson, secondJson);
  assert.equal(firstCss.endsWith('\n'), true);
  assert.equal(firstJson.endsWith('\n'), true);
  assert.match(firstCss, /--planr-toolbar-height: 48px;/);
  assert.match(firstCss, /--planr-review-rail-width: 344px;/);
  assert.match(firstCss, /\[data-planr-theme="light"\]/);
  assert.match(firstCss, /prefers-reduced-motion: reduce/);
  assert.deepEqual(JSON.parse(firstJson), normalizeArtifactTheme(canonical));
});

test('generated packaged outputs are exactly current', () => {
  const expected = renderArtifactThemeAssets();
  assert.deepEqual(staleArtifactThemeTargets(), []);
  for (const [target, bytes] of Object.entries(expected)) {
    assert.equal(readFileSync(join(root, target), 'utf8'), bytes);
  }
  assert.deepEqual(runArtifactThemeGenerator({ argv: ['--check'] }), {
    ok: true,
    mode: 'check',
    staleTargets: [],
  });
});

test('--check is write-free and reports every exact stale target', () => {
  const projectRoot = temporaryProject();
  const expectedTargets = [
    'lib/artifact/ui/generated/artifact-theme.css',
    'lib/artifact/ui/generated/artifact-theme.json',
  ];

  assert.throws(
    () => runArtifactThemeGenerator({ argv: ['--check'], projectRoot }),
    (error) => error instanceof ArtifactThemeGenerationError
      && error.code === 'E_ARTIFACT_THEME_DRIFT'
      && assert.deepEqual(error.details.staleTargets, expectedTargets) === undefined
      && expectedTargets.every((target) => error.message.includes(target)),
  );
  for (const target of expectedTargets) assert.equal(readFileOrNull(join(projectRoot, target)), null);
});

test('generation writes only changed targets and converges idempotently', () => {
  const projectRoot = temporaryProject();
  assert.deepEqual(writeArtifactThemeAssets({ projectRoot }), [
    'lib/artifact/ui/generated/artifact-theme.css',
    'lib/artifact/ui/generated/artifact-theme.json',
  ]);
  assert.deepEqual(writeArtifactThemeAssets({ projectRoot }), []);

  const staleTarget = join(projectRoot, 'lib/artifact/ui/generated/artifact-theme.css');
  writeFileSync(staleTarget, 'stale\r\n', 'utf8');
  assert.deepEqual(staleArtifactThemeTargets({ projectRoot }), [
    'lib/artifact/ui/generated/artifact-theme.css',
  ]);
});

test('generator rejects unsupported arguments without writing', () => {
  const projectRoot = temporaryProject();
  assert.throws(
    () => runArtifactThemeGenerator({ argv: ['--force'], projectRoot }),
    (error) => error instanceof ArtifactThemeGenerationError
      && error.code === 'E_ARTIFACT_THEME_GENERATOR_ARGUMENT',
  );
  assert.equal(readFileOrNull(join(projectRoot, 'lib/artifact/ui/generated/artifact-theme.css')), null);
});

function readFileOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
