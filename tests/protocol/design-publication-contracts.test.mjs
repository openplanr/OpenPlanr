import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson, sha256Hex } from '../../packages/protocol/src/canonical-json.mjs';
import { assertCompanyDesignBundle } from '../../packages/protocol/src/design-publication-contracts.mjs';
import { assertDesignReviewBundle } from '../../packages/protocol/src/review-experience-contracts.mjs';

function fixture() {
  const reviewContext = {
    kind: 'openplanr-design-review-context',
    schemaVersion: '1.0.0',
    designId: 'orders',
    brief: { purpose: 'Review checkout.', requests: [] },
    implementation: { tokens: [], components: [], responsive: [], accessibility: [] },
  };
  const html =
    '<!doctype html><html><body data-planr-screen="checkout"><button data-planr-id="confirm">Confirm</button></body></html>';
  return {
    kind: 'openplanr-design-review-bundle',
    schemaVersion: '1.1.0',
    design: {
      id: 'orders',
      title: 'Order flow',
      defaultView: 'canvas',
      selectedVariant: 'A',
      screenOrder: ['checkout'],
      screens: [{ id: 'checkout', title: 'Checkout', anchors: ['confirm'] }],
      frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
      variants: [{ id: 'A', label: 'Direction A', status: 'ready' }],
    },
    envelope: {
      schemaVersion: '1.0.0',
      artifacts: [
        {
          id: 'orders-A-checkout-desktop',
          kind: 'html',
          title: 'Checkout',
          html,
          sha256: sha256Hex(html),
          viewport: { width: 1440, height: 1024 },
          colorScheme: 'light',
        },
      ],
      viewer: {
        mode: 'single',
        activeArtifactId: 'orders-A-checkout-desktop',
        presentation: 'canvas',
      },
    },
    entries: [
      {
        artifactId: 'orders-A-checkout-desktop',
        screenId: 'checkout',
        variantId: 'A',
        frameId: 'desktop',
      },
    ],
    state: {},
    verification: { status: 'unverified' },
    revision: sha256Hex('revision'),
    reviewContext,
    contextDigest: sha256Hex(canonicalizeJson(reviewContext)),
    fingerprints: [
      {
        screenId: 'checkout',
        variantId: 'A',
        frameId: 'desktop',
        contentDigest: sha256Hex(html),
        guidanceDigest: sha256Hex('guidance'),
      },
    ],
  };
}
test('company constraints reuse the source-free 1.1 bundle without changing legacy readers', () => {
  const bundle = fixture();
  assert.equal(assertCompanyDesignBundle(bundle), bundle);
  const legacy = structuredClone(bundle);
  legacy.schemaVersion = '1.0.0';
  delete legacy.reviewContext;
  delete legacy.contextDigest;
  delete legacy.fingerprints;
  assert.equal(assertDesignReviewBundle(legacy), legacy);
  assert.throws(() => assertCompanyDesignBundle(legacy), /1.1.0/);
});

test('rejects malformed identity, entry, viewport and envelope mappings', () => {
  const mutations = [
    (value) => value.design.screens.push(structuredClone(value.design.screens[0])),
    (value) => value.design.frames.push(structuredClone(value.design.frames[0])),
    (value) => value.design.variants.push(structuredClone(value.design.variants[0])),
    (value) => {
      value.design.screenOrder = ['missing'];
    },
    (value) => {
      value.design.selectedVariant = 'missing';
    },
    (value) => {
      value.design.variants[0].status = 'failed';
      value.design.variants[0].issue = 'Missing source';
    },
    (value) => {
      value.design.flows = [{ id: 'flow', title: 'Flow', screens: ['missing'] }];
    },
    (value) => {
      value.entries[0].screenId = 'missing';
    },
    (value) => {
      value.entries[0].frameId = 'missing';
    },
    (value) => {
      value.entries[0].variantId = 'missing';
    },
    (value) => {
      value.entries[0].artifactId = 'missing';
    },
    (value) => {
      value.envelope.artifacts[0].viewport.width = 320;
    },
    (value) => {
      value.envelope.artifacts[0].html += '<p>changed</p>';
    },
    (value) => {
      value.envelope.artifacts[0].secret = 'extra';
    },
    (value) => {
      value.envelope.artifacts[0].viewport.extra = true;
    },
    (value) => {
      value.envelope.artifacts[0].kind = 'json';
    },
    (value) => {
      value.envelope.artifacts[0].colorScheme = 'auto';
    },
    (value) => {
      value.envelope.artifacts.push({ ...value.envelope.artifacts[0], id: 'extra' });
    },
    (value) => {
      value.envelope.artifacts.push(structuredClone(value.envelope.artifacts[0]));
    },
    (value) => {
      value.envelope.viewer.activeArtifactId = 'missing';
    },
    (value) => {
      value.envelope.viewer.presentation = 'document';
    },
    (value) => {
      value.envelope.review = {};
    },
    (value) => {
      value.fingerprints = [];
    },
    (value) => {
      value.state.positions = { missing: { x: 0, y: 0 } };
    },
  ];
  for (const mutate of mutations) {
    const bundle = fixture();
    mutate(bundle);
    assert.throws(() => assertCompanyDesignBundle(bundle), TypeError);
  }
});

test('requires a bijective full product of screens, variants and frames', () => {
  const bundle = fixture();
  bundle.design.frames.push({ id: 'mobile', label: 'Mobile', width: 390, height: 844 });
  assert.throws(() => assertCompanyDesignBundle(bundle), /every screen/);
  const artifact = {
    ...bundle.envelope.artifacts[0],
    id: 'orders-A-checkout-mobile',
    viewport: { width: 390, height: 844 },
  };
  bundle.envelope.artifacts.push(artifact);
  bundle.entries.push({ ...bundle.entries[0], frameId: 'mobile', artifactId: artifact.id });
  bundle.fingerprints.push({ ...bundle.fingerprints[0], frameId: 'mobile' });
  assertCompanyDesignBundle(bundle);
  bundle.entries[1].artifactId = bundle.entries[0].artifactId;
  assert.throws(() => assertCompanyDesignBundle(bundle), /uniquely/);
});

test('bounds payload complexity, UTF-8 bytes and review component targets', () => {
  const cycle = {};
  cycle.value = cycle;
  assert.throws(() => assertCompanyDesignBundle(cycle), /complexity/);
  const huge = fixture();
  huge.envelope.artifacts[0].html = 'é'.repeat(530000);
  assert.throws(() => assertCompanyDesignBundle(huge), /1 MiB/);
  for (const component of [
    { id: 'button', name: 'Button', screenIds: ['missing'] },
    { id: 'button', name: 'Button', anchorIds: ['missing'] },
  ]) {
    const bundle = fixture();
    bundle.reviewContext.implementation.components = [component];
    bundle.contextDigest = sha256Hex(canonicalizeJson(bundle.reviewContext));
    assert.throws(() => assertCompanyDesignBundle(bundle), /guidance/);
  }
});
