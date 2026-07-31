import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDecisionBriefInput,
  type DecisionBriefSource,
  filterEvidenceByCeiling,
  OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX,
  readOperatingSensitivityCeiling,
  renderOperatingDecisionBriefArtifact,
  writeOperatingDecisionBriefArtifact,
} from '../../src/services/operate/decision-brief.js';

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
    expect(info.mode & 0o777).toBe(0o600);
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
