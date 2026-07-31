import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import {
  renderOperatingDecisionBriefArtifact,
  writeOperatingDecisionBriefArtifact,
} from '../../src/services/operate/decision-brief.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { readOperatingDecisionBriefSource } from '../../src/services/operate/reports.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
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

const advisor: AdvisorAdapter = {
  id: 'decision-brief-fixture',
  mode: 'structured',
  toolIsolation: 'not-applicable',
  capability: 'analysis-high',
  async invoke(input) {
    const evidenceRef = input.evidence.items[0]?.id;
    if (!evidenceRef || input.roleId !== 'chair') {
      return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
    }
    return {
      outcome: 'proposals',
      proposals: [
        {
          proposalKey: 'instrument-activation',
          type: 'merge',
          title: 'Instrument activation before scope expansion',
          problem: 'The activation funnel has no verified baseline.',
          proposal: 'Create one bounded instrumentation specification.',
          impact: 3,
          confidence: 3,
          ease: 4,
          severity: 'high',
          evidenceRefs: [evidenceRef],
        },
        {
          proposalKey: 'activation-decision',
          type: 'decision',
          title: 'Owner decides on activation instrumentation',
          problem: 'Should we instrument activation before expanding scope?',
          proposal: 'Instrument activation first, then expand scope.',
          impact: 3,
          confidence: 3,
          ease: 3,
          severity: 'medium',
          evidenceRefs: [evidenceRef],
        },
      ],
      gaps: [],
      conflicts: [],
    };
  },
};

async function runFixtureCycle(): Promise<{
  projectRoot: string;
  localRoot: string;
  cycleId: string;
  decisionIds: string[];
}> {
  const projectRoot = await temporaryDirectory('openplanr-decision-brief-project-');
  const localRoot = await temporaryDirectory('openplanr-decision-brief-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'service.ts'), 'export const ready = true;\n');
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const initialization = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository', 'git'],
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      enabledProviders: ['repository', 'git'],
      caps: { surfacedFindings: 3, newSpecs: 1, openDecisions: 2, agentArtifacts: 1 },
      budgets: { maxFiles: 100, maxItems: 100, maxBytes: 1024 * 1024, maxDurationMs: 10_000 },
    },
    charter: {
      purpose: 'Exercise self-contained decision-brief rendering.',
      goals: ['Render a cited local decision brief for the owner.'],
    },
    now: '2026-07-28T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview: initialization,
    confirmationDigest: initialization.previewDigest,
  });
  const cycle = await runOperatingCycle({
    projectRoot,
    localRoot,
    adapter: advisor,
    confirmed: true,
    now: new Date('2026-07-28T13:00:00.000Z'),
  });
  return {
    projectRoot,
    localRoot,
    cycleId: cycle.cycle.id,
    decisionIds: (cycle.state?.decisions ?? []).map((decision) => decision.id),
  };
}

describe('operate self-contained decision-brief rendering on real cycle data (FR7/E-007)', () => {
  it('assembles and renders a cycle brief offline from readOperatingReport data', async () => {
    const { projectRoot, localRoot, cycleId } = await runFixtureCycle();
    const source = await readOperatingDecisionBriefSource({ projectRoot, localRoot, cycleId });
    expect(source.kind).toBe('brief');
    expect(source.cycleId).toBe(cycleId);
    expect(source.title).toContain('OpenPlanr Operating Brief');

    const written = await writeOperatingDecisionBriefArtifact({
      projectRoot,
      localRoot,
      destination: 'operate-brief.html',
      source,
    });
    const html = await readFile(written.path, 'utf8');
    expect(html).toBe(written.html);
    expect(/https?:\/\//i.test(html)).toBe(false);
    expect(html).toContain('OpenPlanr Operating Brief');
  });

  it('assembles and renders a decision brief showing question, evidence, options, and blockers', async () => {
    const { projectRoot, localRoot, decisionIds } = await runFixtureCycle();
    expect(decisionIds.length).toBeGreaterThan(0);
    const decisionId = decisionIds[0];

    const source = await readOperatingDecisionBriefSource({ projectRoot, localRoot, decisionId });
    expect(source.kind).toBe('decision');
    expect(source.id).toBe(decisionId);
    expect(source.question).toContain('instrument activation');
    expect((source.options ?? []).length).toBeGreaterThan(0);
    expect(source.decision?.owner).toBe('Product owner');
    // Evidence carries resolved sensitivity, never raw content.
    expect(source.evidence.every((item) => typeof item.sensitivity === 'string')).toBe(true);

    const rendered = await renderOperatingDecisionBriefArtifact(source, 'internal');
    expect(rendered.offline).toBe(true);
    expect(/https?:\/\//i.test(rendered.html)).toBe(false);
    expect(rendered.html).toContain('instrument activation');
    expect(rendered.html).toContain('Product owner');
    for (const option of source.options ?? []) {
      expect(rendered.html).toContain(option.label);
    }
  });

  it('withholds evidence above the configured sensitivity ceiling from rendered content', async () => {
    const { projectRoot, localRoot, decisionIds } = await runFixtureCycle();
    const decisionId = decisionIds[0];
    const source = await readOperatingDecisionBriefSource({ projectRoot, localRoot, decisionId });
    // Force one cited item above a 'public' ceiling; it must not appear in output.
    const confidentialRef = 'EV-confidential-secret';
    const withConfidential = {
      ...source,
      evidence: [
        ...source.evidence,
        { ref: confidentialRef, sensitivity: 'confidential' as const },
      ],
    };
    const rendered = await renderOperatingDecisionBriefArtifact(withConfidential, 'public');
    expect(rendered.redactedEvidenceRefs).toContain(confidentialRef);
    expect(rendered.html).not.toContain(confidentialRef);
  });
});
