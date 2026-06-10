import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const load = (rel) => JSON.parse(readFileSync(join(root, 'schemas/v1.0.0', rel), 'utf-8'));

const feedbackSchema = load('design-feedback.schema.json');
const sessionSchema = load('design-session.schema.json');
const tasteSchema = load('taste-profile.schema.json');
const approvedSchema = load('design-approved.schema.json');

const validFeedback = {
  schema_version: '1.0.0',
  boardId: 'logo-2026-06-10',
  publishedAt: '2026-06-10T12:00:00Z',
  preferred: 'B',
  ratings: { A: 3, B: 5 },
  comments: { A: 'too corporate', B: 'love the mark' },
  overall: 'lean into B, darker indigo',
  regenerated: false,
  pins: [
    { variant: 'B', x: 0.42, y: 0.1, w: 0.2, h: 0.08, comment: 'kern the wordmark tighter', intent: 'fix' },
    { variant: 'A', x: 0.5, y: 0.5, w: 0, h: 0, comment: 'what font is this?', intent: 'question', screen: 's-hero' },
  ],
};

test('design-feedback: a full submit payload validates', () => {
  assert.equal(validate(validFeedback, feedbackSchema).length, 0);
});

test('design-feedback: a pending (regenerate) payload validates', () => {
  const pending = {
    ...validFeedback,
    preferred: undefined,
    regenerated: true,
    regenerateAction: 'remix',
    remixSpec: { layoutFrom: 'A', colorsFrom: 'B' },
  };
  delete pending.preferred;
  assert.equal(validate(pending, feedbackSchema).length, 0);
});

test('design-feedback: bad intent, missing comment, unknown key all fail', () => {
  const bad = {
    ...validFeedback,
    extra: true,
    pins: [{ variant: 'A', x: 0.1, y: 0.1, w: 0, h: 0, comment: '', intent: 'delete' }],
  };
  const errs = validate(bad, feedbackSchema);
  assert.ok(errs.some((e) => e.rule === 'enum'), 'intent enum rejected');
  assert.ok(errs.some((e) => e.rule === 'minLength'), 'empty comment rejected');
  assert.ok(errs.some((e) => e.rule === 'additionalProperties'), 'unknown key rejected');
});

const validSession = {
  schema_version: '1.0.0',
  id: 'logo-2026-06-10-A',
  provider: 'claude-svg',
  target: 'logo',
  project: 'wpsyde',
  originalBrief: 'A geometric W mark, indigo on cream',
  briefVersions: ['A geometric W mark, indigo on cream'],
  feedbackHistory: ['tighter kerning'],
  outputPaths: ['/abs/variant-A.svg', '/abs/variant-A-v2.svg'],
  regionEdits: [
    { at: '2026-06-10T12:10:00Z', screen: 's-hero', pins: [{ variant: 'A' }], summary: 'kerned wordmark' },
  ],
  lastResponseId: null,
  createdAt: '2026-06-10T11:00:00Z',
  updatedAt: '2026-06-10T12:10:00Z',
};

test('design-session: claude-svg session (null responseId) validates', () => {
  assert.equal(validate(validSession, sessionSchema).length, 0);
});

test('design-session: openai session chains a responseId', () => {
  const s = { ...validSession, provider: 'openai', lastResponseId: 'resp_abc123' };
  assert.equal(validate(s, sessionSchema).length, 0);
});

test('design-session: unknown provider + missing originalBrief fail', () => {
  const bad = { ...validSession, provider: 'midjourney' };
  delete bad.originalBrief;
  const errs = validate(bad, sessionSchema);
  assert.ok(errs.some((e) => e.rule === 'enum'));
  assert.ok(errs.some((e) => e.rule === 'required'));
});

const validTaste = {
  schema_version: '1.0.0',
  profile_version: 1,
  dimensions: {
    fonts: [{ value: 'Inter', confidence: 0.8, approved_count: 4, rejected_count: 1, last_seen: '2026-06-10T12:00:00Z' }],
    colors: [{ value: 'deep indigo', confidence: 0.7, approved_count: 3, rejected_count: 0, last_seen: '2026-06-10T12:00:00Z' }],
    layouts: [],
    aesthetics: [{ value: 'minimal', confidence: 0.9, approved_count: 6, rejected_count: 1, last_seen: '2026-06-01T12:00:00Z' }],
  },
  sessions: [{ sessionId: 'logo-2026-06-10-A', verdict: 'approved', at: '2026-06-10T12:00:00Z', artifact: '/abs/a.svg' }],
};

test('taste-profile: a populated profile validates', () => {
  assert.equal(validate(validTaste, tasteSchema).length, 0);
});

test('taste-profile: a missing dimension + bad verdict fail', () => {
  const bad = JSON.parse(JSON.stringify(validTaste));
  delete bad.dimensions.layouts;
  bad.sessions[0].verdict = 'meh';
  const errs = validate(bad, tasteSchema);
  assert.ok(errs.some((e) => e.rule === 'required'));
  assert.ok(errs.some((e) => e.rule === 'enum'));
});

const validApproved = {
  schema_version: '1.0.0',
  boardId: 'logo-2026-06-10',
  sessionId: 'logo-2026-06-10-B',
  approvedVariant: 'B',
  approvedPath: '/abs/variant-B-v2.svg',
  provider: 'claude-svg',
  target: 'logo',
  approvedAt: '2026-06-10T12:30:00Z',
  copiedTo: ['input/design-system/logo.svg', 'input/design-system/favicon-32.png'],
  notes: 'run with B, darker indigo',
};

test('design-approved: an approval record validates', () => {
  assert.equal(validate(validApproved, approvedSchema).length, 0);
});

test('design-approved: empty copiedTo is allowed but missing approvedPath fails', () => {
  const okEmpty = { ...validApproved, copiedTo: [] };
  assert.equal(validate(okEmpty, approvedSchema).length, 0);
  const bad = { ...validApproved };
  delete bad.approvedPath;
  assert.ok(validate(bad, approvedSchema).some((e) => e.rule === 'required'));
});
