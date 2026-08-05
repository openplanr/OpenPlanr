import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectBriefContractViolations,
  createRegistryReconciledAdvisorBrief,
  type OperatingMandate,
  routeKindToProposalType,
} from '../../src/services/operate/advisors.js';
import {
  isPlanrArtifactId,
  PLANR_ARTIFACT_CLASS_PREFIXES,
} from '../../src/services/operate/artifacts.js';
import { canonicalize } from '../../src/services/operate/canonical.js';
import { assertOperatingCitationAnchor } from '../../src/services/operate/citation-resolution.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { operateAdapterLifecycle } from '../../src/services/operate/maintenance.js';
import { PUBLIC_OPERATING_PROJECTION_PATHS } from '../../src/services/operate/projection-persistence.js';
import { loadOperatingProtocol } from '../../src/services/operate/protocol.js';
import {
  assertGitCitationRepositoryPath,
  assertGitCitationRevision,
} from '../../src/services/operate/read-only-providers.js';
import type {
  OperatingAdvisorBrief,
  OperatingConfig,
  OperatingRoleId,
  OperatingRoleResult,
} from '../../src/services/operate/types.js';
import {
  buildWorkspaceManifest,
  resolveOperatingPaths,
  writeOperatingConfig,
} from '../../src/services/operate/workspace.js';

// ---------------------------------------------------------------------------
// T6 — cross-component conformance.
//
// Tonight twelve operating defects shared one root cause: two components of the
// SAME product disagreeing with each other. This suite asserts the agreement so
// any future skew is a red CI run, not a live-cycle discovery. Each `describe`
// encodes one such invariant and cites the concrete defect it defends against.
//
// PIPELINE READ SURFACE (deliberate): every pipeline read here is against the
// INSTALLED `node_modules/planr-pipeline` (a stable 0.40.0 tree), never the
// sibling `../planr-pipeline` checkout a protocol agent may be mutating. We pin
// the protocol/mandate/registry loader to that same tree so the registry file
// we read raw and the briefs the loader builds come from one source of truth.
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);
const PIPELINE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'node_modules',
  'planr-pipeline',
);
const REGISTRY_PATH = join(PIPELINE_ROOT, 'registry', 'operating-roles.json');
const READER_PATH = join(PIPELINE_ROOT, 'lib', 'dashboard', 'operate-reader.mjs');
const VALID_REVISION = 'a'.repeat(40);
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

interface RegistryRole {
  id: string;
  allowedRouteKinds: string[];
  budgets: { maxActions: number; maxOutputBytes: number };
}

interface DashboardReader {
  readOperatingProjection: (planrDir: string) => { path: string; status: string };
  OPERATING_CHECKPOINT_RELATIVE_PATH: string;
}

interface PrepareResult {
  roles: string[];
  mandates: Record<string, OperatingMandate>;
}

const temporaryDirectories: string[] = [];

// The record-path enforcer only reads each proposal's `type`; a minimal
// `{outcome, proposals}` is a faithful input for the bound checks.
const asRoleOutput = (
  outcome: 'proposals' | 'quiet',
  proposals: Array<{ type: string }>,
): Pick<OperatingRoleResult, 'outcome' | 'proposals'> =>
  ({ outcome, proposals }) as unknown as Pick<OperatingRoleResult, 'outcome' | 'proposals'>;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function operatingConfig(enabledRoles: OperatingRoleId[]): OperatingConfig {
  return {
    kind: 'operating-config',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    profile: 'saas',
    decisionOwner: 'Owner',
    cadence: 'manual',
    planningEngine: 'openplanr',
    enabledRoles,
    enabledProviders: ['repository', 'git'],
    caps: { surfacedFindings: 5, newSpecs: 2, openDecisions: 5, agentArtifacts: 3 },
    budgets: { maxFiles: 100, maxItems: 100, maxBytes: 2 * 1024 * 1024, maxDurationMs: 10_000 },
  } as OperatingConfig;
}

/**
 * A cycle in `advising` state on a real git repository, with the top-level tree
 * seeded with the dot-prefixed roots (`.github`, `.changeset`) whose citability
 * was the invariant-1 defect, so a real `harness prepare` derives them as mandate
 * boundary roots. Mirrors the operate suites' advising-cycle fixture.
 */
async function advisingCycleFixture(
  enabledRoles: OperatingRoleId[],
): Promise<{ projectRoot: string; localRoot: string; evidenceDigest: `sha256:${string}` }> {
  const projectRoot = await temporaryDirectory('openplanr-xcomponent-project-');
  const localRoot = await temporaryDirectory('openplanr-xcomponent-local-');

  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/openplanr/xcomponent-fixture.git'],
    { cwd: projectRoot },
  );
  // Seed a spread of top-level roots including the dot-prefixed ones that were
  // uncitable tonight, plus a plain source root, so the derived boundary roots are
  // representative rather than a single directory.
  for (const [directory, file] of [
    ['src', 'service.ts'],
    ['docs', 'README.md'],
    ['.github', 'CODEOWNERS'],
    ['.changeset', 'config.json'],
  ] as const) {
    await mkdir(join(projectRoot, directory), { recursive: true });
    await writeFile(join(projectRoot, directory, file), `content for ${directory}\n`);
  }
  await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });

  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const manifest = await buildWorkspaceManifest(projectRoot, [], {
    localRoot,
    persistRoots: true,
    capturedAt: '2026-07-28T09:00:00.000Z',
  });
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.workspace, `${canonicalize(manifest)}\n`);
  await writeOperatingConfig(projectRoot, operatingConfig(enabledRoles), { localRoot });
  await writeFile(
    paths.charter,
    [
      '# Operating charter',
      '',
      '## Product context',
      '- Purpose: Test cross-component conformance',
      '- Stage: growth',
      '',
      '## Current goals',
      '- Keep components in agreement',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(paths.localRoot, 'preferences.json'),
    `${JSON.stringify({ runtime: 'auto', sensitivityCeiling: 'internal' })}\n`,
  );

  const store = new OperatingEventStore(projectRoot, { localRoot });
  let head: `sha256:${string}` | null = null;
  const append = async (
    type: Parameters<OperatingEventStore['append']>[0]['type'],
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      correlationId: 'xcomponent-test',
      expectedHead: head,
      timestamp: '2026-07-28T09:00:00.000Z',
      evidenceRefs: type === 'evidence.collected' ? ['EVD-git', 'EVD-repository'] : undefined,
      payload,
    });
    head = event.eventHash;
  };
  await append('cycle.preparing', {
    record: {
      kind: 'operating-cycle-manifest',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      id: 'CYCLE-001',
      state: 'preparing',
      health: 'normal',
      depth: 'standard',
      focus: ['all'],
      inputDigest: digest('a'),
      enabledRoles,
      enabledProviders: ['repository'],
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      producer: { product: 'openplanr', version: '1.24.0', runtime: 'claude' },
    },
  });
  await append('cycle.collecting', {});
  const evidenceDigest = digest('e');
  const collectedAt = '2026-07-28T09:00:00.000Z';
  const evidence = {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: evidenceDigest,
    collectedAt,
    truncated: false,
    items: [
      {
        id: 'EVD-repository',
        source: 'repository',
        location: 'src/service.ts',
        digest: digest('b'),
        collectedAt,
        observedFrom: null,
        observedTo: null,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['code', 'architecture'],
        summary: 'The runtime adapter exposes a read-only advisory boundary.',
      },
      {
        id: 'EVD-git',
        source: 'git',
        location: 'history/30d',
        digest: digest('c'),
        collectedAt,
        observedFrom: '2026-06-28T09:00:00.000Z',
        observedTo: collectedAt,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['change-history'],
        summary: 'Recent changes added deterministic operating contracts.',
      },
    ],
    sources: [
      {
        id: 'repository',
        fingerprint: digest('d'),
        status: 'collected',
        itemCount: 1,
        byteCount: 64,
      },
      { id: 'git', fingerprint: digest('f'), status: 'collected', itemCount: 1, byteCount: 64 },
    ],
    warnings: [],
  };
  const record = await store.putRecord('evidence-metadata', evidence, {
    correlationId: 'xcomponent-test',
    createdAt: collectedAt,
  });
  await append('evidence.collected', {
    recordDigest: record.digest,
    sources: evidence.sources.map((source) => ({
      id: source.id,
      freshness: 'fresh',
      status: source.status,
      itemCount: source.itemCount,
    })),
  });
  await append('cycle.advising', {});
  return { projectRoot, localRoot, evidenceDigest };
}

// Fixture-derived state built once (the two harness prepares are the only heavy
// setup) and shared across invariants 1 and 5.
let reader: DashboardReader;
let registry: RegistryRole[];
let advisorMandates: Record<string, OperatingMandate>;
let chairMandate: OperatingMandate;
let mandateBoundaryRoots: string[];

beforeAll(async () => {
  // Pin ALL pipeline resolution to the installed tree (see header rationale).
  process.env.OPENPLANR_PIPELINE_ROOT = PIPELINE_ROOT;
  reader = (await import(READER_PATH)) as unknown as DashboardReader;
  registry = (JSON.parse(await readFile(REGISTRY_PATH, 'utf8')) as { roles: RegistryRole[] }).roles;

  const advisorFixture = await advisingCycleFixture([
    'strategy-finance',
    'technology-risk',
    'product-activation',
    'growth-market',
    'operations-customer',
    'chair',
  ]);
  const advisorPrepared = (await operateAdapterLifecycle({
    projectRoot: advisorFixture.projectRoot,
    localRoot: advisorFixture.localRoot,
    action: 'prepare',
    cycleId: 'CYCLE-001',
    evidenceDigest: advisorFixture.evidenceDigest,
    idempotencyKey: 'xcomponent-advisors',
  })) as PrepareResult;
  advisorMandates = advisorPrepared.mandates;
  mandateBoundaryRoots = [
    ...new Set(Object.values(advisorMandates).flatMap((mandate) => mandate.boundaries.roots)),
  ].sort();

  const chairFixture = await advisingCycleFixture(['strategy-finance', 'chair']);
  const chairPrepared = (await operateAdapterLifecycle({
    projectRoot: chairFixture.projectRoot,
    localRoot: chairFixture.localRoot,
    action: 'prepare',
    cycleId: 'CYCLE-001',
    evidenceDigest: chairFixture.evidenceDigest,
    idempotencyKey: 'xcomponent-chair',
    role: 'chair',
  })) as PrepareResult;
  chairMandate = chairPrepared.mandates.chair;
}, 120_000);

afterAll(async () => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

// Invariant 1 — DEFECT: a real `harness prepare` authorized 14 read roots but the
// record-time citation anchor rejected 6 of them (the dot-prefixed `.github`,
// `.planr`, `.changeset`, …), so an advisor could not cite what its own mandate
// told it to read. Every declared root MUST be anchorable.
describe('invariant 1: every mandate boundary root is anchorable by the record-time citation anchor', () => {
  it('derives dot-prefixed roots from a real prepare (else the check is vacuous)', () => {
    // A prepare that never produced the dot-prefixed roots could not exercise the
    // defect — assert the fixture actually authorized them.
    expect(mandateBoundaryRoots).toEqual(
      expect.arrayContaining(['.planr', '.github', '.changeset', 'src']),
    );
  });

  it('accepts a repository citation into every authorized root', () => {
    expect(mandateBoundaryRoots.length).toBeGreaterThan(0);
    for (const root of mandateBoundaryRoots) {
      // Construct a repository citation that reads a file under the granted root
      // and assert the anchor the record path uses accepts it verbatim.
      expect(
        () =>
          assertOperatingCitationAnchor({
            repositoryPath: `${root}/probe.ts`,
            pinnedRevision: VALID_REVISION,
          }),
        `root ${root} must be citable`,
      ).not.toThrow();
    }
  });
});

// Invariant 2 — DEFECT: the registry granted the Chair seven route kinds while the
// enforced runtime brief allowed only `['merge','sequence']`, disjoint from what
// every Chair action maps to (`finding`/`decision`), so the Chair could record
// ZERO routes. The T5 describe in operate-adapter-mission-dispatch.test.ts already
// binds the DECLARED brief to `protocol.listOperatingRoles()`; this asserts the
// COMPLEMENTARY halves it does not: (a) the shipped registry FILE agrees with the
// loader, and (b) the registry cap/type image binds the actual record-path
// ENFORCER, not just the declared brief value. No hardcoded role list.
describe('invariant 2: the shipped registry binds the runtime brief enforcer (complements T5)', () => {
  it('the shipped registry file and the protocol loader agree on the role set', async () => {
    const protocol = await loadOperatingProtocol();
    const loaderIds = protocol
      .listOperatingRoles()
      .map((role) => role.id)
      .sort();
    const fileIds = registry.map((role) => role.id).sort();
    expect(fileIds.length).toBeGreaterThan(0);
    expect(loaderIds).toEqual(fileIds);
  });

  it('every registry role: maxActions and routeKind image are the caps the enforcer applies', async () => {
    const protocol = await loadOperatingProtocol();
    for (const role of registry) {
      const brief = createRegistryReconciledAdvisorBrief(protocol, role.id);
      const maxActions = role.budgets.maxActions;
      const image = [...new Set(role.allowedRouteKinds.map(routeKindToProposalType))].sort();

      // The declared cap is the registry's verbatim, and every action-reachable
      // type the registry admits is in the allowed set (image ⊆ allowed).
      expect(brief.output.maximumProposals, `maximumProposals for ${role.id}`).toBe(maxActions);
      for (const type of image) {
        expect(
          brief.output.allowedProposalTypes,
          `${role.id} allows reachable type ${type}`,
        ).toContain(type);
      }

      // The record-path enforcer binds to those SAME values: exactly `maxActions`
      // image-typed proposals pass; one more trips the cap; a type outside the
      // allowed set trips the type check. This is the surface that rejected the
      // Chair tonight — not the declared brief value T5 checks.
      const imageType = image[0];
      const atCap = collectBriefContractViolations(
        brief,
        asRoleOutput(
          'proposals',
          Array.from({ length: maxActions }, () => ({ type: imageType })),
        ),
      );
      expect(atCap, `${role.id} at cap`).toEqual([]);

      const overCap = collectBriefContractViolations(
        brief,
        asRoleOutput(
          'proposals',
          Array.from({ length: maxActions + 1 }, () => ({ type: imageType })),
        ),
      );
      expect(
        overCap.some((issue) => issue.rule === 'maximumProposals'),
        `${role.id} over cap`,
      ).toBe(true);

      const disallowed = collectBriefContractViolations(
        brief,
        asRoleOutput('proposals', [{ type: '__unregistered-type__' }]),
      );
      expect(
        disallowed.some((issue) => issue.rule === 'allowedProposalTypes'),
        `${role.id} bad type`,
      ).toBe(true);
    }
  });

  it('non-vacuity: the disjoint Chair brief tonight shipped is genuinely rejected by the same enforcer', async () => {
    const protocol = await loadOperatingProtocol();
    const realChair = createRegistryReconciledAdvisorBrief(protocol, 'chair');
    // A consolidation the live Chair returns: four routes mapping to finding/decision.
    const consolidation = asRoleOutput('proposals', [
      { type: 'finding' },
      { type: 'finding' },
      { type: 'decision' },
      { type: 'finding' },
    ]);
    // Reconciled (real) brief: accepted.
    expect(collectBriefContractViolations(realChair, consolidation)).toEqual([]);
    // The ORIGINAL skew, simulated by mutating the COMPARISON brief (never source):
    // the pre-fix Chair brief allowed only the disjoint structural vocabulary.
    const skewedChair = {
      ...realChair,
      output: { ...realChair.output, allowedProposalTypes: ['merge', 'sequence'] },
    } as unknown as OperatingAdvisorBrief;
    const skewedIssues = collectBriefContractViolations(skewedChair, consolidation);
    expect(skewedIssues.some((issue) => issue.rule === 'allowedProposalTypes')).toBe(true);
  });
});

// Invariant 3 — DEFECT: the CLI wrote its public projection where the dashboard
// reader never looked, so a fully reviewable cycle read back `available:false,
// absent`. The writer and reader path constants must be equal — imported from both
// sides, never a literal in this test, so a rename on EITHER side turns it red.
describe('invariant 3: the CLI writer path equals the installed dashboard reader path', () => {
  it('projection and checkpoint constants match across writer and reader (no path literals)', () => {
    // The reader reports its full `.planr/`-relative projection path on every read,
    // even against a directory that does not exist.
    const readerResult = reader.readOperatingProjection(
      join(tmpdir(), 'openplanr-xcomponent-absent', '.planr'),
    );
    // The planr root prefix is DERIVED from the reader's own reported path, so no
    // projection-path string is written in this test.
    const planrPrefix = readerResult.path.slice(0, readerResult.path.indexOf('/') + 1);

    expect(PUBLIC_OPERATING_PROJECTION_PATHS.state).toBe(readerResult.path);
    expect(PUBLIC_OPERATING_PROJECTION_PATHS.checkpoint).toBe(
      planrPrefix + reader.OPERATING_CHECKPOINT_RELATIVE_PATH,
    );
    // And the reader's relative constant is genuinely the suffix the writer emits.
    expect(
      PUBLIC_OPERATING_PROJECTION_PATHS.checkpoint.endsWith(
        reader.OPERATING_CHECKPOINT_RELATIVE_PATH,
      ),
    ).toBe(true);
  });
});

// Invariant 4 — DEFECT: the bootstrap map handed advisors pointed at `.planr/backlog`
// and `.planr/quick`, but the anchor's artifactId validation rejected `BL-*`/`QT-*`
// as unknown classes, so a citation into exactly what the map advertised failed
// closed. Every artifact class the map can point at MUST be `isPlanrArtifactId`-
// accepted AND accepted by the record-time anchor. Both sides derive from exports.
describe('invariant 4: every bootstrap-reachable planr artifact class is citable', () => {
  it('isPlanrArtifactId accepts exactly the declared class-prefix set', () => {
    expect(PLANR_ARTIFACT_CLASS_PREFIXES.length).toBeGreaterThan(0);
    // The backlog/quick classes tonight's map advertised are present.
    expect(PLANR_ARTIFACT_CLASS_PREFIXES).toEqual(expect.arrayContaining(['BL', 'QT']));
    for (const prefix of PLANR_ARTIFACT_CLASS_PREFIXES) {
      expect(isPlanrArtifactId(`${prefix}-001`), `${prefix}-001 must be a known artifact id`).toBe(
        true,
      );
    }
    // A class outside the declared set is rejected — the acceptance is the set, not
    // an accept-anything predicate.
    expect(isPlanrArtifactId('ZZZ-001')).toBe(false);
  });

  it('the record-time anchor accepts a planr citation for every declared class', () => {
    for (const prefix of PLANR_ARTIFACT_CLASS_PREFIXES) {
      expect(
        () =>
          assertOperatingCitationAnchor({
            planrArtifactId: `${prefix}-001`,
            pinnedRevision: VALID_REVISION,
          }),
        `${prefix}-001 must anchor`,
      ).not.toThrow();
    }
  });
});

// Invariant 5 — DEFECT: the record-path validator enforced `maximumProposals`,
// `allowedProposalTypes`, and the response `jsonSchema` against a role's brief, but
// the prepared mandate DISCLOSED none of them, so advisors could not see caps they
// were then rejected against — 7 advisor actions were silently lost. Every enforced
// field MUST be present in the mandate `output` block and equal the enforced value.
describe('invariant 5: the prepared mandate discloses every field the record validator enforces', () => {
  it('every prepared advisor + chair mandate discloses the enforced contract', async () => {
    const protocol = await loadOperatingProtocol();
    const prepared: Array<[string, OperatingMandate]> = [
      ...Object.entries(advisorMandates),
      ['chair', chairMandate],
    ];
    // Every enabled advisor plus the Chair produced a mandate to inspect.
    expect(prepared.map(([roleId]) => roleId).sort()).toEqual([
      'chair',
      'growth-market',
      'operations-customer',
      'product-activation',
      'strategy-finance',
      'technology-risk',
    ]);

    for (const [roleId, mandate] of prepared) {
      const brief = createRegistryReconciledAdvisorBrief(protocol, roleId as OperatingRoleId);
      const output = mandate.output;
      expect(output, `${roleId} mandate must disclose output`).toBeDefined();
      if (!output) continue;
      // Each field the enforcer reads is present and equals the value the enforcer
      // will apply — disclosed contract === enforced contract.
      expect(typeof output.maximumProposals, `${roleId} maximumProposals`).toBe('number');
      expect(output.maximumProposals).toBe(brief.output.maximumProposals);
      expect(Array.isArray(output.allowedProposalTypes), `${roleId} allowedProposalTypes`).toBe(
        true,
      );
      // The disclosure must be a SUBSET of what record enforces — never equal to
      // the legacy brief's vocabulary, which contains types no v1.4 action can
      // express. Comparing the two for equality is what let the stale-contract
      // defect pass CI.
      for (const disclosed of output.allowedProposalTypes) {
        expect(brief.output.allowedProposalTypes, `${roleId} discloses ${disclosed}`).toContain(
          disclosed,
        );
      }
      expect(output.jsonSchema && typeof output.jsonSchema, `${roleId} jsonSchema`).toBe('object');
      // Disclosed identity ≡ enforced identity, by construction.
      expect(output.schema).toBe(mandate.responseSchema);
    }
  });
});

// Invariant 6 — DEFECT: the citation path/revision patterns lived as two independent
// v1.3 copies — the record-time anchor (citation-resolution.ts) and the git read
// layer (read-only-providers.ts). Fixing one left the other biting. They must agree
// on an identical probe set: dot-paths accepted, `..` traversal rejected, uppercase
// hex revisions accepted; and the artifactId predicate must be the one shared value.
describe('invariant 6: the record anchor and the git read layer share one citation pattern', () => {
  const recordAcceptsPath = (path: string): boolean =>
    accepts(() =>
      assertOperatingCitationAnchor({ repositoryPath: path, pinnedRevision: VALID_REVISION }),
    );
  const gitAcceptsPath = (path: string): boolean =>
    accepts(() => assertGitCitationRepositoryPath(path));
  const recordAcceptsRevision = (revision: string): boolean =>
    accepts(() =>
      assertOperatingCitationAnchor({ repositoryPath: 'src/service.ts', pinnedRevision: revision }),
    );
  const gitAcceptsRevision = (revision: string): boolean =>
    accepts(() => assertGitCitationRevision(revision));

  function accepts(probe: () => void): boolean {
    try {
      probe();
      return true;
    } catch {
      return false;
    }
  }

  it('both layers reach the same verdict on every repository-path probe', () => {
    const paths: Array<{ probe: string; expected: boolean }> = [
      { probe: 'src/service.ts', expected: true },
      { probe: '.github/workflows/ci.yml', expected: true },
      { probe: '.planr/config.json', expected: true },
      { probe: '.changeset/config.json', expected: true },
      { probe: 'docs/README.md', expected: true },
      { probe: '../secrets.txt', expected: false },
      { probe: 'a/../b', expected: false },
      { probe: '/etc/passwd', expected: false },
    ];
    for (const { probe, expected } of paths) {
      expect(recordAcceptsPath(probe), `record anchor on ${probe}`).toBe(expected);
      expect(gitAcceptsPath(probe), `git read layer on ${probe}`).toBe(expected);
    }
    // The three named probes, called out explicitly.
    expect(
      recordAcceptsPath('.github/workflows/ci.yml') && gitAcceptsPath('.github/workflows/ci.yml'),
    ).toBe(true);
    expect(recordAcceptsPath('../secrets.txt') || gitAcceptsPath('../secrets.txt')).toBe(false);
  });

  it('both layers reach the same verdict on every revision probe (uppercase hex accepted)', () => {
    const revisions: Array<{ probe: string; expected: boolean }> = [
      { probe: 'ABCDEF1234567', expected: true },
      { probe: 'abcdef1', expected: true },
      { probe: 'f'.repeat(64), expected: true },
      { probe: 'abc', expected: false },
      { probe: 'zzzzzzz', expected: false },
      { probe: 'a'.repeat(65), expected: false },
    ];
    for (const { probe, expected } of revisions) {
      expect(recordAcceptsRevision(probe), `record anchor on revision ${probe}`).toBe(expected);
      expect(gitAcceptsRevision(probe), `git read layer on revision ${probe}`).toBe(expected);
    }
  });

  it('the record anchor and isPlanrArtifactId are one shared artifactId predicate', () => {
    const recordAcceptsArtifact = (id: string): boolean =>
      accepts(() =>
        assertOperatingCitationAnchor({ planrArtifactId: id, pinnedRevision: VALID_REVISION }),
      );
    for (const id of ['BL-001', 'EPIC-001', 'QT-9', 'ZZZ-1', 'not-an-id', 'lowercase-1']) {
      expect(recordAcceptsArtifact(id), `record anchor vs isPlanrArtifactId on ${id}`).toBe(
        isPlanrArtifactId(id),
      );
    }
  });
});
