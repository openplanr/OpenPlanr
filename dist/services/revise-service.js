/**
 * `planr revise` — core service.
 *
 * Exposes composable primitives. `reviseArtifact` produces dry-run decisions;
 * `applyDecision` writes them to disk. The verifier context is exposed so
 * callers can run `verifyDecision` against the same inputs the agent saw.
 */
import path from 'node:path';
import { buildCodebaseContext, extractKeywords, formatCodebaseContext, } from '../ai/codebase/context-builder.js';
import { buildRevisePrompt, } from '../ai/prompts/prompt-builder.js';
import { aiReviseDecisionSchema } from '../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../ai/types.js';
import { logger } from '../utils/logger.js';
import { generateJSON } from './ai-service.js';
import { findArtifactTypeById, getArtifactDir, getParentChain, listArtifacts, readArtifact, readArtifactRaw, resolveArtifactFilename, } from './artifact-service.js';
import { atomicWriteFile } from './atomic-write-service.js';
import { renderDiff } from './diff-service.js';
import { getCanonicalSections } from './template-sections.js';
/**
 * Error thrown when an artifact id cannot be resolved to an artifact type or
 * the artifact file does not exist on disk.
 */
export class ReviseArtifactNotFoundError extends Error {
    artifactId;
    constructor(artifactId, message) {
        super(message);
        this.name = 'ReviseArtifactNotFoundError';
        this.artifactId = artifactId;
    }
}
/**
 * Revise a single artifact (dry-run).
 *
 * Does NOT write any files. The returned decision is the agent output after
 * schema validation; evidence verification, diff preview, and write live in
 * the CLI / apply path. Cascade, siblings, and declared sources are future
 * extensions.
 */
export async function reviseArtifact(projectDir, config, provider, artifactId, options) {
    const artifactType = findArtifactTypeById(artifactId);
    if (!artifactType) {
        throw new ReviseArtifactNotFoundError(artifactId, `Cannot determine artifact type from ID: ${artifactId}. Expected format: EPIC-001, FEAT-001, US-001, TASK-001.`);
    }
    const artifactRaw = await readArtifactRaw(projectDir, config, artifactType, artifactId);
    if (artifactRaw === null) {
        throw new ReviseArtifactNotFoundError(artifactId, `Artifact ${artifactId} not found under ${artifactType}/ directory.`);
    }
    const parents = await loadParentPromptArtifacts(projectDir, config, artifactType, artifactId);
    const siblings = options.noSiblingContext
        ? []
        : await loadSiblingPromptArtifacts(projectDir, config, artifactType, artifactId, options.maxSiblings ?? 8);
    let codebaseContextFormatted;
    let codebaseCtx;
    if (!options.noCodeContext) {
        const keywords = extractKeywords(artifactRaw);
        codebaseCtx = await buildCodebaseContext(projectDir, keywords);
        codebaseContextFormatted = formatCodebaseContext(codebaseCtx);
    }
    const messages = buildRevisePrompt({
        artifact: { id: artifactId, type: artifactType, content: artifactRaw },
        parents,
        siblings,
        codebaseContextFormatted,
        sources: [], // Declared-sources loader lands with the revise.yaml config work
        writableScope: options.writableScope ?? 'all',
        canonicalSections: getCanonicalSections(artifactType),
    });
    logger.debug(`reviseArtifact: calling AI for ${artifactId}`);
    const result = await generateJSON(provider, messages, aiReviseDecisionSchema, {
        maxTokens: TOKEN_BUDGETS.revise,
    });
    // resolveArtifactFilename strips the `.md` extension (other callers want the
    // slug form). Revise must write to the full `.md` file, so append the
    // extension explicitly. Defensive fallback if a future version ever returns
    // a filename with the extension intact.
    const filenameNoExt = await resolveArtifactFilename(projectDir, config, artifactType, artifactId);
    const artifactDir = path.join(projectDir, getArtifactDir(config, artifactType));
    const fullFilename = filenameNoExt.endsWith('.md') ? filenameNoExt : `${filenameNoExt}.md`;
    const artifactPath = path.join(artifactDir, fullFilename);
    const verifierContext = {
        projectDir,
        config,
        artifactDir: path.dirname(artifactPath),
        codebaseContextFormatted,
        knownSourceRefs: [], // sources loader (future extension) will populate
        knownPatternRuleIds: codebaseCtx ? codebaseCtx.patternRules.map((r) => r.name) : [],
    };
    return {
        decision: result.result,
        usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
        contextStats: {
            parentsLoaded: parents.length,
            siblingsLoaded: siblings.length,
            codebaseContextIncluded: !!codebaseContextFormatted,
            sourcesLoaded: 0,
        },
        artifactPath,
        originalContent: artifactRaw,
        verifierContext,
    };
}
/**
 * Apply a (verified) decision: write the artifact atomically when
 * `action === 'revise'` and `dryRun` is false, emit an audit entry
 * describing the outcome either way.
 *
 * Caller is expected to have already run `verifyDecision` — `applyDecision`
 * trusts that whatever decision arrives is allowed to be written.
 */
export async function applyDecision(options) {
    const { decision, audit, dryRun, originalContent, artifactPath, backupDir } = options;
    const timestamp = new Date().toISOString();
    if (decision.action === 'skip') {
        audit.appendEntry({
            artifactId: decision.artifactId,
            artifactPath,
            outcome: 'skipped-by-agent',
            rationale: decision.rationale,
            evidence: decision.evidence,
            ambiguous: decision.ambiguous,
            cascadeLevel: options.cascadeLevel,
            timestamp,
        });
        return { outcome: 'skipped-by-agent', wrote: false, diff: '' };
    }
    if (decision.action === 'flag') {
        // When a revise → flag demotion happened upstream, `revisedMarkdown`
        // still holds the agent's proposed rewrite. Include the would-have-been
        // diff in the audit entry so users can see what was rejected and decide
        // whether to hand-apply it.
        const proposedDiff = decision.revisedMarkdown
            ? renderDiff(originalContent, decision.revisedMarkdown, {
                color: false,
                oldLabel: `${decision.artifactId} (before)`,
                newLabel: `${decision.artifactId} (proposed — REJECTED by verifier)`,
            })
            : undefined;
        audit.appendEntry({
            artifactId: decision.artifactId,
            artifactPath,
            outcome: 'flagged',
            rationale: decision.rationale,
            evidence: decision.evidence,
            ambiguous: decision.ambiguous,
            cascadeLevel: options.cascadeLevel,
            ...(proposedDiff ? { diff: proposedDiff } : {}),
            timestamp,
        });
        return { outcome: 'flagged', wrote: false, diff: proposedDiff ?? '' };
    }
    // action === 'revise'
    const diff = decision.revisedMarkdown
        ? renderDiff(originalContent, decision.revisedMarkdown, {
            color: false,
            oldLabel: `${decision.artifactId} (before)`,
            newLabel: `${decision.artifactId} (proposed)`,
        })
        : '';
    // Short-circuit: if the agent returned content that is effectively
    // identical to the original (byte-exact, or only trailing-whitespace
    // differences from markdown serializer normalization), skip the write
    // and report `unchanged-by-agent`. Prevents the "Proposed diff: <empty>
    // → applied" UX bug where a trivial newline-strip got reported as a
    // successful revise even though the agent explicitly said the artifact
    // was already well-structured.
    if (isEffectivelyUnchanged(originalContent, decision.revisedMarkdown)) {
        audit.appendEntry({
            artifactId: decision.artifactId,
            artifactPath,
            outcome: 'unchanged-by-agent',
            rationale: decision.rationale,
            evidence: decision.evidence,
            ambiguous: decision.ambiguous,
            cascadeLevel: options.cascadeLevel,
            timestamp,
        });
        return { outcome: 'unchanged-by-agent', wrote: false, diff: '' };
    }
    if (dryRun) {
        audit.appendEntry({
            artifactId: decision.artifactId,
            artifactPath,
            outcome: 'would-apply',
            rationale: decision.rationale,
            evidence: decision.evidence,
            ambiguous: decision.ambiguous,
            cascadeLevel: options.cascadeLevel,
            diff,
            timestamp,
        });
        return { outcome: 'would-apply', wrote: false, diff };
    }
    // Real apply: atomic write + sidecar backup.
    const backupPath = path.join(backupDir, `${decision.artifactId}.md.bak`);
    await atomicWriteFile(artifactPath, decision.revisedMarkdown ?? '', { backupPath });
    audit.appendEntry({
        artifactId: decision.artifactId,
        artifactPath,
        outcome: 'applied',
        rationale: decision.rationale,
        evidence: decision.evidence,
        ambiguous: decision.ambiguous,
        cascadeLevel: options.cascadeLevel,
        diff,
        timestamp,
    });
    return { outcome: 'applied', wrote: true, diff };
}
/**
 * `true` when the agent's `revisedMarkdown` is byte-identical to `original`,
 * or differs only in trailing whitespace/newlines (LLM markdown serializers
 * routinely drop or add one trailing newline without changing semantics).
 *
 * Exported so the `--apply-from <audit>` replay path and the interactive
 * UI can share the same unchanged-detection rule.
 */
export function isEffectivelyUnchanged(original, revised) {
    if (revised === undefined)
        return true;
    if (revised === original)
        return true;
    return revised.replace(/\s+$/, '') === original.replace(/\s+$/, '');
}
/**
 * Load immediate-sibling artifacts (same artifact type, same parent) as
 * prompt entries. Lazy-reads each sibling's body only if it's going to be
 * included — the listing check is cheap, the reads are budgeted by
 * `maxSiblings` (default 8) so the prompt stays within token budget even on
 * epics with many features.
 *
 * For epic scope, there are no siblings (epics live at the top). For types
 * without a parent-id relationship (quick, backlog, etc.), returns empty.
 */
export async function loadSiblingPromptArtifacts(projectDir, config, type, id, maxSiblings) {
    const parentFieldByType = {
        feature: 'epicId',
        story: 'featureId',
        task: 'storyId',
    };
    const parentField = parentFieldByType[type];
    if (!parentField)
        return [];
    const self = await readArtifact(projectDir, config, type, id);
    if (!self)
        return [];
    const parentId = self.data[parentField];
    if (!parentId)
        return [];
    const siblings = [];
    const listing = await listArtifacts(projectDir, config, type);
    for (const entry of listing) {
        if (siblings.length >= maxSiblings)
            break;
        if (entry.id === id)
            continue;
        const sib = await readArtifact(projectDir, config, type, entry.id);
        if (sib && sib.data[parentField] === parentId) {
            siblings.push({ id: entry.id, type, content: sib.content });
        }
    }
    return siblings;
}
/**
 * Resolve the parent chain for an artifact and return it as the ordered
 * `RevisePromptArtifact[]` the prompt builder expects (epic → feature →
 * story). Empty array for top-level artifacts (epic scope).
 */
export async function loadParentPromptArtifacts(projectDir, config, type, id) {
    const chain = await getParentChain(projectDir, config, type, id);
    const parents = [];
    if (chain.epic) {
        parents.push({
            id: String(chain.epic.data.id),
            type: 'epic',
            content: chain.epic.content,
        });
    }
    if (chain.feature) {
        parents.push({
            id: String(chain.feature.data.id),
            type: 'feature',
            content: chain.feature.content,
        });
    }
    if (chain.story) {
        parents.push({
            id: String(chain.story.data.id),
            type: 'story',
            content: chain.story.content,
        });
    }
    return parents;
}
//# sourceMappingURL=revise-service.js.map