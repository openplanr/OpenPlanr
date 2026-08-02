import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdvisorAdapter,
  type AdvisorOperatingContext,
  assertAdvisorIsolation,
  dispatchOperatingAdvisors,
} from '../../src/services/operate/advisors.js';
import type {
  OperatingEvidence,
  OperatingEvidenceReadiness,
  OperatingRoleId,
} from '../../src/services/operate/types.js';

/**
 * Honeytoken containment proof (SPEC-002 security contract).
 *
 * Each token below is planted in exactly one ambient channel an advisory lens
 * must never reach: the filesystem, the process environment, a callable tool
 * surface, and the network. A lens receives only the immutable evidence
 * snapshot and its canonical role brief, so no token may appear anywhere in
 * the payload that crosses the isolation boundary.
 *
 * These are deliberately unique strings: a substring match against the fully
 * serialized advisor input is the assertion, so any future leak through a new
 * context field fails here rather than in production.
 */
const FILE_TOKEN = 'honeytoken-file-6f2b1c9a4d7e';
const ENV_TOKEN = 'honeytoken-env-b83d5e017fac';
const TOOL_TOKEN = 'honeytoken-tool-2a91c6b4de08';
const NETWORK_TOKEN = 'honeytoken-network-5d0e73fa1b26';
const CHARTER_TOKEN = 'honeytoken-charter-9c47ba30f5d1';

/**
 * The four ambient channels a lens must never reach. CHARTER_TOKEN is excluded
 * deliberately: charter guardrails are role-filtered rather than withheld, so
 * they are asserted differentially in their own case below.
 */
const ALL_TOKENS = [FILE_TOKEN, ENV_TOKEN, TOOL_TOKEN, NETWORK_TOKEN];

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function quietAgentResponse(title = 'Advisor analysis'): Record<string, unknown> {
  return {
    outcome: 'quiet',
    analysisMarkdown: `# ${title}\n\nNo citation-qualified action was identified.`,
    claims: [],
    actions: [],
    gaps: [],
    conflicts: [],
  };
}

function evidence(): OperatingEvidence {
  return {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: digest('a'),
    collectedAt: '2026-07-28T10:00:00.000Z',
    truncated: false,
    items: [
      {
        id: 'EVD-code',
        source: 'repository',
        location: 'src/index.ts',
        digest: digest('d'),
        collectedAt: '2026-07-28T10:00:00.000Z',
        observedFrom: null,
        observedTo: null,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['repository:code'],
        summary: 'The delivery surface has no activation instrumentation.',
      },
    ],
    sources: [],
    warnings: [],
  };
}

function advisorContext(): AdvisorOperatingContext {
  const context = {
    charter: {
      purpose: 'Operate a trustworthy planning product.',
      stage: 'growth',
      businessModel: 'subscription',
      idealCustomer: 'technical founders',
      goals: ['Improve activation'],
      constraints: ['No autonomous deployment'],
      successMetrics: ['First brief in five minutes'],
      // Guardrails are role-filtered, not withheld: the risk lens needs them,
      // the growth lens must not see them. Tokenized so the filter is proven
      // by content rather than by property presence.
      guardrails: [`No external writes (${CHARTER_TOKEN})`],
      knownUnknowns: ['Conversion baseline'],
    },
    priorCycle: {
      id: 'CYCLE-000',
      state: 'closed',
      health: 'normal',
      findings: 2,
      decisions: 1,
      gaps: 1,
      pendingOutcomes: 1,
    },
    openDecisions: [
      {
        id: 'DEC-001',
        status: 'open',
        summary: 'Choose activation metric',
        owner: 'Owner',
        evidenceRefs: [],
      },
    ],
    openGaps: [
      {
        id: 'GAP-001',
        status: 'open',
        summary: 'Verify runtime isolation',
        owner: 'Owner',
        evidenceRefs: [],
        affectedRoles: ['technology-risk'],
      },
    ],
    pendingOutcomes: [
      {
        id: 'OUT-001',
        status: 'pending',
        summary: 'Activation rate',
        owner: null,
        evidenceRefs: [],
      },
    ],
  };
  return {
    ...context,
    snapshotDigest: digest('c'),
  };
}

function roleReadiness(roleId: OperatingRoleId): OperatingEvidenceReadiness['roles'][number] {
  return {
    roleId,
    readiness: 'ready',
    requirements: [],
    missingEvidence: [],
    evidenceRefs: ['EVD-code'],
    modelCallAllowed: true,
    gapId: null,
  };
}

function readiness(roles: OperatingEvidenceReadiness['roles']): OperatingEvidenceReadiness {
  return {
    kind: 'operating-evidence-readiness',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    inputDigest: digest('b'),
    evaluatedAt: '2026-07-28T10:00:01.000Z',
    roles,
  };
}

/** Collect every callable reachable by walking the payload the advisor receives. */
function reachableFunctionPaths(value: unknown, path = '$', seen = new WeakSet()): string[] {
  if (typeof value === 'function') return [path];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    reachableFunctionPaths(child, `${path}.${key}`, seen),
  );
}

describe('Operating Board advisor honeytoken containment', () => {
  let projectRoot: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-honeytoken-'));
    // Filesystem channel: a readable file inside the working tree.
    await writeFile(join(projectRoot, 'secrets.env'), `LEAKED=${FILE_TOKEN}\n`, 'utf8');
    // Environment channel.
    process.env.OPENPLANR_HONEYTOKEN = ENV_TOKEN;
    // Network channel: any egress during dispatch is a failure.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error(`unexpected network egress carrying ${NETWORK_TOKEN}`);
    }) as unknown as typeof fetch);
  });

  afterEach(async () => {
    delete process.env.OPENPLANR_HONEYTOKEN;
    fetchSpy.mockRestore();
    await rm(projectRoot, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it('leaks no filesystem, environment, tool, or network honeytoken into the advisor payload', async () => {
    const invoke = vi.fn().mockResolvedValue(quietAgentResponse('CTO analysis'));

    const adapter: AdvisorAdapter = {
      id: 'honeytoken-fixture',
      mode: 'structured',
      toolIsolation: 'not-applicable',
      capability: 'analysis-high',
      invoke,
    };

    const result = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      projectRoot,
      pinnedRevision: 'a'.repeat(40),
      readiness: readiness([roleReadiness('technology-risk')]),
      context: advisorContext(),
      adapter,
      depth: 'standard',
      runtime: 'codex',
      protocolVersion: '1.4.0',
      resolveCitations: async (roleResults) => ({
        roleResults,
        gaps: [],
        notEvaluatedRoleIds: [],
      }),
    });

    expect(result.failed).toEqual([]);
    expect(result.modelCalls).toBe(1);
    const call = invoke.mock.calls[0]?.[0];
    expect(call).toBeDefined();

    // The complete payload crossing the boundary, exactly as an advisor sees it.
    // FR1/FR2: the lens receives a body-free MANDATE — the lens question, declared
    // read boundaries, and citation requirement — with no evidence body or index,
    // so no ambient channel can ride along in a curated evidence excerpt.
    const payload = JSON.stringify(call);
    expect(call.mandate.kind).toBe('operating-mandate');
    expect(call.mandate).not.toHaveProperty('evidence');

    for (const token of ALL_TOKENS) {
      expect(payload).not.toContain(token);
    }

    // No callable/tool surface reaches the lens.
    expect(reachableFunctionPaths(call)).toEqual([]);
    // No ambient process state is proxied through the payload.
    expect(payload).not.toContain(projectRoot);
    expect(payload).not.toContain('process.env');
    // Dispatch itself performs no network egress.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('role-filters charter guardrails to the risk lens and withholds them from the growth lens', async () => {
    async function payloadFor(roleId: OperatingRoleId): Promise<string> {
      const invoke = vi.fn().mockResolvedValue(quietAgentResponse());
      const result = await dispatchOperatingAdvisors({
        cycleId: 'CYCLE-001',
        evidence: evidence(),
        readiness: readiness([roleReadiness(roleId)]),
        context: advisorContext(),
        adapter: {
          id: 'honeytoken-fixture',
          mode: 'structured',
          toolIsolation: 'not-applicable',
          capability: 'analysis-high',
          invoke,
        },
        depth: 'standard',
        runtime: 'codex',
        protocolVersion: '1.4.0',
      });
      expect(result.failed).toEqual([]);
      expect(result.modelCalls).toBe(1);
      return JSON.stringify(invoke.mock.calls[0]?.[0]);
    }

    // The risk lens mandate covers security boundaries, so guardrails are in scope.
    expect(await payloadFor('technology-risk')).toContain(CHARTER_TOKEN);
    // The growth lens has no such mandate and must never receive them.
    expect(await payloadFor('growth-market')).not.toContain(CHARTER_TOKEN);
  });

  it('accepts a runtime-governed Codex lens without granting extra permissions', async () => {
    const invoke = vi.fn().mockResolvedValue(quietAgentResponse('CTO analysis'));

    const unenforced: AdvisorAdapter = {
      id: 'native-unenforced',
      mode: 'native-isolated',
      toolIsolation: 'advisory',
      capability: 'analysis-high',
      invoke,
    };

    expect(() => assertAdvisorIsolation(unenforced)).not.toThrow();

    const result = await dispatchOperatingAdvisors({
      cycleId: 'CYCLE-001',
      projectRoot,
      pinnedRevision: 'a'.repeat(40),
      readiness: readiness([roleReadiness('technology-risk')]),
      context: advisorContext(),
      adapter: unenforced,
      depth: 'standard',
      runtime: 'codex',
      protocolVersion: '1.4.0',
      resolveCitations: async (roleResults) => ({
        roleResults,
        gaps: [],
        notEvaluatedRoleIds: [],
      }),
    });

    expect(result.failed).toEqual([]);
    expect(result.provenance[0]).toMatchObject({
      roleId: 'technology-risk',
      isolation: 'runtime-governed',
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
