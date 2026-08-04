import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T8 — action-versus-commitment conflicts.
 *
 * The Operating Board hit a real gap: the Chair found that shipping opt-in usage
 * telemetry (needed for the charter's adoption metric) contradicts the product's
 * published "No telemetry is added" commitment, but the advisor-response schema
 * could only express a conflict between two `actionKeys`. This suite proves, over
 * the SAME consumer code path the record and `harness validate` flows share
 * (`loadOperatingProtocol().validateProtocolArtifact('operating-advisor-response',
 * …)` — advisors.ts:544 / :1244), that:
 *
 *   1. a conflict with ONE actionKey + a `commitmentRef` validates,
 *   2. the same conflict WITHOUT `commitmentRef` still rejects (the two-action
 *      floor did not silently vanish),
 *   3. against the INSTALLED pipeline (node_modules 0.40.0, no schema change) the
 *      new shape rejects — so the gate is the schema revision, not CLI code.
 *
 * The seam is the existing `OPENPLANR_PIPELINE_ROOT`; nothing here reaches into
 * the pipeline by a relative path.
 */

const BRANCH_ROOT = process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');

// Published-precondition gate: proofs 1–2 need the pipeline revision that carries the
// commitment-conflict branch. Locally BRANCH_ROOT is the sibling working tree (has it);
// in CI the sibling is pinned to the last published tag, which predates it until the
// next pipeline release advances the pin. Feature-detect rather than fail — a red CI
// on an honest version-ordering constraint teaches nothing, and silently pointing the
// seam elsewhere would test the wrong artifact.
const branchSchemaPath = join(
  BRANCH_ROOT,
  'schemas',
  'v1.4.0',
  'operating-advisor-response.schema.json',
);
const branchHasCommitmentConflicts =
  existsSync(branchSchemaPath) && readFileSync(branchSchemaPath, 'utf8').includes('commitmentRef');
const INSTALLED_ROOT = resolve('node_modules/planr-pipeline');

interface ContractIssue {
  path: string;
  rule: string;
  detail: string;
}

const CITATION = {
  kind: 'repository',
  path: 'docs/CROSS_RUNTIME_SETUP.md',
  startLine: 1,
  endLine: 2,
  revision: 'a'.repeat(40),
} as const;

function chairResponse(conflicts: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    outcome: 'partial',
    analysisMarkdown:
      '## Chair synthesis\n\nMeasuring adoption requires telemetry the product has publicly promised never to add.',
    claims: [
      {
        id: 'claim-telemetry-ban',
        statement: 'The setup guide publishes the commitment that no telemetry is added.',
        epistemicStatus: 'observed',
        confidence: 5,
        citations: [CITATION],
      },
    ],
    actions: [],
    gaps: [],
    conflicts,
  };
}

const oneKeyWithCommitment = chairResponse([
  {
    id: 'conflict-telemetry',
    summary: 'Shipping opt-in usage telemetry contradicts the published no-telemetry commitment.',
    actionKeys: ['ship-usage-telemetry'],
    commitmentRef: {
      path: 'docs/CROSS_RUNTIME_SETUP.md',
      statement: 'No telemetry is added',
    },
  },
]);

const oneKeyNoCommitment = chairResponse([
  {
    id: 'conflict-telemetry',
    summary: 'Shipping opt-in usage telemetry contradicts the published no-telemetry commitment.',
    actionKeys: ['ship-usage-telemetry'],
  },
]);

const twoKeyNoCommitment = chairResponse([
  {
    id: 'conflict-lanes',
    summary: 'Two proposed actions compete for the same delivery lane.',
    actionKeys: ['ship-usage-telemetry', 'defer-telemetry-decision'],
  },
]);

async function validateVia(root: string | null, payload: unknown): Promise<ContractIssue[]> {
  vi.resetModules();
  if (root) {
    vi.stubEnv('OPENPLANR_PIPELINE_ROOT', root);
  } else {
    // Empty is falsy in the resolver, so the seam falls back to node_modules.
    vi.stubEnv('OPENPLANR_PIPELINE_ROOT', '');
  }
  const { loadOperatingProtocol } = await import('../../src/services/operate/protocol.js');
  const protocol = await loadOperatingProtocol();
  const issues = protocol.validateProtocolArtifact('operating-advisor-response', payload, {
    protocolVersion: '1.4.0',
  }) as ContractIssue[];
  vi.unstubAllEnvs();
  return issues;
}

describe('T8 action-versus-commitment conflict — consumer proofs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.skipIf(!branchHasCommitmentConflicts)(
    'proof 1 — one actionKey + commitmentRef validates on the branch schema',
    async () => {
      const issues = await validateVia(BRANCH_ROOT, oneKeyWithCommitment);
      // Verbatim: the branch schema accepts a commitment conflict with one action.
      expect(issues).toEqual([]);
    },
  );

  it.skipIf(!branchHasCommitmentConflicts)(
    'proof 2 — the same conflict WITHOUT commitmentRef still rejects (floor intact)',
    async () => {
      const issues = await validateVia(BRANCH_ROOT, oneKeyNoCommitment);
      // Verbatim: the conflict item matched neither the two-action branch
      // (minItems: 2) nor the commitment branch (requires commitmentRef), so the
      // floor did not silently vanish. The minimal validator collapses the two
      // sub-branch failures into one `oneOf` issue at $.conflicts[0].
      expect(issues).toEqual([
        {
          path: '$.conflicts[0]',
          rule: 'oneOf',
          detail:
            'matched 0/2 branches (expected exactly 1). Branches: action-vs-action conflict | action-vs-commitment conflict',
        },
      ]);

      // And a well-formed two-action conflict with no commitmentRef is unchanged.
      const twoKey = await validateVia(BRANCH_ROOT, twoKeyNoCommitment);
      expect(twoKey).toEqual([]);
    },
  );

  it('proof 3 — the installed 0.40.0 pipeline rejects the new shape (schema is the gate)', async () => {
    const issues = await validateVia(null, oneKeyWithCommitment);
    // Verbatim: only the OLD schema (unconditional minItems: 2 +
    // additionalProperties:false on the conflict item) produces these direct
    // rules; the branch schema returns `[]` for the identical payload and the
    // identical CLI code. Their presence proves the installed schema, not the
    // CLI, is the gate that changed.
    expect(issues).toEqual([
      {
        path: '$.conflicts[0]',
        rule: 'additionalProperties',
        detail: "unknown property 'commitmentRef'",
      },
      { path: '$.conflicts[0].actionKeys', rule: 'minItems', detail: 'length 1 < 2' },
    ]);

    // Pointing the identical CLI at node_modules explicitly rejects the same way,
    // confirming the unset-seam resolution above landed on 0.40.0.
    const installed = await validateVia(INSTALLED_ROOT, oneKeyWithCommitment);
    expect(installed).toEqual(issues);
  });
});

// Orchestrator addition (T8 follow-through): a commitment conflict that records but
// renders without its commitment is recorded-but-not-surfaced — the failure class
// this batch removes. The conversion at normalizeAgentNativeResponse is the single
// site where conflicts collapse to rendered strings; every downstream surface
// (engine record body, report.md, report --html) inherits this line.
import { normalizeAgentNativeResponse } from '../../src/services/operate/advisors.js';

describe('commitment conflicts surface in rendered output (T8 rendering thread)', () => {
  it('threads the commitment statement and path into the rendered conflict line', () => {
    const rendered = normalizeAgentNativeResponse(
      {
        outcome: 'actions',
        analysisMarkdown: 'x',
        claims: [],
        actions: [],
        gaps: [],
        conflicts: [
          {
            id: 'cf-telemetry',
            summary: 'Opt-in telemetry is needed to measure adoption',
            actionKeys: ['ship-opt-in-usage-telemetry'],
            commitmentRef: {
              path: 'docs/CROSS_RUNTIME_SETUP.md',
              statement: 'No telemetry is added.',
            },
          },
          { id: 'cf-plain', summary: 'Two actions compete', actionKeys: ['a', 'b'] },
        ],
      },
      '0'.repeat(40),
    );
    expect(rendered.conflicts[0]).toContain('No telemetry is added.');
    expect(rendered.conflicts[0]).toContain('docs/CROSS_RUNTIME_SETUP.md');
    // An action-vs-action conflict renders exactly as before — no format churn.
    expect(rendered.conflicts[1]).toBe('Two actions compete');
  });
});
