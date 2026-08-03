import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDecisionBriefInput,
  chairBoardGapLines,
  classifyChairRoleContributions,
  type DecisionBriefSource,
  filterEvidenceByCeiling,
  OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX,
  readOperatingSensitivityCeiling,
  renderChairBoardSummary,
  renderOperatingDecisionBriefArtifact,
  writeOperatingDecisionBriefArtifact,
} from '../../src/services/operate/decision-brief.js';
import { assembleChairBoardInput } from '../../src/services/operate/engine.js';
import { buildOperatingIntegritySummary } from '../../src/services/operate/integrity.js';
import type {
  OperatingEvidence,
  OperatingRoleId,
  OperatingRoleResult,
  OperatingState,
} from '../../src/services/operate/types.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'openplanr-decision-brief-')));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function decisionSource(overrides: Partial<DecisionBriefSource> = {}): DecisionBriefSource {
  return {
    kind: 'decision',
    id: 'DEC-001',
    cycleId: 'CYCLE-001',
    title: 'DEC-001 — Should we instrument activation before scope expansion?',
    question: 'Should we instrument activation before scope expansion?',
    evidence: [
      { ref: 'EV-public', sensitivity: 'public' },
      { ref: 'EV-internal', sensitivity: 'internal' },
      { ref: 'EV-confidential', sensitivity: 'confidential' },
      { ref: 'EV-restricted', sensitivity: 'restricted' },
    ],
    options: [
      { label: 'Instrument first', detail: 'Ship one bounded instrumentation spec.' },
      { label: 'Expand scope now' },
    ],
    blocks:
      'This decision blocks the following until it is made:\n- FND-001\n\nDelays the Q3 activation review.',
    decision: {
      status: 'open',
      owner: 'Product owner',
      recommendation: 'Instrument first',
      reversibility: 'reversible',
      deadline: '2026-08-15',
    },
    ...overrides,
  };
}

describe('operate decision-brief rendering (FR7/E-007)', () => {
  it('reuses the opaque-origin sandbox contract shape (network/filesystem/tools none)', () => {
    expect(OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX).toEqual({
      network: 'none',
      filesystem: 'none',
      tools: [],
      allowedUrlSchemes: [],
    });
    expect(Object.isFrozen(OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX)).toBe(true);
  });

  it('drops evidence above the configured ceiling and keeps the rest in order', () => {
    const { kept, redactedRefs } = filterEvidenceByCeiling(decisionSource().evidence, 'internal');
    expect(kept.map((item) => item.ref)).toEqual(['EV-public', 'EV-internal']);
    expect(redactedRefs).toEqual(['EV-confidential', 'EV-restricted']);
  });

  it('filters above-ceiling evidence and redacts free text before the renderer sees it', () => {
    const { brief, redactedEvidenceRefs } = buildDecisionBriefInput(
      decisionSource({
        summary: 'Contact owner@example.com for context.',
      }),
      'internal',
    );
    expect(brief.evidence).toEqual(['EV-public', 'EV-internal']);
    expect(redactedEvidenceRefs).toEqual(['EV-confidential', 'EV-restricted']);
    expect(brief.summary).toBe('Contact [REDACTED_EMAIL] for context.');
  });

  it('renders a self-contained, offline decision artifact with question, evidence, options, and what it blocks', async () => {
    const rendered = await renderOperatingDecisionBriefArtifact(decisionSource(), 'internal');
    expect(rendered.offline).toBe(true);
    expect(rendered.envelope.artifacts).toHaveLength(1);
    const html = rendered.html;
    // Fully offline: no remote CSS/JS/font of any kind.
    expect(/https?:\/\//i.test(html)).toBe(false);
    // The owner can read the question, cited evidence, options, and blockers.
    expect(html).toContain('Should we instrument activation before scope expansion?');
    expect(html).toContain('EV-public');
    expect(html).toContain('EV-internal');
    expect(html).toContain('Instrument first');
    expect(html).toContain('Expand scope now');
    expect(html).toContain('FND-001');
    expect(html).toContain('Instrument first'); // recommendation
    // Above-ceiling citations never surface.
    expect(html).not.toContain('EV-confidential');
    expect(html).not.toContain('EV-restricted');
    expect(rendered.redactedEvidenceRefs).toEqual(['EV-confidential', 'EV-restricted']);
    expect(rendered.sandbox).toBe(OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX);
  });

  it('renders deterministically for the same input', async () => {
    const first = await renderOperatingDecisionBriefArtifact(decisionSource(), 'internal');
    const second = await renderOperatingDecisionBriefArtifact(decisionSource(), 'internal');
    expect(first.html).toBe(second.html);
    expect(first.sha256).toBe(second.sha256);
  });

  it('fails closed via the pipeline error when brief content references an http(s) URL', async () => {
    await expect(
      renderOperatingDecisionBriefArtifact(
        decisionSource({ summary: 'See the report at https://example.com/report for details.' }),
        'internal',
      ),
    ).rejects.toMatchObject({ code: 'E_OPERATE_DECISION_BRIEF_NOT_OFFLINE' });
  });

  it('renders a cycle brief (no decision) offline as well', async () => {
    const rendered = await renderOperatingDecisionBriefArtifact(
      {
        kind: 'brief',
        id: 'operating-brief-CYCLE-001',
        cycleId: 'CYCLE-001',
        title: 'OpenPlanr Operating Brief — CYCLE-001',
        summary: 'Cycle CYCLE-001. Evidence freshness: fresh.',
        question: 'Current constraint: activation has no verified baseline',
        evidence: [{ ref: 'EV-internal', sensitivity: 'internal' }],
        options: [
          { label: 'FND-001: Instrument activation', detail: 'DEV · product — Ship a spec.' },
        ],
        blocks: 'Owner decisions pending:\n- DEC-001: Should we instrument first?',
      },
      'internal',
    );
    expect(/https?:\/\//i.test(rendered.html)).toBe(false);
    expect(rendered.html).toContain('OpenPlanr Operating Brief');
    expect(rendered.html).toContain('FND-001: Instrument activation');
  });

  it('writes the rendered brief to a project-contained path only when asked (share-on-request)', async () => {
    const projectRoot = await temporaryDirectory();
    const written = await writeOperatingDecisionBriefArtifact({
      projectRoot,
      destination: 'briefs/decision.html',
      source: decisionSource(),
      ceiling: 'internal',
    });
    expect(written.path).toBe(path.join(projectRoot, 'briefs', 'decision.html'));
    expect(written.sensitivityCeiling).toBe('internal');
    const onDisk = await readFile(written.path, 'utf8');
    expect(onDisk).toBe(written.html);
    expect(/https?:\/\//i.test(onDisk)).toBe(false);
    const info = await stat(written.path);
    // The renderer requests a restrictive 0o600 write (see
    // writeOperatingDecisionBriefArtifact). POSIX permission bits are only
    // meaningful where the OS honors them: on Windows, NTFS does not implement
    // the Unix mode, so Node reports 0o666 (438) regardless of the requested
    // mode. Assert the restrictive-write contract only where it is enforceable
    // rather than accommodate a value the platform cannot produce.
    if (process.platform !== 'win32') {
      expect(info.mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a destination that escapes the project', async () => {
    const projectRoot = await temporaryDirectory();
    await expect(
      writeOperatingDecisionBriefArtifact({
        projectRoot,
        destination: '../escape.html',
        source: decisionSource(),
        ceiling: 'internal',
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PATH_ESCAPE' });
  });

  it('resolves the machine-local sensitivity ceiling, defaulting to internal', async () => {
    const projectRoot = await temporaryDirectory();
    const localRoot = await temporaryDirectory();
    expect(await readOperatingSensitivityCeiling(projectRoot, { localRoot })).toBe('internal');
  });
});

// FR13 — the Chair's input over a partial, honestly-labelled board. These exercise
// the single six-way classifier both the Chair's grounded evidence and any
// Chair-adjacent rendering consume, so the decision brief and the Chair's own input
// can never disagree on a role's outcome.
const now = '2026-07-28T12:00:00.000Z';
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function chairEvidence(evidenceIds: string[]): OperatingEvidence {
  return {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: digest('a'),
    collectedAt: now,
    truncated: false,
    items: evidenceIds.map((id) => ({
      id,
      source: 'repository',
      location: `${id}.json`,
      digest: digest('b'),
      collectedAt: now,
      observedFrom: now,
      observedTo: now,
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['repository:code'],
    })),
    sources: [],
    warnings: [],
  };
}

function chairProposal(
  key: string,
  evidenceRefs: string[],
): OperatingRoleResult['proposals'][number] {
  return {
    proposalKey: key,
    type: 'finding',
    title: `Finding ${key}`,
    problem: `Problem ${key}`,
    proposal: `Resolve ${key}`,
    impact: 3,
    confidence: 3,
    ease: 3,
    severity: 'medium',
    evidenceRefs,
  };
}

function chairResult(
  roleId: OperatingRoleId,
  proposals: OperatingRoleResult['proposals'],
  outcome: OperatingRoleResult['outcome'] = proposals.length > 0 ? 'proposals' : 'quiet',
): OperatingRoleResult {
  return {
    kind: 'operating-role-result',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    roleId,
    inputDigest: digest('f'),
    resultDigest: digest('0'),
    outcome,
    proposals,
    gaps: [],
    conflicts: [],
    producer: {
      product: 'fixture',
      version: '1.0.0',
      runtime: 'fixture',
      capability: 'analysis-high',
    },
  };
}

// Build the committed integrity summary the way reports.ts does — from governed
// data gaps — so the classifier reads exactly what the honest report reads.
function integrityFromGaps(
  gaps: Array<{
    id: string;
    category: 'missing-evidence' | 'unresolvable-citation' | 'boundary-refusal';
    reason: string;
    question: string;
    affectedRoles: string[];
  }>,
): ReturnType<typeof buildOperatingIntegritySummary> {
  const state = {
    dataGaps: gaps.map((gap) => ({
      id: gap.id,
      cycleId: 'CYCLE-001',
      category: gap.category,
      reason: gap.reason,
      question: gap.question,
      affectedRoles: gap.affectedRoles,
      status: 'open',
    })),
  } as unknown as OperatingState;
  return buildOperatingIntegritySummary(state, 'CYCLE-001');
}

const FIVE_ROLES: OperatingRoleId[] = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
];

describe('Chair input over partial, honestly-labelled boards (FR13)', () => {
  it('labels a not-evaluated role with its real governed reason and never fabricates its conclusion', () => {
    const notEvaluatedReason =
      'Every citation technology-risk returned failed to resolve at the pinned revision.';
    const integrity = integrityFromGaps([
      {
        id: 'GAP-not-eval',
        category: 'missing-evidence',
        reason: notEvaluatedReason,
        question: 'What evidence can technology-risk cite?',
        affectedRoles: ['technology-risk'],
      },
    ]);
    // technology-risk committed a schema-legal `quiet` result; its governed gap is
    // the source of truth that promotes it to not-evaluated (mirrors reports.ts).
    const results = [
      chairResult('strategy-finance', [chairProposal('sf-1', ['EVD-a'])]),
      chairResult('product-activation', [chairProposal('pa-1', ['EVD-a'])]),
      chairResult('growth-market', [chairProposal('gm-1', ['EVD-a'])]),
      chairResult('operations-customer', [chairProposal('oc-1', ['EVD-a'])]),
      chairResult('technology-risk', [], 'quiet'),
    ];
    const input = assembleChairBoardInput(chairEvidence(['EVD-a']), results, now, {
      expectedRoles: FIVE_ROLES,
      integrity,
    });

    const cto = input.contributions.find((entry) => entry.roleId === 'technology-risk');
    expect(cto?.outcome).toBe('not-evaluated');
    expect(cto?.reason).toBe(notEvaluatedReason);
    expect(cto?.gapId).toBe('GAP-not-eval');
    // Chair's synthesis surfaces it as a named gap carrying the REAL reason.
    const gapLine = input.gaps.find((line) => line.startsWith('technology-risk'));
    expect(gapLine).toContain(notEvaluatedReason);
    expect(gapLine).toContain('do not synthesize its conclusions.');
    // Non-fabrication: no synthetic proposal item invents a technology-risk
    // conclusion in the grounded evidence Chair may cite.
    const groundedIds = input.evidence.items.map((item) => item.id);
    expect(groundedIds.some((id) => id.startsWith('EVD-advisor-results-technology-risk-'))).toBe(
      true, // only the context item, never a proposal
    );
    expect(
      groundedIds.filter(
        (id) =>
          id.startsWith('EVD-advisor-results-technology-risk-') &&
          id !== 'EVD-advisor-results-technology-risk-context',
      ),
    ).toEqual([]);
  });

  it('distinguishes a still-running role from a failed one, never conflating them', () => {
    const results = [
      chairResult('strategy-finance', [chairProposal('sf-1', ['EVD-a'])]),
      // growth-market recorded nothing and has no terminal governed signal → running.
      // operations-customer failed with a real dispatch error.
    ];
    const input = assembleChairBoardInput(chairEvidence(['EVD-a']), results, now, {
      expectedRoles: ['strategy-finance', 'growth-market', 'operations-customer'],
      failedReasons: {
        'operations-customer': 'The adapter session timed out after three retries.',
      },
    });

    const running = input.contributions.find((entry) => entry.roleId === 'growth-market');
    const failed = input.contributions.find((entry) => entry.roleId === 'operations-customer');
    expect(running?.outcome).toBe('still-running');
    expect(failed?.outcome).toBe('failed');
    expect(running?.outcome).not.toBe(failed?.outcome);
    expect(failed?.reason).toBe('The adapter session timed out after three retries.');
    // Both are surfaced as named gaps, distinctly.
    expect(input.gaps.some((line) => /growth-market is still running/.test(line))).toBe(true);
    expect(
      input.gaps.some((line) =>
        /operations-customer failed before recording an analysis/.test(line),
      ),
    ).toBe(true);
  });

  it('excludes citation-rejected proposals from the grounded input while naming the rejection', () => {
    const integrity = integrityFromGaps([
      {
        id: 'GAP-cite',
        category: 'unresolvable-citation',
        reason: 'fabricated-path',
        question: 'The cited path src/missing.ts does not exist at the pinned revision.',
        affectedRoles: ['strategy-finance'],
      },
    ]);
    // strategy-finance grounded a valid proposal AND returned one whose citation the
    // gate rejected (the shape of enforceProposalCitations().rejected[].proposalKey).
    const results = [
      chairResult('strategy-finance', [
        chairProposal('sf-valid', ['EVD-a']),
        chairProposal('sf-rejected', ['EVD-should-not-appear']),
      ]),
    ];
    const input = assembleChairBoardInput(chairEvidence(['EVD-a']), results, now, {
      expectedRoles: ['strategy-finance'],
      integrity,
      rejectedProposalKeys: { 'strategy-finance': ['sf-rejected'] },
    });

    const groundedIds = input.evidence.items.map((item) => item.id);
    // FR8: the one invalid citation is dropped; the valid proposal is NOT.
    expect(groundedIds).toContain('EVD-advisor-results-strategy-finance-sf-valid');
    expect(groundedIds).not.toContain('EVD-advisor-results-strategy-finance-sf-rejected');
    // The unavailable evidence the rejected proposal cited never reaches Chair.
    expect(groundedIds).not.toContain('EVD-should-not-appear');
    const sf = input.contributions.find((entry) => entry.roleId === 'strategy-finance');
    expect(sf?.outcome).toBe('recorded-evaluated');
    expect(sf?.excludedProposalKeys).toEqual(['sf-rejected']);
    // The rejection is named, never silently dropped.
    expect(input.gaps.join('\n')).toContain('sf-rejected');
  });

  it('labels a role whose every proposal was citation-rejected as citation-rejected, not quiet', () => {
    const integrity = integrityFromGaps([
      {
        id: 'GAP-cite-all',
        category: 'unresolvable-citation',
        reason: 'fabricated-path',
        question: 'Every citation product-activation returned failed to resolve.',
        affectedRoles: ['product-activation'],
      },
    ]);
    const results = [
      chairResult('product-activation', [chairProposal('pa-rejected', ['EVD-missing'])]),
    ];
    const input = assembleChairBoardInput(chairEvidence(['EVD-a']), results, now, {
      expectedRoles: ['product-activation'],
      integrity,
      rejectedProposalKeys: { 'product-activation': ['pa-rejected'] },
    });
    const pa = input.contributions.find((entry) => entry.roleId === 'product-activation');
    expect(pa?.outcome).toBe('citation-rejected');
    expect(pa?.reason).toContain('fabricated-path');
    // No proposal item survives into the grounded input.
    expect(
      input.evidence.items.some((item) =>
        item.id.startsWith('EVD-advisor-results-product-activation-pa-rejected'),
      ),
    ).toBe(false);
  });

  it('synthesizes the valid board with no fabricated gap when all five roles recorded and evaluated', () => {
    const results = FIVE_ROLES.map((roleId) =>
      chairResult(roleId, [chairProposal(`${roleId}-1`, ['EVD-a'])]),
    );
    const input = assembleChairBoardInput(chairEvidence(['EVD-a']), results, now, {
      expectedRoles: FIVE_ROLES,
    });
    expect(input.contributions.map((entry) => entry.outcome)).toEqual([
      'recorded-evaluated',
      'recorded-evaluated',
      'recorded-evaluated',
      'recorded-evaluated',
      'recorded-evaluated',
    ]);
    // No fabricated gap: a clean, complete board produces an empty gap list.
    expect(input.gaps).toEqual([]);
    // Every role's real analysis is included as citable evidence.
    for (const roleId of FIVE_ROLES) {
      expect(input.evidence.items.map((item) => item.id)).toContain(
        `EVD-advisor-results-${roleId}-${roleId}-1`,
      );
    }
  });

  it('renders one Chair-adjacent per-role summary all surfaces share', () => {
    const contributions = classifyChairRoleContributions(
      [
        chairResult('strategy-finance', [chairProposal('sf-1', ['EVD-a'])]),
        chairResult('technology-risk', [], 'quiet'),
      ],
      {
        expectedRoles: ['strategy-finance', 'technology-risk', 'growth-market'],
        failedReasons: {},
      },
    );
    const summary = renderChairBoardSummary(contributions);
    expect(summary).toContain('**strategy-finance** — recorded-evaluated');
    expect(summary).toContain('**technology-risk** — recorded-quiet');
    expect(summary).toContain('**growth-market** — still-running');
    // The gap lines and the summary derive from the SAME classification.
    expect(
      chairBoardGapLines(contributions).some((line) => /growth-market is still running/.test(line)),
    ).toBe(true);
  });
});
