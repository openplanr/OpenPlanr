import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReviseDecision, ReviseEvidence } from '../../src/models/types.js';
import { createDefaultConfig } from '../../src/services/config-service.js';
import {
  type EvidenceVerifierContext,
  verifyDecision,
  verifyEvidence,
} from '../../src/services/evidence-verifier.js';
import { ensureDir } from '../../src/utils/fs.js';

describe('verifyEvidence', () => {
  let tmpDir: string;
  const config = createDefaultConfig('test');
  let baseCtx: EvidenceVerifierContext;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-verifier-'));
    // Create a real file the verifier can stat
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'exists.ts'), 'export const x = 1;');
    // Create a real artifact the verifier can resolve
    await ensureDir(join(tmpDir, config.outputPaths.agile, 'epics'));
    writeFileSync(
      join(tmpDir, config.outputPaths.agile, 'epics', 'EPIC-100-sample.md'),
      '---\nid: "EPIC-100"\n---\n# body',
    );

    baseCtx = {
      projectDir: tmpDir,
      config,
      codebaseContextFormatted:
        '## Tech Stack\nTypescript + Node\n\ngetDefaultRules() in report-linter-service.ts:42',
      knownSourceRefs: ['.planr/backlog/PRD-platform.md', '.cursor/rules/components.mdc'],
      knownPatternRuleIds: ['generic-crud', 'missing-registration'],
    };
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts file_exists when the ref resolves under projectDir', async () => {
    const ev: ReviseEvidence = { type: 'file_exists', ref: 'src/exists.ts' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('rejects file_exists when the ref does not resolve', async () => {
    const ev: ReviseEvidence = { type: 'file_exists', ref: 'src/nope.ts' };
    const check = await verifyEvidence(ev, baseCtx);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('does not exist');
  });

  it('rejects file_exists for path-traversal attempts outside projectDir', async () => {
    const ev: ReviseEvidence = { type: 'file_exists', ref: '../../../etc/passwd' };
    const check = await verifyEvidence(ev, baseCtx);
    expect(check.ok).toBe(false);
  });

  it('accepts file_exists for refs relative to the artifact directory (../features/FEAT-XXX.md)', async () => {
    // This is the real-world regression: epic markdown contains
    // `- [FEAT-001: ...](../features/FEAT-XXX-slug.md)`. Those paths resolve
    // relative to .planr/epics/, not projectDir. Before this fix, the
    // verifier treated all of them as file_absent.
    mkdirSync(join(tmpDir, config.outputPaths.agile, 'features'), { recursive: true });
    writeFileSync(
      join(tmpDir, config.outputPaths.agile, 'features', 'FEAT-001-sibling.md'),
      '---\nid: "FEAT-001"\n---\n# Sibling feature',
    );

    const ev: ReviseEvidence = {
      type: 'file_exists',
      ref: '../features/FEAT-001-sibling.md',
    };
    const ctx: EvidenceVerifierContext = {
      ...baseCtx,
      artifactDir: join(tmpDir, config.outputPaths.agile, 'epics'),
    };
    expect((await verifyEvidence(ev, ctx)).ok).toBe(true);
  });

  it('file_absent returns false (i.e., file IS present) for a real sibling reached via ../', async () => {
    // Guards the inverse case: if the agent claimed file_absent for a
    // cross-reference that actually exists, the verifier should reject it
    // (preventing the destructive "strip the markdown links" proposed change).
    mkdirSync(join(tmpDir, config.outputPaths.agile, 'features'), { recursive: true });
    writeFileSync(
      join(tmpDir, config.outputPaths.agile, 'features', 'FEAT-002-sibling.md'),
      '---\nid: "FEAT-002"\n---\n# Sibling',
    );

    const ev: ReviseEvidence = {
      type: 'file_absent',
      ref: '../features/FEAT-002-sibling.md',
    };
    const ctx: EvidenceVerifierContext = {
      ...baseCtx,
      artifactDir: join(tmpDir, config.outputPaths.agile, 'epics'),
    };
    const check = await verifyEvidence(ev, ctx);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('IS present');
  });

  it('still resolves non-relative refs (src/foo.ts) from projectDir even when artifactDir is set', async () => {
    const ev: ReviseEvidence = { type: 'file_exists', ref: 'src/exists.ts' };
    const ctx: EvidenceVerifierContext = {
      ...baseCtx,
      artifactDir: join(tmpDir, 'totally', 'elsewhere'),
    };
    expect((await verifyEvidence(ev, ctx)).ok).toBe(true);
  });

  it('blocks traversal even with artifactDir set (../../../etc/passwd still rejected)', async () => {
    const ev: ReviseEvidence = { type: 'file_exists', ref: '../../../etc/passwd' };
    const ctx: EvidenceVerifierContext = {
      ...baseCtx,
      artifactDir: join(tmpDir, config.outputPaths.agile, 'epics'),
    };
    expect((await verifyEvidence(ev, ctx)).ok).toBe(false);
  });

  it('accepts file_absent when the ref does not exist', async () => {
    const ev: ReviseEvidence = { type: 'file_absent', ref: 'src/fake-path.ts' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('rejects file_absent when the file is actually present', async () => {
    const ev: ReviseEvidence = { type: 'file_absent', ref: 'src/exists.ts' };
    const check = await verifyEvidence(ev, baseCtx);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('IS present');
  });

  it('accepts grep_match when ref appears in codebase context', async () => {
    const ev: ReviseEvidence = { type: 'grep_match', ref: 'getDefaultRules' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('accepts grep_match when quote appears in codebase context', async () => {
    const ev: ReviseEvidence = {
      type: 'grep_match',
      ref: 'getDefaultRules',
      quote: 'report-linter-service.ts:42',
    };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('rejects grep_match when neither ref nor quote appear in context', async () => {
    const ev: ReviseEvidence = { type: 'grep_match', ref: 'totallyFabricatedSymbol' };
    const check = await verifyEvidence(ev, baseCtx);
    expect(check.ok).toBe(false);
  });

  it('rejects grep_match when codebase context was not loaded (fast mode)', async () => {
    const ev: ReviseEvidence = { type: 'grep_match', ref: 'anything' };
    const ctx = { ...baseCtx, codebaseContextFormatted: undefined };
    const check = await verifyEvidence(ev, ctx);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('fast mode');
  });

  it('accepts sibling_artifact when the artifact file exists on disk', async () => {
    const ev: ReviseEvidence = { type: 'sibling_artifact', ref: 'EPIC-100' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('rejects sibling_artifact when the id cannot be routed to a type', async () => {
    const ev: ReviseEvidence = { type: 'sibling_artifact', ref: 'NOTANID' };
    const check = await verifyEvidence(ev, baseCtx);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('recognizable');
  });

  it('rejects sibling_artifact when the artifact does not exist', async () => {
    const ev: ReviseEvidence = { type: 'sibling_artifact', ref: 'EPIC-999' };
    const check = await verifyEvidence(ev, baseCtx);
    expect(check.ok).toBe(false);
  });

  it('accepts source_quote when ref matches a declared source', async () => {
    const ev: ReviseEvidence = { type: 'source_quote', ref: '.planr/backlog/PRD-platform.md' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('rejects source_quote when ref is not a declared source', async () => {
    const ev: ReviseEvidence = { type: 'source_quote', ref: '.random/some.md' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(false);
  });

  it('accepts pattern_rule when id is in detected rules', async () => {
    const ev: ReviseEvidence = { type: 'pattern_rule', ref: 'generic-crud' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(true);
  });

  it('rejects pattern_rule when id is not in detected rules', async () => {
    const ev: ReviseEvidence = { type: 'pattern_rule', ref: 'fabricated-rule' };
    expect((await verifyEvidence(ev, baseCtx)).ok).toBe(false);
  });
});

describe('verifyDecision', () => {
  let tmpDir: string;
  const config = createDefaultConfig('test');
  let ctx: EvidenceVerifierContext;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-verify-decision-'));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'real.ts'), 'export const x = 1;');
    ctx = {
      projectDir: tmpDir,
      config,
      codebaseContextFormatted: 'realSymbol in src/real.ts',
      knownSourceRefs: [],
      knownPatternRuleIds: [],
    };
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes through a decision whose evidence all verifies', async () => {
    const decision: ReviseDecision = {
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '---\nid: "TASK-007"\n---\n# body',
      rationale: 'Drift detected',
      evidence: [{ type: 'file_exists', ref: 'src/real.ts' }],
      ambiguous: [],
    };
    const result = await verifyDecision(decision, ctx);
    expect(result.demoted).toBe(false);
    expect(result.decision.action).toBe('revise');
    expect(result.decision.evidence).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops unverifiable evidence but keeps a revise decision when verified evidence is in the majority', async () => {
    const decision: ReviseDecision = {
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '---\nid: "TASK-007"\n---\n# body',
      rationale: 'Drift',
      evidence: [
        { type: 'file_exists', ref: 'src/real.ts' }, // good
        { type: 'grep_match', ref: 'realSymbol' }, // good (present in codebase context)
        { type: 'file_exists', ref: 'src/fake.ts' }, // bad — minority
      ],
      ambiguous: [],
    };
    const result = await verifyDecision(decision, ctx);
    expect(result.demoted).toBe(false);
    expect(result.decision.action).toBe('revise');
    expect(result.decision.evidence).toHaveLength(2);
    expect(result.dropped).toHaveLength(1);
  });

  it("demotes a 'revise' decision to 'flag' when a MAJORITY of evidence is dropped (regression for the user's 5/6 hallucination case)", async () => {
    // This is the exact real-world failure mode: agent cites 5 file_absent
    // claims (all contradicted → dropped by the relative-path fix) plus
    // 1 file_exists that survives. Under the old rule (verified === 0 → demote)
    // the single surviving citation let the destructive revise proceed.
    // Under the new rule (majority dropped → demote) the decision is
    // correctly flipped to 'flag'.
    const decision: ReviseDecision = {
      artifactId: 'EPIC-001',
      action: 'revise',
      revisedMarkdown: '---\nid: "EPIC-001"\n---\n# body',
      rationale: 'Strip broken cross-reference links',
      evidence: [
        { type: 'file_exists', ref: 'src/real.ts' }, // 1 good
        { type: 'file_exists', ref: 'src/hallucinated-1.ts' },
        { type: 'file_exists', ref: 'src/hallucinated-2.ts' },
        { type: 'file_exists', ref: 'src/hallucinated-3.ts' },
        { type: 'file_exists', ref: 'src/hallucinated-4.ts' },
        { type: 'file_exists', ref: 'src/hallucinated-5.ts' }, // 5 bad
      ],
      ambiguous: [],
    };
    const result = await verifyDecision(decision, ctx);
    expect(result.demoted).toBe(true);
    expect(result.decision.action).toBe('flag');
    // `revisedMarkdown` is now PRESERVED on demoted decisions so the audit
    // log can include the rejected-proposal diff — see apply-path tests.
    // The file is still not written (action=flag); the markdown is retained
    // for audit/explain purposes only.
    expect(result.decision.revisedMarkdown).toBe('---\nid: "EPIC-001"\n---\n# body');
    expect(result.decision.ambiguous[0].reason).toContain('majority');
    expect(result.decision.ambiguous[0].reason).toContain('5/6');
    expect(result.decision.rationale).toContain('[demoted: majority evidence unverifiable]');
    // Surviving citations are preserved on the demoted decision so the
    // human reviewer can see what the agent actually got right.
    expect(result.decision.evidence).toHaveLength(1);
  });

  it("demotes a 'revise' decision to 'flag' when all evidence is unverifiable (load-bearing guardrail)", async () => {
    const decision: ReviseDecision = {
      artifactId: 'TASK-007',
      action: 'revise',
      revisedMarkdown: '---\nid: "TASK-007"\n---\n# body',
      rationale: 'Drift claim',
      evidence: [
        { type: 'file_exists', ref: 'src/fake.ts' },
        { type: 'grep_match', ref: 'fabricated' },
      ],
      ambiguous: [],
    };
    const result = await verifyDecision(decision, ctx);
    expect(result.demoted).toBe(true);
    expect(result.decision.action).toBe('flag');
    // Preserved for the rejected-proposal diff in the audit log.
    expect(result.decision.revisedMarkdown).toBe('---\nid: "TASK-007"\n---\n# body');
    expect(result.decision.evidence).toHaveLength(0);
    expect(result.decision.ambiguous).toHaveLength(1);
    expect(result.decision.ambiguous[0].reason).toContain('none of its evidence');
    expect(result.decision.ambiguous[0].reason).toContain('Human review required');
    expect(result.decision.rationale).toContain('[demoted');
    expect(result.dropped).toHaveLength(2);
  });

  it("does not demote a 'flag' decision with unverifiable evidence", async () => {
    const decision: ReviseDecision = {
      artifactId: 'US-022',
      action: 'flag',
      rationale: 'Ambiguous',
      evidence: [{ type: 'file_exists', ref: 'src/fake.ts' }],
      ambiguous: [{ section: 'Scope', reason: 'contested' }],
    };
    const result = await verifyDecision(decision, ctx);
    expect(result.demoted).toBe(false);
    expect(result.decision.action).toBe('flag');
    expect(result.dropped).toHaveLength(1);
  });

  it("does not demote a 'skip' decision", async () => {
    const decision: ReviseDecision = {
      artifactId: 'EPIC-002',
      action: 'skip',
      rationale: 'Nothing to do',
      evidence: [],
      ambiguous: [],
    };
    const result = await verifyDecision(decision, ctx);
    expect(result.demoted).toBe(false);
    expect(result.decision.action).toBe('skip');
  });
});
