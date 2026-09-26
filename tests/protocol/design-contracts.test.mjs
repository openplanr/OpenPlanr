import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DESIGN_DOCUMENT_SCHEMA,
  DESIGN_DOCUMENT_VERSION,
  assertDesignDocument,
  validateDesignDocument,
} from '../../packages/protocol/src/design-contracts.mjs';
import { validateJson } from '../../packages/protocol/src/json-schema.mjs';
import {
  listProtocolSchemas,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';

const fixture = () => ({
  kind: 'openplanr-design-document',
  schemaVersion: '1.0.0',
  id: 'account-studio',
  title: 'Account experience',
  brief: {
    text: 'Help existing members manage their account.',
    source: 'spec',
    provenance: 'spec',
    references: ['https://example.com/reference'],
  },
  designSystem: {
    path: 'source/design-system',
    tokens: 'source/tokens.css',
    spacing: [0, 2.5, 5, 10, 20],
  },
  assets: ['source/logo.svg'],
  frames: [
    { id: 'wide', label: 'Project desktop', width: 1366, height: 900 },
    { id: 'narrow', label: 'Project mobile', width: 393, height: 852 },
  ],
  screens: [
    {
      id: 'overview',
      title: 'Overview',
      source: {
        html: 'source/overview.html',
        styles: ['source/theme.css'],
        scripts: ['source/app.js'],
      },
      anchors: ['primary-action'],
    },
    {
      id: 'details',
      title: 'Account details',
      source: { html: 'source/details.html' },
      anchors: ['primary-action'],
    },
  ],
  screenOrder: ['overview', 'details'],
  flows: [
    { id: 'edit-account', title: 'Edit account', screens: ['overview', 'details', 'overview'] },
  ],
  variants: [
    { id: 'quiet', label: 'Quiet clarity', status: 'ready' },
    {
      id: 'expressive',
      label: 'Expressive',
      status: 'ready',
      sources: { overview: { html: 'source/expressive/overview.html' } },
    },
    {
      id: 'incomplete',
      label: 'Incomplete',
      status: 'failed',
      issue: 'Rendering was interrupted.',
    },
  ],
  selectedVariant: 'quiet',
  defaultView: 'canvas',
});

test('authored design schema is additive, immutable, packaged identically and portable', async () => {
  const packaged = JSON.parse(
    readFileSync(
      new URL(
        '../../packages/protocol/schemas/v1.9.0/design-document.schema.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(packaged, DESIGN_DOCUMENT_SCHEMA);
  assert.equal(DESIGN_DOCUMENT_VERSION, '1.0.0');
  assert.deepEqual(packaged['x-openplanr-contract'], { id: 'design-document', version: '1.9.0' });
  assert.equal(Object.isFrozen(DESIGN_DOCUMENT_SCHEMA.properties.screens.items), true);
  assert.equal(
    (await import('@openplanr/protocol/design-contracts')).DESIGN_DOCUMENT_VERSION,
    '1.0.0',
  );
  assert.deepEqual(validateJson(fixture(), packaged), []);
  assert.deepEqual(
    validateProtocolArtifact('design-document', fixture(), { protocolVersion: '1.9.0' }),
    [],
  );
  assert.ok(
    listProtocolSchemas().some(
      ({ kind, protocolVersion }) => kind === 'design-document' && protocolVersion === '1.9.0',
    ),
  );
});

test('one authored source supports project frames, sparse variants and repeated journey screens', () => {
  for (const defaultView of ['canvas', 'prototype', 'walkthrough']) {
    const document = { ...fixture(), defaultView };
    assert.deepEqual(validateDesignDocument(document), { ok: true, errors: [] });
    assert.strictEqual(assertDesignDocument(document), document);
  }
});

test('walkthroughs are not limited to eight screens', () => {
  const document = fixture();
  for (let index = 0; index < 12; index += 1) {
    document.screens.push({
      id: `step-${index}`,
      title: `Step ${index}`,
      source: { html: `source/step-${index}.html` },
    });
    document.screenOrder.push(`step-${index}`);
  }
  assert.equal(validateDesignDocument(document).ok, true);
});

test('document structure rejects malformed inputs and future or undeclared fields', () => {
  for (const value of [
    null,
    undefined,
    [],
    false,
    {},
    { ...fixture(), schemaVersion: '2.0.0' },
    { ...fixture(), runtime: {} },
  ]) {
    assert.equal(validateDesignDocument(value).ok, false);
    assert.throws(() => assertDesignDocument(value), /Invalid design document/);
  }
  for (const field of ['frames', 'screens', 'variants', 'screenOrder']) {
    assert.equal(validateDesignDocument({ ...fixture(), [field]: [] }).ok, false, field);
  }
});

test('duplicate identities and feedback anchors cannot silently retarget review state', () => {
  for (const field of ['frames', 'screens', 'flows', 'variants']) {
    const document = fixture();
    document[field].push(structuredClone(document[field][0]));
    const result = validateDesignDocument(document);
    assert.equal(result.ok, false, field);
    assert.ok(
      result.errors.some((error) => error.includes('duplicate identity')),
      result.errors.join('\n'),
    );
  }
  const document = fixture();
  document.screens[0].anchors.push('primary-action');
  assert.equal(validateDesignDocument(document).ok, false);
});

test('screen order includes each screen exactly once and all flows and overrides resolve', () => {
  const mutations = [
    (document) => {
      document.screenOrder = ['overview'];
    },
    (document) => {
      document.screenOrder.push('missing');
    },
    (document) => {
      document.screenOrder.push('overview');
    },
    (document) => {
      document.flows[0].screens.push('missing');
    },
    (document) => {
      document.variants[1].sources.missing = { html: 'source/missing.html' };
    },
  ];
  for (const mutate of mutations) {
    const document = fixture();
    mutate(document);
    assert.equal(validateDesignDocument(document).ok, false);
  }
});

test('selected direction must exist and be ready while failed alternatives retain their diagnosis', () => {
  for (const selectedVariant of ['missing', 'incomplete']) {
    const result = validateDesignDocument({ ...fixture(), selectedVariant });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('selectedVariant')));
  }
  const document = fixture();
  delete document.variants[2].issue;
  assert.equal(validateDesignDocument(document).ok, false);
});

test('all authored source and asset paths reject escaping or external locations', () => {
  const badPaths = [
    '../outside.html',
    'source/../../outside.html',
    './source/page.html',
    '/tmp/page.html',
    'C:\\temp\\page.html',
    'source\\page.html',
    'https://example.com/page.html',
    '//example.com/page.html',
    'data:text/html,example',
    'file:///tmp/page.html',
    'source/%2e%2e/page.html',
    'source/page.html#fragment',
    'source/page.html?query',
    'source/\u0000page.html',
    'source//page.html',
    'source/',
  ];
  const setters = [
    (document, path) => {
      document.screens[0].source.html = path;
    },
    (document, path) => {
      document.screens[0].source.styles = [path];
    },
    (document, path) => {
      document.screens[0].source.scripts = [path];
    },
    (document, path) => {
      document.variants[1].sources.overview.html = path;
    },
    (document, path) => {
      document.assets = [path];
    },
    (document, path) => {
      document.designSystem.path = path;
    },
    (document, path) => {
      document.designSystem.tokens = path;
    },
  ];
  for (const path of badPaths) {
    for (const set of setters) {
      const document = fixture();
      set(document, path);
      assert.equal(validateDesignDocument(document).ok, false, path);
    }
  }
});

test('frame dimensions are positive bounded integers and project spacing stays finite', () => {
  for (const width of [0, -1, 16385, 1024.5, NaN, Infinity, '1440']) {
    const document = fixture();
    document.frames[0].width = width;
    assert.equal(validateDesignDocument(document).ok, false, String(width));
  }
  for (const spacing of [NaN, Infinity, -1]) {
    const document = fixture();
    document.designSystem.spacing = [spacing];
    assert.equal(validateDesignDocument(document).ok, false, String(spacing));
  }
});
