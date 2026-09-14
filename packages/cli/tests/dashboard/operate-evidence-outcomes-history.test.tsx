// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import {
  assertOperateExperienceTransportView,
  selectOperateExperienceAuditDisplaySurface,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateAuditDisplayBindingV1,
  type OperateExperienceAuditDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { EvidencePage } from '../../../../apps/dashboard/src/features/operate/evidence/EvidencePage.js';
import { createOperateEvidenceDisplayValidator } from '../../../../apps/dashboard/src/features/operate/evidence/evidence-model.js';
import { HistoryPage } from '../../../../apps/dashboard/src/features/operate/history/HistoryPage.js';
import { createOperateHistoryDisplayValidator } from '../../../../apps/dashboard/src/features/operate/history/history-model.js';
import { OutcomesPage } from '../../../../apps/dashboard/src/features/operate/outcomes/OutcomesPage.js';
import { createOperateOutcomeDisplayValidator } from '../../../../apps/dashboard/src/features/operate/outcomes/outcome-model.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

type AuditDisplay = Readonly<OperateExperienceAuditDisplaySurfaceV1>;
type AuditSurface = AuditDisplay['requestBinding']['surface'];

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'evidence/EvidencePage.tsx',
  'evidence/audit-records.tsx',
  'outcomes/OutcomesPage.tsx',
  'history/HistoryPage.tsx',
]
  .map((file) =>
    readFileSync(
      resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/operate', file),
      'utf8',
    ),
  )
  .join('\n');
const AUDIT_STYLES = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/operate/operate.css'),
  'utf8',
);
const TAMPER_SENTINEL = 'UNVERIFIED_TAMPER_MUST_NOT_RENDER';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const PROJECT_HASH = sha256Jcs({ project: 't019-dashboard-audit-ui' } as never);
const CYCLE_ID = 'cycle-audit-1';
const EVIDENCE_ID = 'evidence-available';
const RESTRICTED_EVIDENCE_ID = 'evidence-restricted';
const CLAIM_ID = 'claim-retention';
const OUTCOME_ID = 'outcome-retention';
const ACTION_ID = 'act_audit_00000001';
const VERIFICATION_ID = 'verification-retention';
const PRIVATE_LINK_MARKER = 'private-missing-link-must-not-cross-audit-selection';
const HTML_MARKER = '<img src=x onerror="globalThis.__auditInjected=true">';
const GENERATED_AT = '2026-08-11T08:00:00.000Z';
const EVENT_HEAD = Object.freeze({ sequence: 1, hash: HASH_A });

function historyEvent() {
  return {
    eventId: 'event-audit-1',
    sequence: 1,
    type: 'cycle.started',
    entityId: CYCLE_ID,
    actorKind: 'engine',
    actorId: 'openplanr',
    timestamp: GENERATED_AT,
    correlationId: 'correlation-audit-1',
    eventHash: HASH_A,
    change: { subjectKind: 'cycle', summary: 'Retention Cycle started.' },
    why: 'The owner started the exact Cycle.',
    authority: null,
    evidenceRefIds: [EVIDENCE_ID],
    prior: { previousEventHash: null, causationId: null },
    result: null,
    next: null,
    deepLinks: [`#/operate/evidence/${EVIDENCE_ID}`, `#/operate/actions/${PRIVATE_LINK_MARKER}`],
    beforeAfter: null,
  };
}

function evidence(evidenceRefId: string, restricted: boolean) {
  return {
    evidenceRefId,
    classification: restricted ? 'restricted' : 'internal',
    accessState: restricted ? 'restricted' : 'available',
    freshness: 'current',
    evidenceKind: restricted ? null : 'operate-artifact',
    resolvedAt: restricted ? null : GENERATED_AT,
    claimStatus: restricted ? 'restricted' : 'supported',
    supportClaimIds: restricted ? [] : [CLAIM_ID],
    contradictClaimIds: [],
    source: null,
    producer: null,
    observedAt: restricted ? null : GENERATED_AT,
    scope: { scopeId: 'scope-audit', domainId: 'business', domainVersion: '1.0.0' },
    sensitivity: restricted ? 'restricted' : 'internal',
    provenance: null,
    confidence: restricted ? null : 0.91,
    gaps: [],
    errors: [],
    accessReason: restricted ? 'access-denied' : null,
    causalLinks: [],
    deepLink: `#/operate/evidence/${evidenceRefId}`,
  };
}

function action() {
  return {
    actionId: ACTION_ID,
    revision: 1,
    actionHash: HASH_A,
    title: 'Measure retention without inventing success',
    state: 'completed',
    ownerActorId: 'owner-audit',
    expectedResult: 'The exact Outcome remains evidence-bound.',
    verificationPlanId: VERIFICATION_ID,
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_audit_00000001',
      scopeId: 'scope-audit',
      domainId: 'business',
      domainVersion: '1.0.0',
      action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
      eventHead: { ...EVENT_HEAD },
      route: 'observe-only',
      rationale: 'The audit representation is read-only.',
      createdAt: GENERATED_AT,
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${ACTION_ID}`,
  };
}

function metric() {
  return {
    metricId: 'metric-retention',
    title: 'Retention rate',
    value: null,
    unit: 'percent',
    change: null,
    window: '30 days',
    freshness: 'unknown',
    state: 'unavailable',
    target: 93,
    threshold: 90,
    evidenceRefIds: [],
    snapshot: null,
    delta: null,
    dueVerification: [
      {
        verificationPlanId: VERIFICATION_ID,
        actionId: ACTION_ID,
        state: 'insufficient-evidence',
        dueAt: null,
        window: '30 days',
        deepLink: `#/operate/actions/${ACTION_ID}`,
      },
    ],
    accessReason: null,
  };
}

function outcome() {
  return {
    outcomeId: OUTCOME_ID,
    actionId: ACTION_ID,
    verificationPlanId: VERIFICATION_ID,
    status: 'insufficient-evidence',
    metric: {
      metricId: 'metric-retention',
      metricHash: HASH_B,
      baseline: 89,
      target: 93,
      observed: null,
      unit: 'percent',
      window: '30 days',
      dueAt: null,
      freshness: 'unknown',
      confidence: null,
    },
    observationIds: [],
    evidenceRefIds: [],
    observedAt: GENERATED_AT,
    decision: {
      decisionId: 'decision-retention',
      revision: 1,
      state: 'approved',
      deepLink: '#/operate/inbox/decision-retention',
    },
    execution: [
      {
        resultId: 'result-retention',
        operationId: 'operation-retention',
        status: 'succeeded',
        completedAt: GENERATED_AT,
        effectSummary: {
          changed: true,
          summary: 'The contained effect completed; its Outcome remains unverified.',
          affectedTargetIds: ['target-retention'],
        },
        targetBeforeHash: HASH_A,
        targetAfterHash: HASH_C,
        accessReason: null,
        deepLink: '#/operate/history/operation-retention',
      },
    ],
    rollback: [],
    verification: {
      verificationPlanId: VERIFICATION_ID,
      verificationPlanHash: HASH_C,
      metricId: 'metric-retention',
      metricHash: HASH_B,
      method: 'Wait for one accepted observation.',
      evaluationRules: ['Do not infer success without an observation.'],
      observationRequest: {
        kind: 'future-observation',
        reason: 'Observe one full retention window.',
      },
      accessReason: null,
    },
    nextObservation: {
      kind: 'future-observation',
      reason: 'Observe one full retention window.',
      dueAt: null,
    },
    revisit: {
      decisionIds: ['decision-retention'],
      conditions: ['The target remains unobserved.'],
    },
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: `#/operate/outcomes/${OUTCOME_ID}`,
  };
}

function experienceView() {
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_audit_1234567890abcdef',
    scopeId: 'scope-audit',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-audit',
    accessLevel: 'internal',
    generatedAt: GENERATED_AT,
    eventHead: { ...EVENT_HEAD },
    sourceStateHash: HASH_B,
    status: 'ready',
    attention: [],
    domainMetrics: [metric()],
    cycles: [
      {
        cycleId: CYCLE_ID,
        state: 'approved',
        health: 'normal',
        focus: ['Retention'],
        createdAt: GENERATED_AT,
        updatedAt: GENERATED_AT,
        stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
          (id, index) => ({
            id,
            state: index < 4 ? 'complete' : index === 4 ? 'current' : 'waiting',
            reason: null,
            inputArtifactIds: [],
            outputArtifactIds: [],
            gates: [],
            evidenceGapIds: [],
            uncertaintyIds: [],
            persistentActionIds: [],
          }),
        ),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [ACTION_ID],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${CYCLE_ID}`,
      },
    ],
    inbox: [],
    actions: [action()],
    evidence: [evidence(RESTRICTED_EVIDENCE_ID, true), evidence(EVIDENCE_ID, false)],
    claims: [
      {
        claimId: CLAIM_ID,
        status: 'supported',
        epistemicStatus: 'strongly-supported',
        statement: `Retention improved after onboarding changes. ${HTML_MARKER}`,
        supportEvidenceRefIds: [EVIDENCE_ID],
        contradictEvidenceRefIds: [],
        source: null,
        producer: null,
        observedAt: GENERATED_AT,
        scope: { scopeId: 'scope-audit', domainId: 'business', domainVersion: '1.0.0' },
        sensitivity: 'internal',
        provenance: null,
        confidence: 0.91,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: `#/operate/evidence/${CLAIM_ID}`,
      },
    ],
    rationale: [],
    outcomes: [outcome()],
    learnings: [],
    history: [historyEvent()],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: 1,
        eventCount: 1,
        eventReplayIndexHash: HASH_A,
      },
      finalHead: { ...EVENT_HEAD },
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_B,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: true,
      },
      filterDimensions: ['cycle', 'actor', 'event-type'],
      redactions: [{ classification: 'restricted', count: 1, reason: 'access-denied' }],
    },
    allowedActions: [],
    omissions: [{ classification: 'restricted', count: 1, reason: 'access-denied' }],
    export: { formats: ['html', 'json'], accessSafe: true, redactionCount: 1 },
  };
  return Object.freeze({ ...base, viewHash: sha256Jcs(base as never) });
}

function identityFor(
  surface: AuditSurface,
  detailSubjectId: string | null = null,
): DashboardQueryIdentity {
  const view = experienceView();
  const route =
    surface === 'evidence'
      ? detailSubjectId
        ? `#/operate/evidence/${encodeURIComponent(detailSubjectId)}`
        : '#/operate/evidence'
      : surface === 'outcomes'
        ? '#/operate/outcomes'
        : surface === 'outcome'
          ? `#/operate/outcomes/${OUTCOME_ID}`
          : '#/operate/history';
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId: view.actorId,
    projectId: PROJECT_HASH,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: CYCLE_ID,
    subjectId: surface === 'outcome' ? OUTCOME_ID : surface === 'evidence' ? detailSubjectId : null,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
    generation: 1,
  });
}

function selectDisplay(current: DashboardQueryIdentity, surface: AuditSurface): AuditDisplay {
  const view = experienceView();
  assertOperateExperienceTransportView(view);
  const binding: OperateAuditDisplayBindingV1 = Object.freeze({
    actorId: current.actorId,
    scopeId: current.scopeId,
    domainId: current.domainId,
    domainVersion: current.domainVersion,
    cycleId: CYCLE_ID,
    subjectId: surface === 'outcome' || surface === 'evidence' ? current.subjectId : null,
    surface,
    query: null,
    format: null,
    generatedAt: view.generatedAt,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
  });
  const selected = selectOperateExperienceAuditDisplaySurface(view, {
    surface,
    binding,
    subjectId: binding.subjectId,
    cycleId: binding.cycleId,
    query: '',
    format: 'json',
  });
  return assertOperateExperienceAuditDisplaySurfaceV1(selected, binding);
}

function validatorFor(current: DashboardQueryIdentity, surface: AuditSurface) {
  if (surface === 'evidence') return createOperateEvidenceDisplayValidator(current);
  if (surface === 'outcomes' || surface === 'outcome') {
    return createOperateOutcomeDisplayValidator(current);
  }
  return createOperateHistoryDisplayValidator(current);
}

function stateFor(
  current: DashboardQueryIdentity,
  display: unknown,
  surface: AuditSurface,
): DashboardProductState<AuditDisplay> {
  return parseDashboardProductState<AuditDisplay>(
    {
      kind: 'ready',
      binding: current,
      data: structuredClone(display),
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: current, validateData: validatorFor(current, surface) },
  );
}

function mutation<T>(value: T, change: (draft: T) => void): T {
  const draft = structuredClone(value);
  change(draft);
  return draft;
}

function runAxeClean(html: string): Promise<axe.AxeResults> {
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>Audit</title></head><body><main>${html}</main></body></html>`,
  );
  return axe
    .run(dom.window.document.documentElement, {
      rules: { 'color-contrast': { enabled: false } },
    })
    .finally(() => {
      dom.window.close();
    });
}

describe('T-019 Evidence Outcomes and History UI', () => {
  it('renders owner-issued classification, insufficient evidence, and replay proof', () => {
    const evidenceBinding = identityFor('evidence');
    const evidenceHtml = renderToStaticMarkup(
      <EvidencePage
        currentBinding={evidenceBinding}
        current={stateFor(evidenceBinding, selectDisplay(evidenceBinding, 'evidence'), 'evidence')}
      />,
    );
    expect(evidenceHtml).toContain(EVIDENCE_ID);
    expect(evidenceHtml).toContain(RESTRICTED_EVIDENCE_ID);
    expect(evidenceHtml).toContain('restricted');
    expect(evidenceHtml).toContain('available');
    expect(evidenceHtml).toContain('&lt;img src=x');
    expect(evidenceHtml).not.toContain(PRIVATE_LINK_MARKER);
    expect(evidenceHtml).not.toContain('cannot be trusted');

    const outcomesBinding = identityFor('outcomes');
    const outcomesHtml = renderToStaticMarkup(
      <OutcomesPage
        currentBinding={outcomesBinding}
        current={stateFor(outcomesBinding, selectDisplay(outcomesBinding, 'outcomes'), 'outcomes')}
      />,
    );
    expect(outcomesHtml).toContain('insufficient evidence');
    expect(outcomesHtml).toContain(OUTCOME_ID);

    const historyBinding = identityFor('history');
    const historyHtml = renderToStaticMarkup(
      <HistoryPage
        currentBinding={historyBinding}
        current={stateFor(historyBinding, selectDisplay(historyBinding, 'history'), 'history')}
      />,
    );
    expect(historyHtml).toContain('The owner started the exact Cycle.');
    expect(historyHtml).toContain('Replay proof');
    expect(historyHtml).toContain(HASH_A);
    expect(historyHtml).not.toContain(PRIVATE_LINK_MARKER);
    expect(historyHtml).not.toContain('dangerouslySetInnerHTML');
  });

  it('refuses a schema-shaped content mutation before product state', () => {
    const current = identityFor('evidence');
    const tampered = mutation(selectDisplay(current, 'evidence'), (display) => {
      if (display.payload.surface !== 'evidence') throw new Error('Expected evidence.');
      Reflect.set(display.payload.data.evidence[1], 'evidenceRefId', TAMPER_SENTINEL);
    });
    expect(() => stateFor(current, tampered, 'evidence')).toThrow(/owner-boundary contract/u);
  });

  it('refuses the whole route before any child for an unbranded lookalike', () => {
    const current = identityFor('history');
    const trusted = stateFor(current, selectDisplay(current, 'history'), 'history');
    const unbranded = Object.freeze({ ...trusted, data: trusted.data });
    const html = renderToStaticMarkup(<HistoryPage currentBinding={current} current={unbranded} />);
    expect(html).toContain('History cannot be trusted');
    expect(html).not.toContain('<header');
    expect(html).not.toContain(TAMPER_SENTINEL);
  });

  it('reaches Evidence, Outcomes, and History through UnifiedShell', () => {
    const cases = [
      {
        hash: '#/operate/evidence',
        surface: 'evidence' as const,
        expected: 'Evidence',
      },
      {
        hash: `#/operate/evidence/${EVIDENCE_ID}`,
        surface: 'evidence' as const,
        subjectId: EVIDENCE_ID,
        expected: 'Evidence item',
      },
      {
        hash: '#/operate/outcomes',
        surface: 'outcomes' as const,
        expected: 'insufficient evidence',
      },
      {
        hash: '#/operate/history',
        surface: 'history' as const,
        expected: 'Replay proof',
      },
    ];
    for (const entry of cases) {
      const binding = identityFor(entry.surface, entry.subjectId ?? null);
      const html = renderToStaticMarkup(
        <DashboardProviders
          connection={{
            state: 'connected',
            label: 'Connected',
            reason: 'Verified test connection.',
          }}
          buildId="t019-audit-ui"
          initialHash={entry.hash}
          binding={binding}
          projection={stateFor(binding, selectDisplay(binding, entry.surface), entry.surface)}
        >
          <UnifiedShell />
        </DashboardProviders>,
      );
      expect(html).toContain(entry.expected);
      expect(html).not.toContain('Unified boot and first use');
    }
  });

  it('keeps the evidence desk keyboard-semantic and axe-clean', async () => {
    const current = identityFor('evidence');
    const html = renderToStaticMarkup(
      <EvidencePage
        currentBinding={current}
        current={stateFor(current, selectDisplay(current, 'evidence'), 'evidence')}
      />,
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<dl');
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>Evidence</title></head><body>${html}</body></html>`,
    );
    expect(dom.window.document.querySelectorAll('h1')).toHaveLength(1);
    expect((await runAxeClean(html)).violations).toEqual([]);
  });

  it('keeps the evidence item desk keyboard-semantic and axe-clean', async () => {
    const current = identityFor('evidence', EVIDENCE_ID);
    const html = renderToStaticMarkup(
      <EvidencePage
        currentBinding={current}
        current={stateFor(current, selectDisplay(current, 'evidence'), 'evidence')}
      />,
    );
    expect(html).toContain('Evidence item');
    expect(html).toContain(EVIDENCE_ID);
    expect(html).not.toContain('Claims');
    expect((await runAxeClean(html)).violations).toEqual([]);
  });

  it('keeps the history timeline keyboard-semantic and axe-clean', async () => {
    const current = identityFor('history');
    const html = renderToStaticMarkup(
      <HistoryPage
        currentBinding={current}
        current={stateFor(current, selectDisplay(current, 'history'), 'history')}
      />,
    );
    expect(html).toContain('Replay proof');
    expect(html).toContain('<dl');
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>History</title></head><body>${html}</body></html>`,
    );
    expect(dom.window.document.querySelectorAll('h1')).toHaveLength(1);
    expect((await runAxeClean(html)).violations).toEqual([]);
  });

  it('preserves responsive record wrapping and readable progressive disclosure', () => {
    expect(AUDIT_STYLES).toMatch(/\.pc-operate__records\s*\{[\s\S]*display: grid/u);
    expect(AUDIT_STYLES).toMatch(/\.pc-operate__record-head\s*\{[\s\S]*flex-wrap: wrap/u);
    expect(AUDIT_STYLES).toMatch(/\.pc-operate__record-title\s*\{[\s\S]*overflow-wrap: anywhere/u);
    expect(AUDIT_STYLES).toMatch(/\.pc-operate__technical > summary\s*\{[\s\S]*cursor: pointer/u);
  });

  it('does not retain browser lexical privacy or lifecycle authority', () => {
    expect(PRODUCTION_SOURCE).not.toMatch(
      /isAccessSafe|normalizeBrowser|containsPrivate|PRIVATE_BODY|dangerouslySetInnerHTML/u,
    );
    expect(PRODUCTION_SOURCE).not.toMatch(/useState|useEffect/u);
  });
});
