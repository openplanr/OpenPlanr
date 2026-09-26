import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertImplementationHandoffProjection,
  composeImplementationHandoff,
  createRepositorySourceResolver,
  deriveImplementationRequirementId,
  exportImplementationHandoffPackage,
  implementationHandoffPaths,
  importImplementationHandoffPackage,
  readImplementationHandoffDraft,
  recoverImplementationHandoffDraft,
  verifyImplementationHandoffSources,
  writeImplementationHandoffDraft,
} from '../lib/design/implementation-handoff.mjs';

const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const fixed = (character) => `sha256:${character.repeat(64)}`;
const sourceKinds = [
  'design-revision',
  'selected-direction',
  'design-specification',
  'rendered-verification',
  'review-context',
  'review-feedback',
  'review-metadata',
  'review-handoff',
  'screen',
  'frame',
  'component',
  'state',
  'flow',
  'token',
  'review-decision',
  'element-anchor',
];
const requirementKinds = [
  'behavior',
  'visual-state',
  'responsive',
  'accessibility',
  'content-data-assumption',
  'constraint',
  'verification-intent',
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-implementation-handoff-'));
  const sources = sourceKinds.map((kind, index) => {
    const path = `sources/${String(index + 1).padStart(2, '0')}-${kind}.txt`;
    const anchor =
      kind === 'selected-direction'
        ? { section: 'direction-one' }
        : kind === 'screen'
          ? { screenId: 'checkout' }
          : kind === 'element-anchor'
            ? { screenId: 'checkout', elementId: 'submit' }
            : kind === 'review-decision'
              ? { reviewId: 'review-1', pinId: 'pin-1' }
              : undefined;
    const body = `private canonical body for ${kind}${anchor ? ` ${Object.values(anchor).join(' ')}` : ''}\n`;
    mkdirSync(join(root, 'sources'), { recursive: true });
    writeFileSync(join(root, path), body);
    return {
      id: `source-${String(index + 1).padStart(2, '0')}`,
      kind,
      path,
      revision: fixed('a'),
      digest: digest(body),
      ...(anchor ? { anchor } : {}),
    };
  });
  const requirements = requirementKinds.map((kind, index) => ({
    kind,
    statement: `Preserve ${kind} intent for café checkout ${index + 1}.`,
    sourceRefs: [sources[index].id, sources[index + 7].id],
    verification: [`Observe ${kind} behavior in the rendered checkout.`],
  }));
  const input = {
    id: 'checkout-implementation',
    version: 1,
    title: 'Checkout implementation package',
    basis: {
      designId: 'checkout',
      sourceRevision: fixed('a'),
      selectedVariant: 'direction-one',
      readiness: { status: 'ready', digest: fixed('b') },
      reviewHandoff: { version: 1, contentDigest: fixed('c') },
    },
    sources,
    requirements,
  };
  return { root, input };
}

test('composes all reference and requirement kinds without copying canonical bodies', () => {
  const { root, input } = fixture();
  try {
    const value = composeImplementationHandoff(input);
    assert.deepEqual(value.sources.map((source) => source.kind).sort(), [...sourceKinds].sort());
    assert.deepEqual(
      value.requirements.map((requirement) => requirement.kind).sort(),
      [...requirementKinds].sort(),
    );
    assert.equal(new Set(value.requirements.map((item) => item.id)).size, requirementKinds.length);
    assert.ok(
      value.requirements.every((item) => item.verification.length && item.sourceRefs.length),
    );
    assert.doesNotMatch(JSON.stringify(value), /private canonical body/u);
    verifyImplementationHandoffSources(value, createRepositorySourceResolver(root));
    assert.throws(
      () =>
        verifyImplementationHandoffSources(value, (path, source) => ({
          bytes: readFileSync(join(root, path)),
          anchors: source.anchor ? [] : undefined,
        })),
      /unresolved or ambiguous anchor/u,
    );
    verifyImplementationHandoffSources(value, (path, source) => ({
      bytes: readFileSync(join(root, path)),
      anchors: source.anchor ? [source.anchor] : undefined,
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requirement identities derive from canonical content and ordered references', () => {
  const base = {
    kind: 'behavior',
    statement: 'Keep checkout explicit.',
    sourceRefs: ['source-a', 'source-b'],
    verification: ['A confirmation is visible.'],
  };
  assert.equal(
    deriveImplementationRequirementId(base),
    deriveImplementationRequirementId({
      verification: ['A confirmation is visible.'],
      sourceRefs: ['source-a', 'source-b'],
      statement: 'Keep checkout explicit.',
      kind: 'behavior',
    }),
  );
  assert.notEqual(
    deriveImplementationRequirementId(base),
    deriveImplementationRequirementId({ ...base, sourceRefs: [...base.sourceRefs].reverse() }),
  );
  assert.match(deriveImplementationRequirementId(base), /^REQ-[0-9]{12}$/u);
  assert.equal(
    deriveImplementationRequirementId(base),
    deriveImplementationRequirementId({ ...base, statement: 'Keep checkout explicit.\r\n' }),
  );
});

test('JSON and Markdown exports are byte stable and exact across key and line-ending changes', () => {
  const { root, input } = fixture();
  try {
    input.requirements[0].statement = 'Keep the status explicit.\r\nDo not rely on color.';
    const first = composeImplementationHandoff(input);
    const second = composeImplementationHandoff(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(
      exportImplementationHandoffPackage(first),
      exportImplementationHandoffPackage(second),
    );
    const exported = exportImplementationHandoffPackage(first);
    const reorderedValue = Object.fromEntries(Object.entries(JSON.parse(exported.json)).reverse());
    const reordered = `${JSON.stringify(reorderedValue, null, 2)}\n`;
    assertImplementationHandoffProjection(JSON.parse(exported.json));
    assert.deepEqual(
      exportImplementationHandoffPackage(
        importImplementationHandoffPackage({ json: reordered, markdown: exported.markdown }),
      ),
      exported,
    );
    const imported = importImplementationHandoffPackage({
      json: exported.json,
      markdown: exported.markdown.replaceAll('\n', '\r\n'),
    });
    assert.deepEqual(exportImplementationHandoffPackage(imported), exported);
    assert.throws(() =>
      importImplementationHandoffPackage({
        json: exported.json,
        markdown: `${exported.markdown}\nindependent field`,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('portable import is offline while optional resolution detects substituted bytes', () => {
  const { root, input } = fixture();
  try {
    const value = composeImplementationHandoff(input);
    const portable = exportImplementationHandoffPackage(value);
    assert.deepEqual(importImplementationHandoffPackage(portable), value);
    writeFileSync(join(root, input.sources[0].path), 'substituted\n');
    assert.throws(
      () =>
        importImplementationHandoffPackage(portable, {
          resolveSource: createRepositorySourceResolver(root),
        }),
      /no longer matches/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hostile and foreign paths fail closed', () => {
  const { root, input } = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'openplanr-implementation-outside-'));
  try {
    for (const path of [
      '../secret',
      '/etc/passwd',
      'https://example.test/design',
      'user:pass@example.test/file',
      'file%2fescape',
    ])
      assert.throws(() =>
        composeImplementationHandoff({
          ...input,
          sources: [{ ...input.sources[0], path }, ...input.sources.slice(1)],
        }),
      );
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'sources', 'linked.txt'));
    assert.throws(() => createRepositorySourceResolver(root)('sources/linked.txt'), /outside/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('draft publication recovers one exact JSON and Markdown pair after interruption', () => {
  const { root, input } = fixture();
  try {
    const value = composeImplementationHandoff(input);
    writeImplementationHandoffDraft(root, value);
    assert.deepEqual(readImplementationHandoffDraft(root), value);
    const paths = implementationHandoffPaths(root);
    writeFileSync(paths.draftMarkdown, 'partial');
    writeFileSync(
      paths.journal,
      `${JSON.stringify({ package: value, markdown: value.markdown }, null, 2)}\n`,
    );
    assert.equal(recoverImplementationHandoffDraft(root), true);
    assert.deepEqual(readImplementationHandoffDraft(root), value);
    assert.equal(readFileSync(paths.draftMarkdown, 'utf8'), value.markdown);
    assert.equal(recoverImplementationHandoffDraft(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition leaves an existing review handoff byte-identical', () => {
  const { root, input } = fixture();
  try {
    const legacy = '{"kind":"openplanr-design-review-handoff","schemaVersion":"1.0.0"}\n';
    writeFileSync(join(root, 'review-handoff.json'), legacy);
    writeFileSync(join(root, 'review-handoff.md'), '# Existing review handoff\n');
    writeImplementationHandoffDraft(root, input);
    assert.equal(readFileSync(join(root, 'review-handoff.json'), 'utf8'), legacy);
    assert.equal(
      readFileSync(join(root, 'review-handoff.md'), 'utf8'),
      '# Existing review handoff\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('large requirement sets remain deterministic and package size ceilings fail closed', () => {
  const { root, input } = fixture();
  try {
    input.requirements = Array.from({ length: 1000 }, (_, index) => ({
      kind: requirementKinds[index % requirementKinds.length],
      statement: `Requirement ${index} preserves the reviewed behavior.`,
      sourceRefs: [input.sources[index % input.sources.length].id],
      verification: [`Expectation ${index} remains observable.`],
    }));
    const first = composeImplementationHandoff(input);
    const second = composeImplementationHandoff(structuredClone(input));
    assert.equal(first.contentDigest, second.contentDigest);
    assert.equal(new Set(first.requirements.map((item) => item.id)).size, 1000);

    input.requirements = Array.from({ length: 300 }, (_, index) => ({
      kind: 'behavior',
      statement: `Requirement ${index} ${'x'.repeat(10_000)}`,
      sourceRefs: [input.sources[0].id],
      verification: [`Expectation ${index} ${'y'.repeat(1000)}`],
    }));
    assert.throws(() => composeImplementationHandoff(input));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
