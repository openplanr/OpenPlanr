import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertDesignReviewMetadata,
  assertReviewExperience,
  DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA,
  DESIGN_REVIEW_METADATA_PAYLOAD_V11_SCHEMA,
  REVIEW_EXPERIENCE_SCHEMAS,
} from '../../packages/protocol/src/review-experience-contracts.mjs';
import { DESIGN_REVIEW_BUNDLE_SCHEMA } from '../../packages/protocol/src/workspace-contracts.mjs';

test('review experience schemas are separately versioned and preserve the original bundle', () => {
  for (const [name, schema] of Object.entries(REVIEW_EXPERIENCE_SCHEMAS)) {
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          new URL(`../../packages/protocol/schemas/v1.10.0/${name}.schema.json`, import.meta.url),
        ),
      ),
      schema,
    );
    assert.equal(schema.additionalProperties, false);
  }
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL(
          '../../packages/protocol/schemas/v1.9.0/design-review-bundle.schema.json',
          import.meta.url,
        ),
      ),
    ),
    DESIGN_REVIEW_BUNDLE_SCHEMA,
  );
  assert.equal(DESIGN_REVIEW_BUNDLE_SCHEMA.properties.schemaVersion.const, '1.0.0');
  assert.equal(DESIGN_REVIEW_BUNDLE_SCHEMA.properties.reviewContext, undefined);
});
test('metadata categories and owner dispositions have explicit bounded payloads', () => {
  const common = {
    schemaVersion: '1.0.0',
    author: 'Reviewer',
    pinId: 'pin-1',
    reviewOf: 'a'.repeat(64),
    updatedAt: '2026-09-10T10:00:00Z',
  };
  assertReviewExperience(
    { ...common, kind: 'category', category: 'blocker' },
    DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA,
  );
  assertReviewExperience(
    { ...common, kind: 'disposition', disposition: 'accepted', reason: '' },
    DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA,
  );
  for (const invalid of [
    { ...common, kind: 'category' },
    { ...common, kind: 'category', category: 'blocker', disposition: 'accepted' },
    { ...common, kind: 'disposition', disposition: 'approved', reason: '' },
    { ...common, kind: 'disposition', disposition: 'accepted', reason: '', isOwner: true },
  ])
    assert.throws(() => assertReviewExperience(invalid, DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA));
});

test('change requests use an additive payload version without changing legacy metadata semantics', () => {
  const common = {
    schemaVersion: '1.1.0',
    kind: 'category',
    author: 'Reviewer',
    pinId: 'pin-1',
    reviewOf: 'a'.repeat(64),
    updatedAt: '2026-09-11T10:00:00Z',
  };
  assert.equal(DESIGN_REVIEW_METADATA_PAYLOAD_V11_SCHEMA['x-openplanr-contract'].version, '1.11.0');
  assert.deepEqual(DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA.properties.category.enum, [
    'question',
    'suggestion',
    'blocker',
  ]);
  for (const category of ['question', 'suggestion', 'change-request', 'blocker'])
    assertDesignReviewMetadata({ ...common, category });
  for (const category of ['question', 'suggestion', 'blocker'])
    assertDesignReviewMetadata({ ...common, schemaVersion: '1.0.0', category });
  for (const schemaVersion of ['1.0.0', '1.1.0'])
    assertDesignReviewMetadata({
      ...common,
      schemaVersion,
      kind: 'disposition',
      disposition: 'accepted',
      reason: 'Owner confirmation',
    });
  for (const invalid of [
    { ...common, schemaVersion: '1.0.0', category: 'change-request' },
    { ...common, schemaVersion: '1.2.0', category: 'change-request' },
    { ...common, category: 'change-request', disposition: 'accepted' },
    { ...common, category: 'fix' },
    { ...common, category: 'improve' },
  ])
    assert.throws(() => assertDesignReviewMetadata(invalid));
});
