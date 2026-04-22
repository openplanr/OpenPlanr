/**
 * Post-flight evidence verification for `planr revise`.
 *
 * The revise agent emits a ReviseDecision with typed evidence citations. Before
 * the user ever sees a diff, this verifier checks each citation against the
 * real repo:
 *
 * - `file_exists` / `file_absent` — fs.stat on the ref path
 * - `grep_match`                   — literal check inside the codebase context
 *                                    the agent was given; rejects claims the
 *                                    agent could not have seen
 * - `sibling_artifact`             — artifact id must exist on disk
 * - `source_quote`                 — source path must exist on disk (quote
 *                                    fuzzy-match is best-effort)
 * - `pattern_rule`                 — rule id must be in the detected pattern
 *                                    rules for this run
 *
 * Unverifiable evidence is dropped with a reason. If a `revise` action has no
 * surviving evidence after the sweep, the decision is demoted to `flag` with
 * an explicit ambiguity entry — the agent's judgment wasn't necessarily wrong,
 * but its *proof* can't be trusted, so a human owns the call.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactType,
  OpenPlanrConfig,
  ReviseAmbiguity,
  ReviseDecision,
  ReviseEvidence,
} from '../models/types.js';
import { logger } from '../utils/logger.js';
import { findArtifactTypeById, listArtifacts, readArtifact } from './artifact-service.js';

/**
 * Run-time context the verifier needs. Callers should populate this from the
 * same inputs used to build the revise prompt, so the verifier checks evidence
 * against exactly the material the agent had access to.
 */
export interface EvidenceVerifierContext {
  projectDir: string;
  config: OpenPlanrConfig;
  /**
   * Directory of the artifact being verified. Used to resolve relative
   * evidence refs like `../features/-slug.md` that appear in
   * markdown cross-reference links (those paths are relative to the
   * artifact's file location, not to projectDir). Falls back to projectDir
   * when omitted.
   */
  artifactDir?: string;
  /** Concatenated string from `formatCodebaseContext`; undefined in fast mode. */
  codebaseContextFormatted?: string;
  /** Labels (paths or URLs) of declared sources supplied to the agent. */
  knownSourceRefs: string[];
  /** Pattern rule ids detected in the codebase context (from pattern-rules). */
  knownPatternRuleIds: string[];
}

export interface DroppedEvidence {
  evidence: ReviseEvidence;
  reason: string;
}

export interface DecisionVerificationResult {
  /** Possibly-rewritten decision (evidence filtered; action demoted if needed). */
  decision: ReviseDecision;
  /** Evidence items that failed verification and were removed from the decision. */
  dropped: DroppedEvidence[];
  /** True when the verifier changed the action (e.g., revise → flag). */
  demoted: boolean;
}

/**
 * Verify every evidence item in a decision; drop anything unverifiable.
 * Demote `revise` to `flag` when no verifiable evidence remains.
 */
export async function verifyDecision(
  decision: ReviseDecision,
  ctx: EvidenceVerifierContext,
): Promise<DecisionVerificationResult> {
  const dropped: DroppedEvidence[] = [];
  const verified: ReviseEvidence[] = [];

  for (const ev of decision.evidence) {
    const check = await verifyEvidence(ev, ctx);
    if (check.ok) {
      verified.push(ev);
    } else {
      dropped.push({ evidence: ev, reason: check.reason });
    }
  }

  if (dropped.length > 0) {
    logger.debug(
      `evidence-verifier: dropped ${dropped.length}/${decision.evidence.length} citations for ${decision.artifactId}`,
    );
  }

  // Demotion rules for a `revise` action. We never silently apply a rewrite
  // whose evidence base is weak. Two triggers:
  //
  //   (a) `verified.length === 0` — no evidence survived at all
  //   (b) `dropped.length > verified.length` — a majority of the agent's
  //       evidence was unverifiable. This catches the failure mode where
  //       the agent cites one true thing and several hallucinated ones;
  //       without this rule a 1-out-of-6 verification rate passes through
  //       because at least one citation survives.
  //
  // Both rules target `revise` specifically — `flag` decisions are already
  // asking for human review, and `skip` decisions don't change anything.
  const shouldDemote =
    decision.action === 'revise' && (verified.length === 0 || dropped.length > verified.length);

  if (shouldDemote) {
    const reason =
      verified.length === 0
        ? 'Agent proposed a revision but none of its evidence citations could be verified against the repo. Human review required.'
        : `Agent proposed a revision but a majority of its evidence citations (${dropped.length}/${dropped.length + verified.length}) could not be verified. Most likely hallucinated — human review required.`;
    const tag =
      verified.length === 0 ? 'all evidence unverifiable' : 'majority evidence unverifiable';
    const ambiguity: ReviseAmbiguity = {
      section: '(evidence verification)',
      reason,
    };
    return {
      decision: {
        ...decision,
        action: 'flag',
        evidence: verified, // keep any surviving citations in the flag record
        revisedMarkdown: undefined,
        ambiguous: [...decision.ambiguous, ambiguity],
        rationale: `${decision.rationale} [demoted: ${tag}]`,
      },
      dropped,
      demoted: true,
    };
  }

  return {
    decision: { ...decision, evidence: verified },
    dropped,
    demoted: false,
  };
}

interface EvidenceCheck {
  ok: boolean;
  reason: string;
}

/** Verify a single evidence item. Exported primarily for testing. */
export async function verifyEvidence(
  ev: ReviseEvidence,
  ctx: EvidenceVerifierContext,
): Promise<EvidenceCheck> {
  switch (ev.type) {
    case 'file_exists':
      return (await pathExists(ctx.projectDir, ev.ref, ctx.artifactDir))
        ? ok()
        : fail(`cited file does not exist: ${ev.ref}`);

    case 'file_absent':
      return (await pathExists(ctx.projectDir, ev.ref, ctx.artifactDir))
        ? fail(`cited file IS present in the repo, contradicting 'file_absent': ${ev.ref}`)
        : ok();

    case 'grep_match':
      if (!ctx.codebaseContextFormatted) {
        return fail(
          'grep_match citation requires codebase context, but context was not loaded (fast mode)',
        );
      }
      // Require either ref OR quote to appear in the context the agent saw.
      if (
        ctx.codebaseContextFormatted.includes(ev.ref) ||
        (ev.quote && ctx.codebaseContextFormatted.includes(ev.quote))
      ) {
        return ok();
      }
      return fail(`grep_match token not found in codebase context: ${ev.ref}`);

    case 'sibling_artifact': {
      const type = findArtifactTypeById(ev.ref);
      if (!type) {
        return fail(`sibling_artifact ref is not a recognizable artifact id: ${ev.ref}`);
      }
      return (await artifactExists(ctx.projectDir, ctx.config, type, ev.ref))
        ? ok()
        : fail(`sibling_artifact not found on disk: ${ev.ref}`);
    }

    case 'source_quote':
      // Source refs are labels/paths declared in .planr/revise.yaml; the
      // caller has already globbed them, so we validate against that list.
      return ctx.knownSourceRefs.includes(ev.ref)
        ? ok()
        : fail(`source_quote ref is not a declared source: ${ev.ref}`);

    case 'pattern_rule':
      return ctx.knownPatternRuleIds.includes(ev.ref)
        ? ok()
        : fail(`pattern_rule ref is not a detected pattern rule: ${ev.ref}`);

    default: {
      // Exhaustive check — if a new evidence type is added to the TS union
      // but not here, the compiler will complain.
      const _exhaustive: never = ev.type;
      return fail(`unhandled evidence type: ${String(_exhaustive)}`);
    }
  }
}

const ok = (): EvidenceCheck => ({ ok: true, reason: '' });
const fail = (reason: string): EvidenceCheck => ({ ok: false, reason });

async function pathExists(projectDir: string, ref: string, artifactDir?: string): Promise<boolean> {
  // Choose resolution base:
  // - Relative refs (`./` or `../`) resolve against the artifact's directory
  //   when available, because OpenPlanr's cross-reference convention writes
  //   paths like `../features/-slug.md` relative to the artifact file.
  // - Everything else (repo-root-style refs like `src/services/foo.ts`) resolves
  //   against projectDir.
  const looksRelative = ref.startsWith('./') || ref.startsWith('../');
  const base = looksRelative && artifactDir ? artifactDir : projectDir;
  const resolved = path.resolve(base, ref);
  const normalized = path.normalize(resolved);
  // Traversal guard — the final path must still land inside projectDir
  // (after following any `../`). This blocks probes like `../../../etc/passwd`
  // while allowing legitimate artifact→sibling-dir references.
  if (!normalized.startsWith(path.normalize(projectDir))) return false;
  try {
    await stat(normalized);
    return true;
  } catch {
    return false;
  }
}

async function artifactExists(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
): Promise<boolean> {
  // readArtifact is the authoritative existence check — it looks for files
  // matching `${id}-*.md` in the correct artifact-type directory.
  const artifact = await readArtifact(projectDir, config, type, id);
  if (artifact !== null) return true;
  // Fallback: scan the listing in case id-case or prefix routing differs.
  const list = await listArtifacts(projectDir, config, type);
  return list.some((a) => a.id === id);
}
