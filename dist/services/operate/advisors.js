import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { AIError } from '../../ai/errors.js';
import { DEFAULT_MODELS } from '../../ai/types.js';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';
import { getAIProvider, isAIConfigured } from '../ai-service.js';
import { loadConfig } from '../config-service.js';
import { canonicalDigest, canonicalize } from './canonical.js';
import { createMissionToolset, MISSION_READ_ONLY_TOOLS, narrowMissionRootsToCeiling, operatingRuntimeEnforcesBoundedReadOnly, resolveOperatingDispatchIsolation, runMissionDispatchFanOut, } from './mission-dispatch.js';
import { assertOperatingArtifact, loadOperatingProtocol, resolveOperatingPipelineRoot, } from './protocol.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import { OPERATE_PROTOCOL_VERSION, OPERATE_SCHEMA_VERSION, OperateError, } from './types.js';
const proposalSchema = z
    .object({
    proposalKey: z.string().regex(/^[A-Za-z0-9._-]+$/),
    type: z.enum(['finding', 'decision', 'data-gap', 'merge', 'sequence']),
    title: z.string().min(1),
    problem: z.string().min(1),
    proposal: z.string().min(1),
    impact: z.number().int().min(1).max(5),
    confidence: z.number().int().min(1).max(5),
    ease: z.number().int().min(1).max(5),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    evidenceRefs: z.array(z.string().regex(/^EVD-[A-Za-z0-9._-]+$/)).min(1),
    dependsOnProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    conflictsWithProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    sequenceProposalKeys: z
        .array(z.string().regex(/^[A-Za-z0-9._-]+$/))
        .min(2)
        .optional(),
})
    .strict();
const advisorOutputSchema = z
    .object({
    outcome: z.enum(['proposals', 'quiet']),
    proposals: z.array(proposalSchema).max(20),
    gaps: z.array(z.string()),
    conflicts: z.array(z.string()),
})
    .strict();
// The Protocol v1.3 mission (`operating-advisor-response@1.3.0`) proposal shape:
// each proposal carries `citations` (repository path / git revision / planr
// artifact, each bound to the cycle's frozen `pinnedRevision`) INSTEAD of the
// v1.2 `evidenceRefs`. The pipeline snapshots each citation after the lens
// returns; OpenPlanr never widens the set. Kept in lockstep with the installed
// `schemas/v1.3.0/operating-citation.schema.json` so a locally parsed response
// and the pipeline-validated one cannot drift.
const missionCitationSchema = z
    .object({
    citationKey: z
        .string()
        .regex(/^[A-Za-z0-9._-]+$/)
        .max(128)
        .optional(),
    repositoryPath: z
        .string()
        .max(1024)
        .regex(/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/)
        .optional(),
    lineRange: z
        .object({ start: z.number().int().min(1), end: z.number().int().min(1) })
        .strict()
        .optional(),
    gitRevision: z
        .string()
        .regex(/^[a-f0-9]{7,64}$/)
        .optional(),
    planrArtifactId: z
        .string()
        .regex(/^(?:EPIC|FEAT|US|SPEC|TASK|ADR|DEC|FND|GAP|OUT)-[A-Za-z0-9._-]+$/)
        .optional(),
    pinnedRevision: z.string().regex(/^[a-f0-9]{7,64}$/),
})
    .strict();
const missionProposalSchema = z
    .object({
    proposalKey: z.string().regex(/^[A-Za-z0-9._-]+$/),
    type: z.enum(['finding', 'decision', 'data-gap', 'merge', 'sequence']),
    title: z.string().min(1),
    problem: z.string().min(1),
    proposal: z.string().min(1),
    impact: z.number().int().min(1).max(5),
    confidence: z.number().int().min(1).max(5),
    ease: z.number().int().min(1).max(5),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    citations: z.array(missionCitationSchema).min(1).max(50),
    dependsOnProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    conflictsWithProposalKeys: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
    sequenceProposalKeys: z
        .array(z.string().regex(/^[A-Za-z0-9._-]+$/))
        .min(2)
        .optional(),
})
    .strict();
const missionAdvisorOutputSchema = z
    .object({
    outcome: z.enum(['proposals', 'quiet']),
    proposals: z.array(missionProposalSchema).max(20),
    gaps: z.array(z.string()),
    conflicts: z.array(z.string()),
})
    .strict();
function v14CitationToMission(value, pinnedRevision) {
    if (value.kind === 'repository') {
        return {
            repositoryPath: String(value.path),
            lineRange: { start: Number(value.startLine), end: Number(value.endLine) },
            pinnedRevision: String(value.revision),
        };
    }
    if (value.kind === 'git') {
        return {
            gitRevision: String(value.revision),
            pinnedRevision: String(value.revision),
        };
    }
    if (value.kind === 'planr') {
        return {
            planrArtifactId: String(value.artifactId),
            pinnedRevision,
        };
    }
    // External citations require a consented connected-research snapshot. They
    // cannot be silently converted into a local repository citation.
    return null;
}
function normalizeAgentNativeResponse(response, pinnedRevision) {
    return {
        outcome: response.actions.length > 0 ? 'proposals' : 'quiet',
        proposals: response.actions.map((action) => ({
            proposalKey: action.actionKey,
            type: action.routeKind === 'decision' ? 'decision' : 'finding',
            title: action.title,
            problem: action.summary,
            proposal: action.summary,
            impact: action.impact ?? 3,
            confidence: action.confidence,
            ease: action.ease ?? 3,
            severity: action.critical
                ? 'critical'
                : (action.impact ?? 3) >= 4
                    ? 'high'
                    : (action.impact ?? 3) >= 3
                        ? 'medium'
                        : 'low',
            citations: action.citations
                .map((citation) => v14CitationToMission(citation, pinnedRevision))
                .filter((citation) => citation !== null),
        })),
        gaps: response.gaps.map((gap) => `${gap.question} Impact: ${gap.impact}`),
        conflicts: response.conflicts.map((conflict) => conflict.summary),
    };
}
export function advisorResponseContractDetails(brief) {
    const examples = brief.output.jsonSchema?.examples;
    return {
        expectedSchema: 'operating-advisor-response@1.2.0',
        example: Array.isArray(examples)
            ? examples
            : [{ outcome: 'quiet', proposals: [], gaps: [], conflicts: [] }],
    };
}
export function assertAdvisorOutputMatchesBrief(brief, output) {
    if (output.proposals.length > brief.output.maximumProposals) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', `Advisor ${brief.role.id} returned ${output.proposals.length} proposals; its canonical limit is ${brief.output.maximumProposals}.`);
    }
    const allowed = new Set(brief.output.allowedProposalTypes);
    const disallowed = [
        ...new Set(output.proposals.map((proposal) => proposal.type).filter((type) => !allowed.has(type))),
    ].sort();
    if (disallowed.length > 0) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', `Advisor ${brief.role.id} returned proposal types outside its canonical brief: ${disallowed.join(', ')}.`);
    }
    if (output.outcome === 'quiet' && output.proposals.length > 0) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', `Advisor ${brief.role.id} declared a quiet result with proposals.`);
    }
    if (output.outcome === 'proposals' && output.proposals.length === 0) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', `Advisor ${brief.role.id} declared proposals without a proposal.`);
    }
    const outputBytes = Buffer.byteLength(canonicalize(output), 'utf8');
    if (outputBytes > brief.output.maximumOutputBytes) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', `Advisor ${brief.role.id} exceeded its canonical output budget.`);
    }
}
const CHARTER_FIELDS_BY_ROLE = {
    'strategy-finance': [
        'purpose',
        'stage',
        'businessModel',
        'goals',
        'constraints',
        'successMetrics',
    ],
    'technology-risk': ['purpose', 'stage', 'goals', 'constraints', 'guardrails', 'knownUnknowns'],
    'product-activation': [
        'purpose',
        'stage',
        'idealCustomer',
        'goals',
        'successMetrics',
        'knownUnknowns',
    ],
    'growth-market': [
        'purpose',
        'stage',
        'businessModel',
        'idealCustomer',
        'goals',
        'successMetrics',
    ],
    'operations-customer': [
        'purpose',
        'stage',
        'idealCustomer',
        'goals',
        'constraints',
        'guardrails',
        'knownUnknowns',
    ],
    chair: [
        'purpose',
        'stage',
        'businessModel',
        'idealCustomer',
        'goals',
        'constraints',
        'successMetrics',
        'guardrails',
        'knownUnknowns',
    ],
};
function boundedContextText(value, maximum = 1_024) {
    const text = typeof value === 'string' ? value : '';
    return sanitizeGeneratedPlainText(text).replace(/\s+/g, ' ').trim().slice(0, maximum);
}
function charterSection(markdown, heading) {
    const normalized = markdown.replace(/\r\n?/g, '\n');
    const marker = `## ${heading}`;
    const start = normalized.indexOf(marker);
    if (start < 0)
        return [];
    const body = normalized.slice(start + marker.length);
    const end = body.search(/\n##\s+/);
    return (end >= 0 ? body.slice(0, end) : body)
        .split('\n')
        .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1] ?? '')
        .map((line) => boundedContextText(line))
        .filter((line) => line && !line.startsWith('[unknown') && !line.startsWith('[none recorded'));
}
function parseOperatingCharter(markdown) {
    const product = charterSection(markdown, 'Product context');
    const productValues = new Map(product.flatMap((line) => {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        return match ? [[match[1].trim().toLowerCase(), match[2].trim()]] : [];
    }));
    return {
        purpose: productValues.get('purpose') ?? '',
        stage: productValues.get('stage') ?? '',
        businessModel: productValues.get('business model') ?? '',
        idealCustomer: productValues.get('ideal customer') ?? '',
        goals: charterSection(markdown, 'Current goals').sort(),
        constraints: charterSection(markdown, 'Constraints').sort(),
        successMetrics: charterSection(markdown, 'Success metrics').sort(),
        guardrails: charterSection(markdown, 'Guardrails').sort(),
        knownUnknowns: charterSection(markdown, 'Known unknowns').sort(),
    };
}
function recordEvidenceRefs(record) {
    return Array.isArray(record.evidenceRefs)
        ? [
            ...new Set(record.evidenceRefs.filter((reference) => typeof reference === 'string')),
        ].sort()
        : [];
}
function openItem(record, summaryKeys) {
    const summary = summaryKeys.map((key) => boundedContextText(record[key])).find(Boolean) ?? 'Review required.';
    return {
        id: record.id,
        status: record.status,
        summary,
        owner: boundedContextText(record.owner) || null,
        evidenceRefs: recordEvidenceRefs(record),
        ...(Array.isArray(record.affectedRoles)
            ? {
                affectedRoles: [
                    ...new Set(record.affectedRoles.filter((role) => typeof role === 'string')),
                ].sort(),
            }
            : {}),
    };
}
/** Build the immutable non-advisor context shared by all independent lenses. */
export async function buildAdvisorOperatingContext(input) {
    const charter = parseOperatingCharter(await readFile(input.charterPath, 'utf8'));
    const prior = [...input.state.cycles]
        .filter((cycle) => cycle.id !== input.cycleId)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .at(-1);
    const priorCycle = prior
        ? {
            id: prior.id,
            state: prior.state,
            health: typeof prior.health === 'string' ? prior.health : null,
            findings: input.state.findings.filter((finding) => finding.cycleId === prior.id).length,
            decisions: input.state.decisions.filter((decision) => decision.cycleId === prior.id).length,
            gaps: input.state.dataGaps.filter((gap) => gap.cycleId === prior.id).length,
            pendingOutcomes: input.state.outcomes.filter((outcome) => outcome.sourceCycle === prior.id && outcome.status === 'pending').length,
        }
        : null;
    const openDecisions = input.state.decisions
        .filter((decision) => ['open', 'default-due'].includes(decision.status))
        .map((decision) => openItem(decision, ['question', 'recommendation']))
        .sort((left, right) => left.id.localeCompare(right.id));
    const openGaps = input.state.dataGaps
        .filter((gap) => ['open', 'answered'].includes(gap.status))
        .map((gap) => openItem(gap, ['question', 'reason']))
        .sort((left, right) => left.id.localeCompare(right.id));
    const pendingOutcomes = input.state.outcomes
        .filter((outcome) => ['pending', 'observing', 'inconclusive'].includes(outcome.status))
        .map((outcome) => openItem(outcome, ['metric', 'queryIdentity']))
        .sort((left, right) => left.id.localeCompare(right.id));
    const unsigned = {
        charter,
        priorCycle,
        openDecisions,
        openGaps,
        pendingOutcomes,
    };
    return { ...unsigned, snapshotDigest: canonicalDigest(unsigned) };
}
function roleContext(context, roleId, permittedEvidenceRefs) {
    const charter = Object.fromEntries(CHARTER_FIELDS_BY_ROLE[roleId].map((field) => [field, structuredClone(context.charter[field])]));
    const visible = (item) => {
        if (roleId === 'chair')
            return true;
        if (item.affectedRoles && item.affectedRoles.length > 0) {
            return item.affectedRoles.includes(roleId);
        }
        return (item.evidenceRefs.length === 0 ||
            item.evidenceRefs.some((reference) => permittedEvidenceRefs.has(reference)));
    };
    const filtered = {
        charter,
        priorCycle: context.priorCycle,
        openDecisions: context.openDecisions.filter(visible),
        openGaps: context.openGaps.filter(visible),
        pendingOutcomes: context.pendingOutcomes.filter(visible),
    };
    return { ...filtered, snapshotDigest: canonicalDigest(filtered) };
}
let cachedMandateApi = null;
async function loadOperatingMandateApi() {
    cachedMandateApi ??= (async () => {
        const root = resolveOperatingPipelineRoot({ requireMission: true });
        if (!root) {
            throw new OperateError('E_OPERATE_MISSION_UNAVAILABLE', 'Mandate dispatch requires the pipeline package with Protocol v1.3 (operating mandate).');
        }
        const loaded = (await import(pathToFileURL(path.join(root, 'lib', 'operate', 'mandate.mjs')).href));
        if (typeof loaded.createOperatingMandate !== 'function') {
            throw new OperateError('E_PIPELINE_VERSION_INCOMPATIBLE', 'Installed planr-pipeline does not export the Protocol v1.3 operating mandate builder.');
        }
        return loaded;
    })();
    return cachedMandateApi;
}
/**
 * Build the Protocol v1.3 operating mandate for a role (FR1). The mandate's
 * boundaries are declared directly from the caller's granted workspace roots —
 * never an evidence-index-derived subset — so a gitignored `.planr/` tree is
 * fully readable when the caller declares it. The registry supplies the lens
 * question, investigation mandate, and sensitivity ceiling; this function only
 * threads the declared boundaries through.
 */
export async function buildOperatingMandate(input) {
    const api = await loadOperatingMandateApi();
    return api.createOperatingMandate(input.roleId, {
        roots: [...input.roots],
        forbiddenPaths: [...(input.forbiddenPaths ?? [])],
        runtime: input.runtime,
        protocolVersion: input.protocolVersion,
    });
}
// A mandate's `boundaries.roots` items must satisfy this pattern (leading dot
// permitted, no `..` traversal), so `.planr` is a valid declared root.
const INLINE_MANDATE_ROOT_PATTERN = /^(?!.*\.\.)[A-Za-z0-9._][A-Za-z0-9._/-]*$/;
/**
 * FR1/FR2: derive a mandate's declared read roots directly from the project
 * working tree — every top-level directory the agent may traverse — for the
 * inline dispatch path. `.planr/` is ALWAYS declared, whether or not it exists
 * yet and REGARDLESS of git tracking, because the mission tool surface walks the
 * filesystem directly rather than a tracked-file inventory, so a gitignored `.planr/` tree
 * is fully readable (finding 2's tracked-file gap cannot reproduce here).
 * `.git`/`node_modules` are never declared, and every root is filtered to the
 * mandate's schema pattern. Mirrors the native adapter path's derivation so both
 * dispatch paths declare identical boundaries.
 */
export async function deriveOperatingMandateRoots(projectRoot) {
    const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => []);
    const roots = new Set(['.planr']);
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        if (entry.name === '.git' || entry.name === 'node_modules')
            continue;
        if (INLINE_MANDATE_ROOT_PATTERN.test(entry.name))
            roots.add(entry.name);
    }
    return [...roots].sort();
}
/**
 * Convert a compact native-harness response into the canonical, digest-bound
 * Protocol result. Runtime adapters should not manufacture protocol metadata,
 * producer fields, or JCS digests themselves.
 */
function sanitizeMissionOutput(output) {
    return {
        outcome: output.outcome,
        proposals: output.proposals
            .map((proposal) => ({
            ...proposal,
            title: sanitizeGeneratedPlainText(proposal.title).replace(/\s+/g, ' ').trim(),
            problem: sanitizeGeneratedPlainText(proposal.problem).replace(/\s+/g, ' ').trim(),
            proposal: sanitizeGeneratedPlainText(proposal.proposal).replace(/\s+/g, ' ').trim(),
            citations: [...proposal.citations],
            ...(proposal.dependsOnProposalKeys
                ? {
                    dependsOnProposalKeys: [...new Set(proposal.dependsOnProposalKeys)].sort(),
                }
                : {}),
            ...(proposal.conflictsWithProposalKeys
                ? {
                    conflictsWithProposalKeys: [...new Set(proposal.conflictsWithProposalKeys)].sort(),
                }
                : {}),
            ...(proposal.sequenceProposalKeys
                ? { sequenceProposalKeys: [...proposal.sequenceProposalKeys] }
                : {}),
        }))
            .sort((left, right) => left.proposalKey.localeCompare(right.proposalKey) ||
            left.type.localeCompare(right.type) ||
            left.problem.localeCompare(right.problem)),
        gaps: [...new Set(output.gaps.map(sanitizeGeneratedPlainText))].sort(),
        conflicts: [...new Set(output.conflicts.map(sanitizeGeneratedPlainText))].sort(),
    };
}
/**
 * The mandate's response contract is `operating-advisor-response@1.3.0`, whose
 * output facet mirrors the v1.2 brief's contract (allowed proposal types,
 * maxima), so a v1.3 response is validated against exactly the same invariants a
 * pack response is — reusing the pipeline's registry-derived brief as the single
 * source of truth.
 *
 * FR2: when the response's citations resolve to ZERO evidence IDs across every
 * proposal, the role commits `not_evaluated` — a schema-legal `quiet` result
 * (the frozen v1.2 role-result schema admits no `not_evaluated` outcome; the
 * not_evaluated state lives in the governed gap + the integrity surface) — and
 * the governed empty-grounding gap the citation gate opened is returned, with
 * `notEvaluated: true`, rather than a `quiet` that pretends the lens evaluated.
 */
export async function createNativeMissionOperatingRoleResult(input) {
    const protocol = await loadOperatingProtocol();
    const responseProtocol = input.mandate.protocolVersion === '1.4.0' ? '1.4.0' : '1.3.0';
    // Compact responses carry no protocol envelope, so select the schema from the
    // immutable mandate instead of allowing additive resolution to guess.
    const contractIssues = protocol.validateProtocolArtifact('operating-advisor-response', input.response, { protocolVersion: responseProtocol });
    if (contractIssues.length > 0) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', `Native ${input.mandate.roleId} response does not match operating-advisor-response@${responseProtocol}.`, { issues: contractIssues.slice(0, 8) });
    }
    let output;
    if (responseProtocol === '1.4.0') {
        const response = input.response;
        output = sanitizeMissionOutput(normalizeAgentNativeResponse(response, input.pinnedRevision ?? '0000000'));
    }
    else {
        const parsed = missionAdvisorOutputSchema.safeParse(input.response);
        if (!parsed.success) {
            throw new OperateError('E_OPERATE_INTERNAL', 'Protocol and OpenPlanr disagree on the v1.3 mission advisor response contract.', {
                issues: parsed.error.issues.slice(0, 8).map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                })),
            });
        }
        output = sanitizeMissionOutput(parsed.data);
    }
    const brief = protocol.createOperatingAdvisorBrief(input.mandate.roleId);
    assertAdvisorOutputMatchesBrief(brief, output);
    const capability = brief.role.capabilityTier;
    // The intermediate result: proposals carry their v1.3 citations and an empty
    // evidenceRefs set. It is deliberately NOT yet a v1.2-valid committed
    // operating-role-result — the citation gate mints the evidenceRefs that make
    // it one. `inputDigest` is the mandate's digest, so the record path's
    // input-digest binding (prepare stored the same mandate digest) holds.
    const intermediate = {
        kind: 'operating-role-result',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        cycleId: input.cycleId,
        roleId: input.mandate.roleId,
        inputDigest: input.mandate.mandateDigest,
        resultDigest: input.mandate.mandateDigest,
        outcome: output.outcome,
        proposals: output.proposals.map((proposal) => ({
            proposalKey: proposal.proposalKey,
            type: proposal.type,
            title: proposal.title,
            problem: proposal.problem,
            proposal: proposal.proposal,
            impact: proposal.impact,
            confidence: proposal.confidence,
            ease: proposal.ease,
            severity: proposal.severity,
            evidenceRefs: [],
            ...(proposal.dependsOnProposalKeys
                ? { dependsOnProposalKeys: proposal.dependsOnProposalKeys }
                : {}),
            ...(proposal.conflictsWithProposalKeys
                ? { conflictsWithProposalKeys: proposal.conflictsWithProposalKeys }
                : {}),
            ...(proposal.sequenceProposalKeys
                ? { sequenceProposalKeys: proposal.sequenceProposalKeys }
                : {}),
            citations: proposal.citations,
        })),
        gaps: output.gaps,
        conflicts: output.conflicts,
        producer: {
            product: 'openplanr',
            version: OPENPLANR_VERSION,
            runtime: input.runtime,
            capability,
        },
    };
    // A quiet response has no proposals/citations, so it never touches the gate; a
    // proposals response threads its citations through the already-live gate.
    const gated = output.proposals.length > 0
        ? await input.resolveCitations([intermediate])
        : {
            roleResults: [intermediate],
            gaps: [],
            notEvaluatedRoleIds: [],
        };
    const resolved = gated.roleResults[0] ?? intermediate;
    // FR2: a proposals response whose citations resolved to ZERO evidence is
    // not_evaluated — the gate returned this role in `notEvaluatedRoleIds` and
    // opened the governed empty-grounding gap. The committed artifact is a
    // schema-legal `quiet` result (no proposals); the not_evaluated state is
    // carried by the gap and the returned flag.
    const notEvaluated = gated.notEvaluatedRoleIds.includes(input.mandate.roleId);
    // Finalize into a v1.2-valid committed operating-role-result: strip the
    // now-resolved citations, keep the minted evidenceRefs, and let the surviving
    // proposal count set the honest outcome (a not_evaluated response commits as
    // quiet, its grounding failure preserved only as the opened gaps).
    const survivingProposals = notEvaluated
        ? []
        : resolved.proposals
            .map((proposal) => {
            const { citations: _citations, ...rest } = proposal;
            return rest;
        })
            .filter((proposal) => proposal.evidenceRefs.length > 0);
    const unsigned = {
        kind: 'operating-role-result',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        cycleId: input.cycleId,
        roleId: input.mandate.roleId,
        inputDigest: input.mandate.mandateDigest,
        outcome: survivingProposals.length > 0 ? 'proposals' : 'quiet',
        proposals: survivingProposals,
        gaps: output.gaps,
        conflicts: output.conflicts,
        producer: {
            product: 'openplanr',
            version: OPENPLANR_VERSION,
            runtime: input.runtime,
            capability,
        },
    };
    const result = {
        ...unsigned,
        resultDigest: protocol.computeOperatingRoleResultDigest(unsigned),
    };
    await assertOperatingArtifact('operating-role-result', result);
    protocol.validateOperatingRoleResultDigest(result);
    return { result, gaps: gated.gaps, notEvaluated };
}
function safeFailureMessage(error) {
    try {
        return sanitizeGeneratedPlainText(error instanceof Error ? error.message : String(error));
    }
    catch {
        return 'Advisor failed with an unsafe or unredactable diagnostic.';
    }
}
export function assertAdvisorIsolation(adapter) {
    if (adapter.mode === 'native-isolated' &&
        !['enforced', 'advisory', 'none'].includes(adapter.toolIsolation)) {
        throw new OperateError('E_OPERATE_ADVISOR_ISOLATION', 'Native runtime advisors must declare their runtime-governed tool isolation.');
    }
    if (adapter.mode === 'structured' && adapter.toolIsolation !== 'not-applicable') {
        throw new OperateError('E_OPERATE_ADVISOR_ISOLATION', 'Structured provider adapters must declare toolIsolation=not-applicable.');
    }
}
export function createOfflineAdvisorAdapter(fixture) {
    return {
        id: 'offline-fixture',
        mode: 'structured',
        toolIsolation: 'not-applicable',
        capability: 'analysis-standard',
        parallelDispatch: false,
        async invoke(input) {
            if (fixture?.[input.roleId] !== undefined)
                return fixture[input.roleId];
            return input.mandate.protocolVersion === '1.4.0'
                ? {
                    outcome: 'quiet',
                    analysisMarkdown: `# ${input.roleBrief.role.displayLabel}\n\nOffline fixture mode produced no recommendations.`,
                    claims: [],
                    actions: [],
                    gaps: [],
                    conflicts: [],
                }
                : { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
        },
    };
}
class OpenPlanrStructuredAdapter {
    id;
    mode = 'structured';
    toolIsolation = 'not-applicable';
    capability = 'analysis-high';
    parallelDispatch = false;
    constructor(providerName) {
        this.id = `openplanr-${providerName}`;
    }
    async invoke(input) {
        void input;
        throw new OperateError('E_OPERATE_PROVIDER_DEPRECATED', 'The structured-provider advisor path is deprecated; dispatch now runs through the native Protocol v1.3 mandate harness. See https://openplanr.dev/docs/operate/agent-harness. Scheduled for removal in OpenPlanr 2.0.0.');
    }
}
/** Redacted error class label for diagnostics — no message or stack, ever. */
function redactedProviderErrorClass(error) {
    if (error instanceof AIError)
        return `AIError:${error.code}`;
    if (error instanceof Error && typeof error.name === 'string' && error.name.length > 0) {
        return error.name;
    }
    return 'UnknownError';
}
/**
 * Build the actionable remedy for a failed structured-provider bootstrap,
 * preserving the underlying provider guidance (e.g. the `planr config set-key`
 * block an AIError already carries) and always naming the `--offline` escape.
 */
function structuredProviderBootstrapRemedy(error, provider) {
    const detail = error instanceof AIError
        ? error.userMessage
        : error instanceof Error
            ? error.message
            : String(error);
    const trimmed = detail.trim();
    const suffixParts = [];
    if (!/config set-key/.test(trimmed)) {
        suffixParts.push(`Configure a key with \`planr config set-key ${provider ?? '<provider>'}\``);
    }
    if (!/--offline/.test(trimmed)) {
        suffixParts.push('or run the cycle offline with --offline');
    }
    const suffix = suffixParts.length > 0 ? ` ${suffixParts.join(' ')}.` : '';
    return `Structured AI provider bootstrap failed: ${trimmed}${suffix}`;
}
export async function createConfiguredStructuredAdapter(projectRoot, options = {}) {
    // `planr operate init` writes .planr/operate/config.json, not the project-wide
    // .planr/config.json that loadConfig requires. A project that ran only the
    // operate initializer therefore reaches this with no OpenPlanr config at all,
    // and loadConfig throws ConfigNotFoundError — an untyped failure that surfaces
    // as "an unexpected internal Operating Board error" on the primary first-run
    // path. Both the missing config and the unconfigured provider mean the same
    // thing to the operator, so both resolve to the same actionable error.
    const config = await loadConfig(projectRoot).catch(() => null);
    if (!config || !isAIConfigured(config)) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', 'No structured AI provider is configured; use --offline or configure OpenPlanr AI.');
    }
    // A named provider whose key cannot be resolved in this (possibly sandboxed)
    // subprocess environment makes getAIProvider throw a raw AIError. Left
    // unguarded it reaches index.ts's failure() as E_OPERATE_INTERNAL — the exact
    // masked crash the audit reproduced. Convert any provider-bootstrap failure
    // into a typed E_OPERATE_ADVISOR_FAILED that preserves the actionable remedy
    // (`planr config set-key …` / `--offline`) and records a redacted error class.
    let provider;
    try {
        provider = await getAIProvider(config, {
            surface: 'operate-structured-provider',
        });
    }
    catch (error) {
        throw new OperateError('E_OPERATE_ADVISOR_FAILED', structuredProviderBootstrapRemedy(error, config.ai?.provider), { errorClass: redactedProviderErrorClass(error) });
    }
    void provider;
    void options;
    return new OpenPlanrStructuredAdapter(config.ai?.provider ?? 'ai');
}
export async function dispatchOperatingAdvisors(input) {
    assertAdvisorIsolation(input.adapter);
    const protocol = await loadOperatingProtocol();
    const roleRegistry = protocol.listOperatingRoles();
    // Canonical registry order so results and provenance are byte-identical across
    // parallel/sequential dispatch and across the order roles arrive in (FR4).
    const roleOrder = new Map(roleRegistry.map((role, index) => [role.id, index]));
    // The runtime's isolation level is recorded once per dispatch. Protocol v1.4
    // permits compatible native-agent workflows under runtime-governed session
    // permissions; citation and schema validation still gate persistence.
    const runtimeEnforcesBoundedReadOnly = await operatingRuntimeEnforcesBoundedReadOnly(input.runtime);
    // A structured adapter cannot host a native lens. A native-isolated adapter
    // can host either an enforced or runtime-governed native workflow.
    const adapterNativeCapable = input.adapter.mode === 'native-isolated';
    const runtimeWorkflowCapable = adapterNativeCapable;
    const resolveIsolation = (roleId) => resolveOperatingDispatchIsolation({
        roleId,
        runtimeEnforcesBoundedReadOnly,
        adapterNativeCapable,
        runtimeWorkflowCapable,
    });
    // FR1/FR2: the mandate's declared read roots are the whole granted workspace —
    // including a gitignored `.planr/` — never an evidence-index subset. Derived
    // once and shared by every role's mandate on this path.
    const roots = await deriveOperatingMandateRoots(input.projectRoot);
    const skipped = [];
    const runnable = [];
    for (const role of input.readiness.roles) {
        if (!role.modelCallAllowed || role.readiness === 'not_evaluated') {
            skipped.push({
                roleId: role.roleId,
                gapId: role.gapId,
                reason: role.missingEvidence.join('; '),
            });
            continue;
        }
        runnable.push(role);
    }
    async function dispatchRole(role) {
        // Resolve THIS role's dispatch mode once and derive provenance from what is
        // actually dispatched below — never re-derived after the fact. A role that
        // resolves to a native bounded lens has its read-only tool grant enforced
        // before the lens runs (below); `isolation` can only read
        // `enforced-read-only-bounded` when the bounded grant was genuinely enforced.
        const resolution = resolveIsolation(role.roleId);
        const dispatch = {
            isolation: resolution.isolation,
            reconciliation: resolution.reconciliation,
        };
        let mandate;
        try {
            // FR1: a body-free operating mandate — the lens question, declared read
            // boundaries, and citation requirement — replaces the curated evidence pack.
            mandate = await buildOperatingMandate({
                roleId: role.roleId,
                roots,
                runtime: input.runtime ?? input.adapter.id,
                protocolVersion: input.protocolVersion ?? '1.3.0',
            });
        }
        catch (error) {
            return {
                ok: false,
                roleId: role.roleId,
                message: safeFailureMessage(error),
                modelCalls: 0,
                dispatch,
            };
        }
        const roleBrief = protocol.createOperatingAdvisorBrief(role.roleId);
        const context = roleContext(input.context, role.roleId, new Set());
        if (resolution.native) {
            // Confine the native lens to the bounded read-only toolset over the
            // mandate's declared roots. Constructing the toolset is what makes
            // `enforced-read-only-bounded` true; a callable outside the read-only grant
            // simply does not exist on the surface it hands the lens.
            const grantedRoots = narrowMissionRootsToCeiling({
                declaredRoots: mandate.boundaries.roots,
                forbiddenPaths: mandate.boundaries.forbiddenPaths,
            });
            const toolset = createMissionToolset({
                roots: grantedRoots,
                ceiling: mandate.boundaries.sensitivityCeiling,
            });
            const grantedTools = Object.keys(toolset);
            if (grantedTools.some((tool) => !MISSION_READ_ONLY_TOOLS.includes(tool))) {
                throw new OperateError('E_OPERATE_PROVIDER_READ_ONLY', `Mission dispatch for ${role.roleId} assembled a tool outside the bounded read-only grant.`);
            }
        }
        let built;
        let lastError;
        let roleModelCalls = 0;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                roleModelCalls += 1;
                const response = await input.adapter.invoke({
                    roleId: role.roleId,
                    roleBrief,
                    mandate,
                    pinnedRevision: input.pinnedRevision,
                    context,
                    inputDigest: mandate.mandateDigest,
                });
                // The mandate response's citations flow into the injected universal gate,
                // which mints the evidenceRefs that make the committed result v1.2-valid;
                // a response that grounds zero evidence commits not_evaluated (quiet) with
                // a governed gap. Identical finalization to the native adapter record path.
                built = await createNativeMissionOperatingRoleResult({
                    mandate,
                    cycleId: input.cycleId,
                    response,
                    runtime: input.runtime ?? input.adapter.id,
                    pinnedRevision: input.pinnedRevision,
                    resolveCitations: input.resolveCitations,
                });
                break;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (!built) {
            return {
                ok: false,
                roleId: role.roleId,
                message: safeFailureMessage(lastError),
                modelCalls: roleModelCalls,
                dispatch,
            };
        }
        return {
            ok: true,
            result: built.result,
            gaps: built.gaps,
            modelCalls: roleModelCalls,
            dispatch,
        };
    }
    // Fan the per-role dispatch out in parallel where the adapter reports it,
    // sequentially otherwise. Results are sorted into canonical registry order
    // below so the reduced events are byte-identical across parallel and sequential
    // dispatch and across dispatch order (FR4/E-004).
    const dispatched = await runMissionDispatchFanOut({
        items: runnable,
        parallel: Boolean(input.adapter.parallelDispatch),
        run: (role) => dispatchRole(role),
    });
    const dispatchByRole = new Map();
    for (const entry of dispatched) {
        dispatchByRole.set(entry.ok ? entry.result.roleId : entry.roleId, entry.dispatch);
    }
    const okEntries = dispatched.filter((entry) => entry.ok);
    const results = okEntries
        .map((entry) => entry.result)
        .sort((left, right) => (roleOrder.get(left.roleId) ?? Number.MAX_SAFE_INTEGER) -
        (roleOrder.get(right.roleId) ?? Number.MAX_SAFE_INTEGER));
    // The governed gaps opened while resolving each role's citations (unresolvable
    // citations, empty grounding) are threaded back so the engine records them
    // alongside the cycle's other gaps.
    const gaps = okEntries.flatMap((entry) => entry.gaps);
    const failed = dispatched
        .filter((entry) => !entry.ok)
        .map(({ roleId, message }) => ({ roleId, message }));
    const modelCalls = dispatched.reduce((total, entry) => total + entry.modelCalls, 0);
    return {
        results,
        provenance: results.map((result) => {
            const dispatchProvenance = dispatchByRole.get(result.roleId) ?? {
                isolation: resolveIsolation(result.roleId).isolation,
                reconciliation: resolveIsolation(result.roleId).reconciliation,
            };
            return {
                roleId: result.roleId,
                runtime: input.runtime ?? input.adapter.id,
                adapterId: input.adapter.id,
                capability: input.adapter.capability,
                dispatch: input.adapter.parallelDispatch ? 'parallel' : 'sequential',
                isolation: dispatchProvenance.isolation,
                reconciliation: dispatchProvenance.reconciliation,
            };
        }),
        skipped,
        failed,
        gaps,
        blocked: failed.some((entry) => entry.roleId === 'chair') ||
            (input.depth === 'deep' && failed.length > 0),
        modelCalls,
    };
}
/**
 * Standard-cycle advisor failures are governed data gaps, not ephemeral
 * warnings. IDs are temporary and are remapped against canonical state by the
 * cycle engine before persistence.
 */
export async function advisorFailureGaps(input) {
    const readinessByRole = new Map(input.readiness.roles.map((role) => [role.roleId, role]));
    const gaps = [...input.failed]
        .sort((left, right) => left.roleId.localeCompare(right.roleId))
        .map(({ roleId, message }, index) => {
        const role = readinessByRole.get(roleId);
        return {
            kind: 'operating-data-gap',
            schemaVersion: OPERATE_SCHEMA_VERSION,
            protocolVersion: OPERATE_PROTOCOL_VERSION,
            id: `GAP-${String(index + 1).padStart(3, '0')}`,
            cycleId: input.cycleId,
            question: `What recovery or verified evidence is required to evaluate ${roleId}?`,
            reason: `Advisor ${roleId} failed after its bounded retry: ${safeFailureMessage(message)}`,
            unblocks: [],
            affectedRoles: [roleId],
            status: 'open',
            owner: input.owner,
            evidenceRefs: [...new Set(role?.evidenceRefs ?? [])].sort(),
            createdAt: input.now,
            updatedAt: input.now,
        };
    });
    await Promise.all(gaps.map((gap) => assertOperatingArtifact('operating-data-gap', gap)));
    return gaps;
}
export async function readProviderConsent(projectRoot, providerId) {
    return readFile(path.join(projectRoot, '.planr', 'operate', 'providers', `${providerId}.json`), 'utf8')
        .then(async (raw) => {
        const manifest = JSON.parse(raw);
        await assertOperatingArtifact('operating-provider-manifest', manifest);
        (await loadOperatingProtocol()).validateOperatingProviderPolicyDigest(manifest);
        return manifest;
    })
        .catch(() => null);
}
function providerPolicyCandidate(input, acceptedAt, existing) {
    return {
        kind: 'operating-provider-manifest',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        id: input.id,
        providerId: input.providerId,
        providerVersion: input.providerVersion,
        mode: input.mode,
        readOnly: true,
        endpoint: structuredClone(input.endpoint),
        permittedDataClasses: [...new Set(input.permittedDataClasses)].sort(),
        retention: structuredClone(input.retention),
        capabilities: {
            incremental: input.incremental,
            deep: input.deep,
            toolIsolation: input.toolIsolation,
        },
        limits: structuredClone(input.limits),
        consent: {
            policyVersion: input.consentPolicyVersion,
            status: existing ? 'renewed' : 'first-use',
            acceptedAt: existing?.consent.acceptedAt ?? acceptedAt,
            renewedAt: existing ? acceptedAt : null,
            nextReviewAt: new Date(Date.parse(acceptedAt) + 180 * 24 * 60 * 60 * 1_000).toISOString(),
            renewalTriggers: [...new Set(input.renewalTriggers)].sort(),
        },
        policyDigest: `sha256:${'0'.repeat(64)}`,
        configurationDigest: input.configurationDigest,
        capturedAt: acceptedAt,
    };
}
/**
 * Build and, only after explicit authority, persist the credential-free policy
 * that controls a remote advisor call. Keys and endpoint secrets never enter
 * the manifest.
 */
export async function ensureOperatingProviderConsent(input) {
    const existing = await readProviderConsent(input.projectRoot, input.provider.providerId);
    const now = input.now ?? new Date().toISOString();
    const protocol = await loadOperatingProtocol();
    const candidate = providerPolicyCandidate(input.provider, now, existing);
    candidate.policyDigest = protocol.computeOperatingProviderPolicyDigest(candidate);
    await assertOperatingArtifact('operating-provider-manifest', candidate);
    protocol.validateOperatingProviderPolicyDigest(candidate);
    const changed = !existing ||
        existing.policyDigest !== candidate.policyDigest ||
        existing.configurationDigest !== candidate.configurationDigest ||
        Date.parse(existing.consent.nextReviewAt ?? '1970-01-01') <= Date.parse(now);
    if (!changed)
        return { manifest: existing, changed: false };
    if (!input.confirmed) {
        throw new OperateError('E_OPERATE_AUTHORITY_REQUIRED', 'The disclosed provider policy requires explicit first-use or renewal consent.', {
            provider: candidate.providerId,
            endpoint: candidate.endpoint,
            permittedDataClasses: candidate.permittedDataClasses,
            retention: candidate.retention,
            limits: candidate.limits,
            policyDigest: candidate.policyDigest,
        });
    }
    if (input.persist !== false) {
        const directory = path.join(input.projectRoot, '.planr', 'operate', 'providers');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const target = path.join(directory, `${candidate.providerId}.json`);
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${canonicalize(candidate)}\n`, { mode: 0o600 });
        await rename(temporary, target);
    }
    return { manifest: candidate, changed: true };
}
function providerEndpoint(config) {
    const provider = config.ai?.provider ?? 'openai';
    const configuredUrl = config.ai?.ollamaBaseUrl?.trim();
    const defaultUrl = provider === 'anthropic'
        ? 'https://api.anthropic.com'
        : provider === 'openai'
            ? 'https://api.openai.com'
            : 'http://127.0.0.1:11434';
    const identity = configuredUrl || defaultUrl;
    let display = provider === 'ollama' ? 'local Ollama' : `${provider} API`;
    try {
        const parsed = new URL(identity);
        display = `${provider} @ ${parsed.origin}`;
    }
    catch {
        display = `${provider} @ configured endpoint`;
    }
    return {
        kind: provider === 'ollama' ? 'local' : 'remote',
        display,
        authentication: provider === 'ollama' ? 'none' : 'machine-local',
        identity,
    };
}
export function configuredAdvisorProviderPolicy(input) {
    const provider = input.config.ai?.provider ?? 'openai';
    const model = input.config.ai?.model ?? DEFAULT_MODELS[provider];
    const endpoint = providerEndpoint(input.config);
    const local = endpoint.kind === 'local';
    const configurationDigest = canonicalDigest({
        provider,
        model,
        endpoint: endpoint.identity,
        runtime: input.runtime,
        adapterId: input.adapterId,
        permittedDataClasses: [
            'source-code',
            'planning-artifacts',
            'git-metadata',
            'issue-metadata',
            'project-metadata',
        ],
        retention: local
            ? { providerStoresRequestContent: false, maxProviderRetentionDays: 0 }
            : { providerStoresRequestContent: true, maxProviderRetentionDays: 30 },
    });
    return {
        id: `PRV-openplanr-${provider}`,
        providerId: `openplanr-${provider}`,
        providerVersion: '1.0.0',
        mode: 'structured',
        toolIsolation: 'not-applicable',
        endpoint: {
            kind: endpoint.kind,
            display: `${endpoint.display} · ${model}`,
            authentication: endpoint.authentication,
            redacted: true,
        },
        permittedDataClasses: [
            'source-code',
            'planning-artifacts',
            'git-metadata',
            'issue-metadata',
            'project-metadata',
        ],
        retention: {
            providerStoresRequestContent: !local,
            maxProviderRetentionDays: local ? 0 : 30,
            localEvidenceRetention: 'cycle',
        },
        incremental: false,
        deep: true,
        limits: {
            maxItems: 2_000,
            maxBytes: 10 * 1024 * 1024,
            maxDurationMs: 60_000,
            maxRequests: 12,
            maxTokens: 49_152,
            maxCostUsd: null,
        },
        consentPolicyVersion: '1.0.0',
        renewalTriggers: ['policy-change', 'scope-expansion', 'credential-renewal', 'scheduled-review'],
        configurationDigest,
    };
}
//# sourceMappingURL=advisors.js.map