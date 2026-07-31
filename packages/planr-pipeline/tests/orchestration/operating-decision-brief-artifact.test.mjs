import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOperatingDecisionBriefArtifact } from '../../lib/operate/decision-brief-artifact.mjs';
import { validateArtifactEnvelope, digestArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';

const brief = {
  id: 'operating-decision-brief-CYCLE-011',
  title: 'Should we invest a cycle in onboarding retry copy?',
  question: 'Do we fix the onboarding retry messaging now, or defer to next cycle?',
  evidence: [
    'Activation drops 12% after the first failed retry.',
    'The retry copy has not changed since launch.',
  ],
  options: [
    { label: 'Fix now', detail: 'Ship a bounded copy change this cycle.' },
    { label: 'Defer', detail: 'Revisit after the pricing experiment concludes.' },
  ],
  blocks: 'Blocks **FND-014** from routing to a quick task.',
};

const decision = {
  status: 'open',
  owner: 'founder',
  recommendation: 'Fix now — the change is small, reversible, and evidence-backed.',
};

test('produces an envelope that validates against artifact-envelope@1.1.0', () => {
  const envelope = createOperatingDecisionBriefArtifact(brief, decision);
  // The envelope must pass both the canonical envelope validator and the
  // protocol-registry validation for artifact-envelope@1.1.0.
  assert.doesNotThrow(() => validateArtifactEnvelope(envelope));
  assert.doesNotThrow(() => assertProtocolArtifact('artifact-envelope', envelope, { protocolVersion: '1.1.0' }));
  assert.equal(envelope.artifacts.length, 1);
  const [artifact] = envelope.artifacts;
  assert.equal(artifact.kind, 'html');
  assert.equal(artifact.id, 'operating-decision-brief-CYCLE-011');
  assert.equal(envelope.viewer.mode, 'single');
  assert.equal(envelope.viewer.presentation, 'document');
  assert.equal(envelope.viewer.activeArtifactId, artifact.id);
});

test('the rendered HTML contains zero external URL references', () => {
  const envelope = createOperatingDecisionBriefArtifact(brief, decision);
  const { html } = envelope.artifacts[0];
  assert.equal(/https?:\/\//i.test(html), false, 'brief HTML must not reference any http(s) resource');
  // The brief content must still be present so the owner can read it offline.
  assert.match(html, /onboarding retry messaging/);
  assert.match(html, /<strong>FND-014<\/strong>/);
  assert.match(html, /<h2>Options<\/h2>/);
});

test('the offline guard fails closed when content carries a remote reference', () => {
  assert.throws(
    () => createOperatingDecisionBriefArtifact({
      title: 'Leaky brief',
      evidence: 'See the dashboard at https://example.com/metrics for the figures.',
    }),
    (error) => error.code === 'E_OPERATE_DECISION_BRIEF_NOT_OFFLINE',
  );
});

test('rendering the same brief/decision twice is byte-identical (deterministic)', () => {
  const first = createOperatingDecisionBriefArtifact(brief, decision);
  const second = createOperatingDecisionBriefArtifact(brief, decision);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(digestArtifactEnvelope(first), digestArtifactEnvelope(second));
  assert.equal(first.artifacts[0].sha256, second.artifacts[0].sha256);
});

test('renders a brief without a decision, and escapes untrusted content', () => {
  const envelope = createOperatingDecisionBriefArtifact({
    title: 'Ship the <script>alert(1)</script> guardrail?',
    question: 'Is the guardrail worth the latency?',
  });
  assert.doesNotThrow(() => validateArtifactEnvelope(envelope));
  const { html } = envelope.artifacts[0];
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('requires a brief object with a non-empty title', () => {
  assert.throws(() => createOperatingDecisionBriefArtifact(null), (e) => e.code === 'E_OPERATE_DECISION_BRIEF_INVALID');
  assert.throws(() => createOperatingDecisionBriefArtifact({}), (e) => e.code === 'E_OPERATE_DECISION_BRIEF_INVALID');
  assert.throws(
    () => createOperatingDecisionBriefArtifact({ title: 'ok' }, []),
    (e) => e.code === 'E_OPERATE_DECISION_BRIEF_INVALID',
  );
});
