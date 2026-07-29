import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/services/operate/canonical.js';
import { consolidateOperatingResults } from '../../src/services/operate/consolidation.js';
import { buildChairEvidence } from '../../src/services/operate/engine.js';
import { evidenceFingerprintItems } from '../../src/services/operate/evidence.js';
import type {
  OperatingConfig,
  OperatingEvidence,
  OperatingRoleId,
  OperatingRoleResult,
} from '../../src/services/operate/types.js';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const now = '2026-07-28T12:00:00.000Z';

function config(overrides: Partial<OperatingConfig['caps']> = {}): OperatingConfig {
  return {
    kind: 'operating-config',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    profile: 'saas',
    decisionOwner: 'Product owner',
    cadence: 'manual',
    planningEngine: 'openplanr',
    enabledRoles: ['technology-risk', 'product-activation', 'chair'],
    enabledProviders: ['repository'],
    caps: {
      surfacedFindings: 12,
      newSpecs: 12,
      openDecisions: 5,
      agentArtifacts: 4,
      ...overrides,
    },
    budgets: {
      maxFiles: 1_000,
      maxItems: 2_000,
      maxBytes: 10 * 1024 * 1024,
      maxDurationMs: 60_000,
    },
  };
}

function evidence(): OperatingEvidence {
  return {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: digest('a'),
    collectedAt: now,
    truncated: false,
    items: [
      {
        id: 'EVD-critical',
        source: 'repository',
        location: 'security.json',
        digest: digest('b'),
        collectedAt: now,
        observedFrom: now,
        observedTo: now,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['verified-risk:security'],
      },
      {
        id: 'EVD-fresh',
        source: 'repository',
        location: 'fresh.json',
        digest: digest('c'),
        collectedAt: now,
        observedFrom: now,
        observedTo: now,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['repository:code'],
      },
      {
        id: 'EVD-stale',
        source: 'repository',
        location: 'stale.json',
        digest: digest('d'),
        collectedAt: '2026-06-01T12:00:00.000Z',
        observedFrom: null,
        observedTo: null,
        freshness: 'stale',
        sensitivity: 'internal',
        claimTypes: ['repository:code'],
      },
      {
        id: 'EVD-confidential',
        source: 'repository',
        location: 'private-metrics.json',
        digest: digest('f'),
        collectedAt: now,
        observedFrom: now,
        observedTo: now,
        freshness: 'fresh',
        sensitivity: 'confidential',
        claimTypes: ['product:activation'],
      },
    ],
    sources: [
      {
        id: 'repository',
        fingerprint: digest('e'),
        status: 'collected',
        itemCount: 4,
        byteCount: 400,
      },
    ],
    warnings: [],
  };
}

function result(
  roleId: OperatingRoleId,
  proposals: OperatingRoleResult['proposals'],
  conflicts: string[] = [],
): OperatingRoleResult {
  return {
    kind: 'operating-role-result',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    roleId,
    inputDigest: digest('f'),
    resultDigest: digest('0'),
    outcome: proposals.length > 0 ? 'proposals' : 'quiet',
    proposals,
    gaps: [],
    conflicts,
    producer: {
      product: 'fixture',
      version: '1.0.0',
      runtime: 'fixture',
      capability: 'analysis-high',
    },
  };
}

function proposal(
  key: string,
  title: string,
  evidenceRefs: string[],
  overrides: Partial<OperatingRoleResult['proposals'][number]> = {},
): OperatingRoleResult['proposals'][number] {
  return {
    proposalKey: key,
    type: 'finding',
    title,
    problem: `Problem for ${title}`,
    proposal: `Resolve ${title}`,
    impact: 3,
    confidence: 3,
    ease: 3,
    severity: 'medium',
    evidenceRefs,
    ...overrides,
  };
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

describe('deterministic Operating Board consolidation', () => {
  it('binds evidence sensitivity into collection fingerprints', () => {
    const original = evidence().items.find((item) => item.id === 'EVD-fresh');
    if (!original) throw new Error('Missing evidence identity fixture.');
    const reclassified = { ...original, sensitivity: 'confidential' as const };

    expect(canonicalDigest(evidenceFingerprintItems([original]))).not.toBe(
      canonicalDigest(evidenceFingerprintItems([reclassified])),
    );
  });

  it('inherits the highest sensitivity from every cited evidence item', async () => {
    const consolidated = await consolidateOperatingResults({
      cycleId: 'CYCLE-001',
      results: [
        result('product-activation', [
          proposal('sensitive', 'Review private activation evidence', [
            'EVD-fresh',
            'EVD-confidential',
          ]),
        ]),
      ],
      evidence: evidence(),
      config: config(),
      now,
    });

    expect(consolidated.findings).toEqual([
      expect.objectContaining({
        sensitivity: 'confidential',
        evidenceRefs: ['EVD-confidential', 'EVD-fresh'],
      }),
    ]);
  });

  it('changes finding identity when cited evidence is reclassified upward', async () => {
    const originalEvidence = evidence();
    const reclassifiedEvidence = structuredClone(originalEvidence);
    const reclassifiedItem = reclassifiedEvidence.items.find((item) => item.id === 'EVD-fresh');
    if (!reclassifiedItem) throw new Error('Missing reclassification fixture.');
    reclassifiedItem.sensitivity = 'confidential';
    const results = [
      result('product-activation', [
        proposal('reclassified', 'Review reclassified evidence', ['EVD-fresh']),
      ]),
    ];

    const [original, reclassified] = await Promise.all([
      consolidateOperatingResults({
        cycleId: 'CYCLE-001',
        results,
        evidence: originalEvidence,
        config: config(),
        now,
      }),
      consolidateOperatingResults({
        cycleId: 'CYCLE-001',
        results,
        evidence: reclassifiedEvidence,
        config: config(),
        now,
      }),
    ]);

    expect(original.findings[0]).toMatchObject({ sensitivity: 'internal' });
    expect(reclassified.findings[0]).toMatchObject({ sensitivity: 'confidential' });
    expect(reclassified.findings[0]?.fingerprint).not.toBe(original.findings[0]?.fingerprint);
  });

  it('preserves transitive sensitivity when the Chair cites synthetic advisor evidence', async () => {
    const productResult = result('product-activation', [
      proposal('private-activation', 'Review private activation evidence', ['EVD-confidential']),
    ]);
    const chairEvidence = buildChairEvidence(evidence(), [productResult], now);
    const synthetic = chairEvidence.items.find(
      (item) => item.id === 'EVD-advisor-results-product-activation-private-activation',
    );
    const consolidated = await consolidateOperatingResults({
      cycleId: 'CYCLE-001',
      results: [
        result('chair', [
          proposal('chair-private-activation', 'Prioritize private activation review', [
            'EVD-advisor-results-product-activation-private-activation',
          ]),
        ]),
      ],
      evidence: chairEvidence,
      config: config(),
      now,
    });

    expect(synthetic).toMatchObject({ sensitivity: 'confidential' });
    expect(consolidated.findings).toEqual([
      expect.objectContaining({
        sensitivity: 'confidential',
        evidenceRefs: ['EVD-advisor-results-product-activation-private-activation'],
      }),
    ]);
  });

  it('rejects findings whose cited evidence is unavailable', async () => {
    await expect(
      consolidateOperatingResults({
        cycleId: 'CYCLE-001',
        results: [
          result('product-activation', [
            proposal('missing', 'Review missing evidence', ['EVD-missing']),
          ]),
        ],
        evidence: evidence(),
        config: config(),
        now,
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_EVIDENCE_REJECTED',
      message: expect.stringContaining('EVD-missing'),
    });
  });

  it('is byte-equivalent across result and proposal arrival permutations', async () => {
    const duplicateLow = proposal('duplicate-low', 'Protect tenant keys', ['EVD-critical'], {
      impact: 4,
      confidence: 3,
      ease: 2,
      severity: 'medium',
    });
    const duplicateCritical = proposal(
      'duplicate-critical',
      '  Protect   tenant keys ',
      ['EVD-critical', 'EVD-fresh'],
      {
        problem: ' Problem for Protect tenant keys ',
        proposal: ' Resolve Protect tenant keys ',
        impact: 5,
        confidence: 5,
        ease: 4,
        severity: 'critical',
      },
    );
    const stale = proposal('stale', 'Stale equal score', ['EVD-stale'], {
      impact: 3,
      confidence: 3,
      ease: 2,
      severity: 'high',
    });
    const fresh = proposal('fresh', 'Fresh equal score', ['EVD-fresh'], {
      impact: 3,
      confidence: 2,
      ease: 3,
      severity: 'high',
    });
    const base = [
      result('product-activation', [duplicateLow, stale]),
      result('technology-risk', [duplicateCritical, fresh]),
    ];

    const outputs = [];
    for (const ordering of permutations(base)) {
      const withReversedProposals = ordering.map((entry, index) => ({
        ...entry,
        proposals: index % 2 === 0 ? [...entry.proposals].reverse() : entry.proposals,
      }));
      outputs.push(
        await consolidateOperatingResults({
          cycleId: 'CYCLE-001',
          results: withReversedProposals,
          evidence: evidence(),
          config: config(),
          now,
        }),
      );
    }

    expect(outputs.every((output) => JSON.stringify(output) === JSON.stringify(outputs[0]))).toBe(
      true,
    );
    expect(outputs[0]?.findings[0]).toMatchObject({
      title: 'Protect tenant keys',
      severity: 'critical',
      criticalOverride: true,
      impact: 5,
      ease: 4,
      owner: 'technology-risk',
      evidenceRefs: ['EVD-critical', 'EVD-fresh'],
    });
    const highTitles = outputs[0]?.findings
      .filter((finding) => finding.severity === 'medium')
      .map((finding) => finding.title);
    expect(highTitles).toEqual(['Fresh equal score', 'Stale equal score']);
  });

  it('withholds verified critical proposals that lack technology-risk coverage', async () => {
    const consolidated = await consolidateOperatingResults({
      cycleId: 'CYCLE-001',
      results: [
        result('product-activation', [
          proposal('critical', 'Rotate tenant credentials', ['EVD-critical'], {
            impact: 5,
            confidence: 5,
            ease: 2,
            severity: 'critical',
          }),
        ]),
      ],
      evidence: evidence(),
      config: config(),
      now,
    });

    expect(consolidated.findings).toEqual([]);
    expect(consolidated.gaps).toEqual([
      expect.objectContaining({
        affectedRoles: ['technology-risk'],
        question: expect.stringContaining('technology-risk review'),
      }),
    ]);
  });

  it('fails with exact critical-cap diagnostics instead of hiding verified risks', async () => {
    const criticals = [
      proposal('one', 'Critical one', ['EVD-critical'], {
        impact: 5,
        confidence: 5,
        ease: 5,
        severity: 'critical',
      }),
      proposal('two', 'Critical two', ['EVD-critical'], {
        impact: 5,
        confidence: 5,
        ease: 4,
        severity: 'critical',
      }),
    ];

    await expect(
      consolidateOperatingResults({
        cycleId: 'CYCLE-001',
        results: [result('technology-risk', criticals)],
        evidence: evidence(),
        config: config({ surfacedFindings: 1 }),
        now,
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_CRITICAL_CAP',
      details: {
        criticalFindingIds: ['FND-001', 'FND-002'],
        configuredCap: 1,
        routeApplicationAllowed: false,
      },
    });
  });
});
