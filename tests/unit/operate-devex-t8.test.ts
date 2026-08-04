import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * A real pipeline root — the installed package copied whole — with exactly one
 * file rolled back to its v0.40.0 release: the advisor-response schema, the last
 * revision before the commitment-conflict branch. Copying the whole package
 * matters twice over: `resolvePipelinePackage` only accepts a root carrying the
 * bin and registry markers (a schemas-only directory is silently skipped, and the
 * seam then falls through to node_modules — which would quietly prove nothing),
 * and rolling back a single file is what isolates the schema as the gate.
 *
 * Originally this proof read whatever sat in node_modules, which held only while
 * the CLI's pin happened to be 0.40.0; bumping that pin (the 1.25.1 setup fix)
 * correctly falsified it. An old-reader invariant has to name the old revision.
 */
const OLD_READER_ROOT = mkdtempSync(join(tmpdir(), 'openplanr-t8-old-reader-'));
cpSync(INSTALLED_ROOT, OLD_READER_ROOT, { recursive: true });
writeFileSync(
  join(OLD_READER_ROOT, 'schemas', 'v1.4.0', 'operating-advisor-response.schema.json'),
  execFileSync(
    'git',
    ['-C', BRANCH_ROOT, 'show', 'v0.40.0:schemas/v1.4.0/operating-advisor-response.schema.json'],
    { encoding: 'utf8' },
  ),
);

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

  it('proof 3 — a pre-0.41.0 reader fails closed on the new shape (schema is the gate)', async () => {
    // Materialize the schema as released in v0.40.0 — the last revision before the
    // branch — into a throwaway pipeline root. Originally this proof read whatever
    // sat in node_modules, which passed only while the CLI's pin happened to be
    // 0.40.0; bumping that pin (the 1.25.1 setup fix) correctly falsified it. The
    // invariant being proved is about an OLD READER, so it must name the old
    // revision rather than inherit one by accident.
    const issues = await validateVia(OLD_READER_ROOT, oneKeyWithCommitment);
    // Verbatim: only the pre-branch schema (unconditional minItems: 2 +
    // additionalProperties:false on the conflict item) produces these direct
    // rules; the branch schema returns `[]` for the identical payload and the
    // identical CLI code. Their presence proves the schema, not the CLI, is the
    // gate that changed.
    expect(issues).toEqual([
      {
        path: '$.conflicts[0]',
        rule: 'additionalProperties',
        detail: "unknown property 'commitmentRef'",
      },
      { path: '$.conflicts[0].actionKeys', rule: 'minItems', detail: 'length 1 < 2' },
    ]);

    // The current installed pipeline is at or past the branch, so it accepts the
    // same payload — the two readers disagreeing is the compatibility story.
    const installedNow = await validateVia(INSTALLED_ROOT, oneKeyWithCommitment);
    expect(installedNow).toEqual([]);
  });
});
