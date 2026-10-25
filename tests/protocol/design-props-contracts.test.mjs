import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalizeJson, sha256Hex } from '../../packages/protocol/src/canonical-json.mjs';
import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import {
  assertDesignDocument,
  DESIGN_DOCUMENT_SCHEMA,
  validateDesignDocument,
  validateDesignProps,
} from '../../packages/protocol/src/design-contracts.mjs';
import { validateJson } from '../../packages/protocol/src/json-schema.mjs';
import {
  assertDesignReviewBundle,
  DESIGN_REVIEW_BUNDLE_CURRENT_SCHEMA,
} from '../../packages/protocol/src/review-experience-contracts.mjs';

function fixture() {
  return {
    kind: 'openplanr-design-document',
    schemaVersion: '1.1.0',
    id: 'account',
    title: 'Account',
    brief: { text: 'Manage an account', source: 'describe', provenance: 'inferred' },
    frames: [{ id: 'desktop', label: 'Desktop', width: 1200, height: 900 }],
    screens: [
      {
        id: 'overview',
        title: 'Overview',
        source: { html: 'source/overview.html' },
        props: {
          theme: { type: 'enum', options: ['light', 'dark-mode', 'contrast'], default: 'light' },
          expanded: { type: 'boolean', default: false },
        },
      },
    ],
    screenOrder: ['overview'],
    variants: [
      {
        id: 'dark',
        label: 'Dark',
        status: 'ready',
        sources: { overview: { html: 'source/alternate.html' } },
        props: { overview: { theme: 'dark-mode', expanded: true } },
      },
    ],
    selectedVariant: 'dark',
    defaultView: 'canvas',
  };
}

function bundleFixture() {
  const { kind, brief, screens, variants, ...document } = fixture();
  const reviewContext = {
    kind: 'openplanr-design-review-context',
    schemaVersion: '1.0.0',
    designId: document.id,
    brief: { purpose: 'Review account', requests: [] },
    implementation: { tokens: [], components: [], responsive: [], accessibility: [] },
  };
  return {
    kind: 'openplanr-design-review-bundle',
    schemaVersion: '1.1.0',
    design: {
      ...document,
      screens: screens.map(({ source, ...screen }) => screen),
      variants: variants.map(({ sources, ...variant }) => variant),
    },
    envelope: { schemaVersion: '1.0.0', artifacts: [], viewer: {} },
    entries: [
      { artifactId: 'account', screenId: 'overview', variantId: 'dark', frameId: 'desktop' },
    ],
    revision: 'a'.repeat(64),
    reviewContext,
    contextDigest: sha256Hex(canonicalizeJson(reviewContext)),
    fingerprints: [],
  };
}

test('typed props use the additive document schema and retain both source and value overrides', () => {
  const document = fixture();
  assert.equal(DESIGN_DOCUMENT_SCHEMA['x-openplanr-contract'].version, '1.22.0');
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL(
          '../../packages/protocol/schemas/v1.22.0/design-document.schema.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
    DESIGN_DOCUMENT_SCHEMA,
  );
  assert.deepEqual(validateJson(document, DESIGN_DOCUMENT_SCHEMA), []);
  assert.equal(assertDesignDocument(document), document);
  assert.deepEqual(
    validateProtocolArtifact('design-document', document, { protocolVersion: '1.22.0' }),
    [],
  );
  document.variants[0].props = {};
  assert.equal(assertDesignDocument(document), document);
});

test('props require authored version 1.1.0 while legacy documents remain unchanged', () => {
  for (const field of ['screens', 'variants']) {
    const document = fixture();
    document.schemaVersion = '1.0.0';
    delete document[field === 'screens' ? 'variants' : 'screens'][0].props;
    assert.ok(validateJson(document, DESIGN_DOCUMENT_SCHEMA).length > 0);
    assert.throws(() => assertDesignDocument(document), /props.*1\.1\.0|1\.1\.0.*props/su);
  }
  const document = fixture();
  document.schemaVersion = '1.0.0';
  delete document.screens[0].props;
  delete document.variants[0].props;
  const before = JSON.stringify(document);
  assert.equal(assertDesignDocument(document), document);
  assert.equal(JSON.stringify(document), before);
});

test('prop declarations reject malformed names, types, options and defaults', () => {
  const declarations = [
    { '1theme': { type: 'boolean', default: false } },
    { Theme: { type: 'boolean', default: false }, theme: { type: 'boolean', default: true } },
    { theme: { type: 'string', default: 'light' } },
    { theme: { type: 'boolean' } },
    { theme: { type: 'boolean', default: 'false' } },
    { theme: { type: 'boolean', default: false, options: ['light'] } },
    { theme: { type: 'enum', options: [], default: 'light' } },
    { theme: { type: 'enum', options: ['light', 'light'], default: 'light' } },
    { theme: { type: 'enum', options: [' '], default: ' ' } },
    { theme: { type: 'enum', options: ['light'], default: false } },
    { theme: { type: 'enum', options: ['light'], default: 'dark' } },
  ];
  for (const props of declarations) {
    const document = fixture();
    document.screens[0].props = props;
    assert.equal(validateDesignDocument(document).ok, false, JSON.stringify(props));
    assert.ok(
      validateProtocolArtifact('design-document', document, { protocolVersion: '1.22.0' }).length >
        0,
    );
  }
});

test('prop tokens reject uppercase names, case pairs and non-token enum text in every validator', () => {
  for (const props of [
    { isDark: { type: 'boolean', default: false } },
    { theme: { type: 'boolean', default: false }, Theme: { type: 'boolean', default: true } },
    { theme: { type: 'enum', options: ['light', 'Dark mode'], default: 'light' } },
    { theme: { type: 'enum', options: ['dark mode'], default: 'dark mode' } },
    { theme: { type: 'enum', options: ['light'], default: 'Dark' } },
    { theme: { type: 'enum', options: ['café'], default: 'café' } },
    { theme_name: { type: 'boolean', default: true } },
    { 'theme\n': { type: 'boolean', default: true } },
    { theme: { type: 'enum', options: ['dark\n'], default: 'dark\n' } },
    { ['a'.repeat(129)]: { type: 'boolean', default: true } },
    { theme: { type: 'enum', options: ['a'.repeat(129)], default: 'a'.repeat(129) } },
  ]) {
    const document = fixture();
    document.screens[0].props = props;
    document.variants[0].props = {};
    assert.ok(validateJson(document, DESIGN_DOCUMENT_SCHEMA).length > 0, JSON.stringify(props));
    assert.ok(validateDesignProps(document).length > 0, JSON.stringify(props));
    assert.equal(validateDesignDocument(document).ok, false);
  }
});

test('instance values reject unknown screens and props, wrong types and enum values', () => {
  for (const props of [
    { missing: {} },
    { overview: { missing: true } },
    { overview: { theme: 'blue' } },
    { overview: { theme: true } },
    { overview: { Theme: 'light' } },
    { overview: { theme: 'dark mode' } },
    { overview: { theme: 'a'.repeat(129) } },
    { overview: { expanded: 'false' } },
    { overview: { expanded: 1 } },
  ]) {
    const document = fixture();
    document.variants[0].props = props;
    assert.equal(validateDesignDocument(document).ok, false, JSON.stringify(props));
    assert.ok(validateDesignProps(document).length > 0, JSON.stringify(props));
    assert.ok(
      validateProtocolArtifact('design-document', document, { protocolVersion: '1.22.0' }).length >
        0,
    );
  }
});

test('published review bundles retain declarations and instances and reject invalid values', () => {
  const bundle = bundleFixture();
  assert.equal(DESIGN_REVIEW_BUNDLE_CURRENT_SCHEMA['x-openplanr-contract'].version, '1.22.0');
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL(
          '../../packages/protocol/schemas/v1.22.0/design-review-bundle.schema.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
    DESIGN_REVIEW_BUNDLE_CURRENT_SCHEMA,
  );
  assert.deepEqual(validateJson(bundle, DESIGN_REVIEW_BUNDLE_CURRENT_SCHEMA), []);
  assert.equal(assertDesignReviewBundle(bundle), bundle);
  assert.deepEqual(
    validateProtocolArtifact('design-review-bundle', bundle, { protocolVersion: '1.22.0' }),
    [],
  );
  bundle.design.variants[0].props.overview.theme = 'blue';
  assert.throws(() => assertDesignReviewBundle(bundle), /theme/u);
  assert.ok(
    validateProtocolArtifact('design-review-bundle', bundle, { protocolVersion: '1.22.0' }).length >
      0,
  );
  bundle.design.variants[0].props.overview.theme = 'light';
  delete bundle.design.schemaVersion;
  assert.throws(() => assertDesignReviewBundle(bundle), /schemaVersion|1\.1\.0/u);
});

test('published design schema families preserve their released bytes', () => {
  const hashes = {
    'v1.9.0/design-document': 'bd84d34b42f9451f9ff836105a7a6c92b2d74209aa82f6a0dd973532edf99422',
    'v1.9.0/design-review-bundle':
      '560bbc0f147f20f5b3d65a36b10ae1c4209fd5d9ec0a199f0d23f818684dcba8',
    'v1.20.0/design-document': '9782c8c130b19f7c47b17ec59a216f4699e3a6f3b81120ecc0442d2576d58fa2',
    'v1.20.0/design-review-bundle':
      '72db7c04d4a96ee8fc2a9c1c4146dd1cfc4352a80ea8cacda50aceeb9ad172c7',
  };
  for (const [path, expected] of Object.entries(hashes)) {
    const bytes = readFileSync(
      new URL(`../../packages/protocol/schemas/${path}.schema.json`, import.meta.url),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
});
