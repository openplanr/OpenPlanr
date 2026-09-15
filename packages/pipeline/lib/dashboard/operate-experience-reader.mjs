import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
	assertOperateExperienceArtifactV2,
	assertProtocolArtifact,
} from "../protocol/contracts.mjs";
import { sha256Jcs } from "../protocol/jcs.mjs";
import {
	buildOperateReviewWorkspacePayloadV1,
	deriveOperateSharedTruthSummaryV1,
} from "./operate-review-workspace-projection-v2.mjs";
import { issueOperateExperienceAuditDisplaySurfaceV1 } from "./operate-experience-audit-display-contract.mjs";
import {
	issueOperateActionDisplayWorkspaceV1,
	issueOperateCycleDisplayWorkspaceV1,
	issueOperateExecutiveBoardDisplaySurfaceV1,
	issueOperateExperienceDisplaySurfaceV1,
	issueOperateRecoveryDisplaySurfaceV1,
} from "./operate-experience-display-contract.mjs";
import { assertOperateExperienceSurfaceV1 } from "./operate-experience-surface-contract.mjs";
import { issueOperateReviewDisplayWorkspaceV1 } from "./operate-review-display-workspace-contract.mjs";

const PROJECTION_RELATIVE_PATH = "operate/projections/experience-view.json";
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const STATUS_REASON = Object.freeze({
	ready: [],
	"read-only": ["OPERATE_READ_ONLY"],
	stale: ["OPERATE_PROJECTION_STALE"],
	partial: ["OPERATE_PROJECTION_PARTIAL"],
	blocked: ["OPERATE_PROJECTION_BLOCKED"],
	offline: ["OPERATE_OFFLINE"],
	incompatible: ["OPERATE_CONTRACT_INCOMPATIBLE"],
	corrupt: ["OPERATE_STATE_CORRUPT"],
});
const SURFACES = new Set([
	"today",
	"inbox",
	"cycles",
	"cycle",
	"actions",
	"action",
	"evidence",
	"outcomes",
	"outcome",
	"history",
	"search",
	"export",
]);
const ACTION_WORKSPACE_BOUNDARIES = Object.freeze({
	approvalExecution:
		"Named approval satisfies only its exact version-bound requirement. Execution receives a fresh authority check.",
	verification:
		"Outcome verification remains separate. No success claim appears before accepted evidence.",
	retry:
		"An effect may have occurred. Only Inspect, Reconcile, custody restoration, or an explicit runtime recovery route is legal.",
});
const IMMUTABLE_TRANSPORT_SNAPSHOTS = new WeakMap();
const IMMUTABLE_TRANSPORT_TRUTH_SUMMARIES = new WeakMap();

function deepFreezeJson(value, seen = new WeakSet()) {
	if (value === null || typeof value !== "object" || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreezeJson(child, seen);
	return Object.freeze(value);
}

function publishImmutableTransportView(view) {
	deepFreezeJson(view);
	const record = Object.freeze({
		snapshot: view,
		keys: Object.freeze(Object.keys(view)),
	});
	const facade = { ...view };
	IMMUTABLE_TRANSPORT_SNAPSHOTS.set(view, record);
	IMMUTABLE_TRANSPORT_SNAPSHOTS.set(facade, record);
	return facade;
}

function immutableTransportSnapshot(view) {
	if (view === null || typeof view !== "object") return null;
	const record = IMMUTABLE_TRANSPORT_SNAPSHOTS.get(view);
	if (!record) return null;
	const keys = Object.keys(view);
	if (keys.length !== record.keys.length) return null;
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		const descriptor = Object.getOwnPropertyDescriptor(view, key);
		if (
			key !== record.keys[index] ||
			!descriptor ||
			!("value" in descriptor) ||
			descriptor.value !== record.snapshot[key]
		) return null;
	}
	return record.snapshot;
}

function canonicalTransportView(view) {
	return immutableTransportSnapshot(view) ?? assertOperateExperienceTransportView(view);
}

function transportTruthSummary(view) {
	const snapshot = immutableTransportSnapshot(view);
	// Only privately registered, deeply frozen snapshots can reuse validation.
	// Caller-owned objects, including frozen clones, must be validated each time.
	if (!snapshot) return deriveOperateSharedTruthSummaryV1(view);
	let summary = IMMUTABLE_TRANSPORT_TRUTH_SUMMARIES.get(snapshot);
	if (!summary) {
		summary = deriveOperateSharedTruthSummaryV1(snapshot);
		IMMUTABLE_TRANSPORT_TRUTH_SUMMARIES.set(snapshot, summary);
	}
	return summary;
}

function without(value, field) {
	return Object.fromEntries(
		Object.entries(value).filter(([key]) => key !== field),
	);
}

function safeError(reasonCode, message, status = 400) {
	return Object.freeze({
		ok: false,
		status,
		error: Object.freeze({ reasonCode, message, retryable: false }),
	});
}

function assertCanonicalViewHash(view) {
	assertOperateExperienceArtifactV2("operate-experience-view", view);
	if (view.viewHash !== sha256Jcs(without(view, "viewHash"))) {
		throw Object.assign(
			new Error(
				"The experience projection failed its canonical integrity check.",
			),
			{
				code: "OPERATE_PROJECTION_INVALID",
			},
		);
	}
	assertCanonicalReplayCustody(view);
	return view;
}

function assertCanonicalReplayCustody(view) {
	const { checkpoint, finalHead, parityProof, tail } = view.replay;
	const checkpointSequence = checkpoint?.eventHead.sequence ?? 0;
	const tailEventCount = view.eventHead.sequence - checkpointSequence;
	const exactCheckpoint = checkpoint !== null && tailEventCount === 0;
	const retainedTail = checkpoint !== null && tailEventCount > 0;
	const expectedTailStart = checkpoint
		? checkpointSequence + 1
		: view.eventHead.sequence === 0
			? null
			: 1;
	const expectedTailEnd = tailEventCount === 0 ? null : view.eventHead.sequence;
	const invalid =
		tailEventCount < 0 ||
		!exactEventHead(finalHead, view.eventHead) ||
		parityProof.sourceStateHash !== view.sourceStateHash ||
		parityProof.eventReplayIndexHash !== tail.eventReplayIndexHash ||
		parityProof.checkpointVerified !== (checkpoint !== null) ||
		parityProof.finalEventHashMatches !== true ||
		tail.startSequence !== expectedTailStart ||
		tail.endSequence !== expectedTailEnd ||
		tail.eventCount !== tailEventCount ||
		!exactJson(view.replay.redactions, view.omissions) ||
		view.cycles.some(
			(cycle) => !exactJson(cycle.replayCheckpoint, checkpoint),
		) ||
		(checkpoint !== null &&
			((exactCheckpoint &&
				(!exactEventHead(checkpoint.eventHead, view.eventHead) ||
					checkpoint.runtimeStateHash !== view.sourceStateHash ||
					checkpoint.eventReplayIndexHash !== tail.eventReplayIndexHash ||
					parityProof.stateParityVerified !== true)) ||
			(retainedTail &&
				(exactEventHead(checkpoint.eventHead, view.eventHead) ||
					checkpoint.runtimeStateHash === view.sourceStateHash ||
					checkpoint.eventReplayIndexHash === tail.eventReplayIndexHash ||
					parityProof.stateParityVerified !== false)) ||
			(!exactCheckpoint && !retainedTail)));
	if (invalid) {
		throw Object.assign(
			new Error(
				"The experience projection failed its canonical replay custody check.",
			),
			{ code: "OPERATE_PROJECTION_INVALID" },
		);
	}
}

function exactInboxAction(view, item) {
	if (item.actionLocator === null) {
		return item.navigationLocator !== null || item.unavailableReason !== null;
	}
	const candidates = view.allowedActions.filter(
		(entry) =>
			entry.subjectId === item.actionLocator.subjectId &&
			sha256Jcs(entry.action) === item.actionLocator.actionDigest,
	);
	if (candidates.length !== 1 || item.unavailableReason !== null) return false;
	const { action } = candidates[0];
	if (item.kind === "decision") {
		return (
			action.tool === "operate.review.submit" &&
			action.arguments?.reviewId === item.actionLocator.subjectId &&
			action.arguments?.disposition === "approved" &&
			Array.isArray(action.arguments?.workDispositions) &&
			action.arguments.workDispositions.some(
				(entry) =>
					entry?.entityType === "operating-decision" &&
					entry.entityId === item.subjectId,
			)
		);
	}
	if (item.kind === "approval") {
		if (action.tool === "operate.review.submit") {
			return (
				item.itemId === `action-review:${item.subjectId}` &&
				item.actionLocator.subjectId === item.subjectId &&
				action.arguments?.reviewId === item.subjectId &&
				action.arguments?.disposition === "approved" &&
				Array.isArray(action.arguments?.workDispositions) &&
				action.arguments.workDispositions.length === 0
			);
		}
		const identity = action.arguments?.action;
		const rollback = action.arguments?.rollback;
		const projected = view.actions.find(
			(entry) => entry.actionId === item.subjectId,
		);
		return (
			action.tool === "operate.action.approve" &&
			action.arguments?.decision === "approved" &&
			(rollback === undefined ||
				item.itemId === `approval:rollback:${rollback.rollbackPlanId}`) &&
			(rollback !== undefined || item.itemId.startsWith("approval:")) &&
			item.actionLocator.subjectId === item.subjectId &&
			projected !== undefined &&
			identity?.actionId === projected.actionId &&
			identity?.revision === projected.revision &&
			identity?.actionHash === projected.actionHash
		);
	}
	return (
		action.tool === "operate.assignment.submit" &&
		item.actionLocator.subjectId === item.subjectId &&
		action.arguments?.assignmentId === item.subjectId
	);
}

function exactInboxNavigation(view, item) {
	if (item.navigationLocator === null) {
		return item.actionLocator !== null || item.unavailableReason !== null;
	}
	if (item.unavailableReason !== null) return false;
	const locator = item.navigationLocator;
	const candidates = view.allowedActions.filter(
		(entry) =>
			entry.subjectId === locator.reviewId &&
			sha256Jcs(entry.action) === locator.readActionDigest,
	);
	if (candidates.length !== 1) return false;
	const { action } = candidates[0];
	const expectedLink = `#/operate/cycles/${encodeURIComponent(locator.cycleId)}/reviews/${encodeURIComponent(locator.reviewId)}`;
	if (
		locator.kind !== "review" ||
		locator.deepLink !== expectedLink ||
		!view.cycles.some((cycle) => cycle.cycleId === locator.cycleId) ||
		action.tool !== "operate.review.get" ||
		action.effect !== "read-only" ||
		action.arguments?.reviewId !== locator.reviewId ||
		action.arguments?.cycleId !== locator.cycleId ||
		action.arguments?.actor?.actorId !== view.actorId ||
		action.arguments?.scope?.scopeId !== view.scopeId ||
		action.arguments?.scope?.domainId !== view.domainId ||
		action.arguments?.scope?.domainVersion !== view.domainVersion
	) return false;
	if (item.kind === "decision") {
		const reviewChoices = view.allowedActions.filter(
			(entry) =>
				entry.subjectId === locator.reviewId &&
				entry.action.tool === "operate.review.submit",
		);
		return reviewChoices.length === 0 || reviewChoices.some(
			({ action: choice }) =>
				choice.arguments?.disposition === "approved" &&
				Array.isArray(choice.arguments?.workDispositions) &&
				choice.arguments.workDispositions.some(
					(entry) =>
						entry?.entityType === "operating-decision" &&
						entry.entityId === item.subjectId,
				),
		);
	}
	return item.kind === "approval" &&
		item.itemId === `action-review:${locator.reviewId}` &&
		item.subjectId === locator.reviewId;
}

function assertInboxCustody(view) {
	for (const item of view.inbox) {
		const evidenceIds = new Set();
		for (const evidence of item.evidence) {
			if (evidenceIds.has(evidence.evidenceRefId)) throw new TypeError("Duplicate Inbox evidence.");
			evidenceIds.add(evidence.evidenceRefId);
			const ownerEvidence = view.evidence.find(
				(entry) => entry.evidenceRefId === evidence.evidenceRefId,
			);
			const expectedRelation = ownerEvidence?.claimStatus === "contradicted"
				? "contradiction"
				: ownerEvidence?.claimStatus === "supported"
					? "support"
					: "informs";
			if (
				!ownerEvidence ||
				evidence.classification !== ownerEvidence.classification ||
				evidence.accessState !== ownerEvidence.accessState ||
				evidence.relation !== expectedRelation
			) throw new TypeError("Foreign Inbox evidence.");
		}
		const partyIds = new Set();
		for (const party of item.requiredParties) {
			if (partyIds.has(party.partyId)) throw new TypeError("Duplicate Inbox party.");
			partyIds.add(party.partyId);
			if (
				(party.redacted && (party.actorId !== null || party.state !== "redacted")) ||
				(!party.redacted && party.state === "redacted")
			) throw new TypeError("Invalid Inbox party redaction.");
		}
		if (!exactInboxAction(view, item)) throw new TypeError("Invalid Inbox action locator.");
		if (!exactInboxNavigation(view, item)) throw new TypeError("Invalid Inbox navigation locator.");
	}
}

export function assertOperateExperienceTransportView(view) {
	if (immutableTransportSnapshot(view)) return view;
	assertCanonicalViewHash(view);
	assertInboxCustody(view);
	if (
		view.history.some(
			(entry) =>
				!["engine", "runtime"].includes(entry.actorKind) &&
				!["current-actor", "restricted-actor"].includes(entry.actorId),
		)
	) {
		throw Object.assign(
			new Error("The experience projection contains an unsafe actor identity."),
			{
				code: "OPERATE_PROJECTION_INVALID",
			},
		);
	}
	return view;
}

function sanitizeExecutiveBoardForCycleWorkspace(executiveBoard) {
	if (!executiveBoard) return null;
	const chairSynthesis = executiveBoard.chairSynthesis;
	if (!chairSynthesis) return executiveBoard;
	return {
		...executiveBoard,
		chairSynthesis: {
			artifact: chairSynthesis.artifact,
			decisions: [],
			dissent: chairSynthesis.dissent,
			unresolvedGaps: chairSynthesis.unresolvedGaps,
		},
	};
}

/**
 * Rebind one valid canonical projection to its access-safe transport hash.
 * This is idempotent so file, injected-provider, REST, and SSE paths share it.
 */
function normalizeCyclesForTransport(cycles) {
	return cycles.map((cycle) => ({
		...cycle,
		lensAbsences: cycle.lensAbsences ?? [],
		executiveBoard: cycle.executiveBoard ?? null,
		assignments: cycle.assignments.map((assignment) => ({
			...assignment,
			absence: assignment.absence ?? null,
		})),
	}));
}

export function buildOperateExperienceTransportView(view) {
	assertCanonicalViewHash(view);
	const history = view.history.map((entry) => ({
		...entry,
		actorId: ["engine", "runtime"].includes(entry.actorKind)
			? entry.actorId
			: ["current-actor", "restricted-actor"].includes(entry.actorId)
				? entry.actorId
				: entry.actorId === view.actorId
					? "current-actor"
					: "restricted-actor",
	}));
	const base = {
		...without(view, "viewHash"),
		history,
		cycles: normalizeCyclesForTransport(view.cycles),
	};
	const transportView = {
		...base,
		viewHash: sha256Jcs(base),
	};
	assertOperateExperienceTransportView(transportView);
	return publishImmutableTransportView(transportView);
}

function safeReadJson(path, maxBytes) {
	const stats = statSync(path);
	if (!stats.isFile())
		throw new Error("Experience projection is not a regular file.");
	if (stats.size > maxBytes)
		throw new Error("Experience projection exceeds the local read limit.");
	return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Read one already access-safe, actor-bound public experience projection.
 * The dashboard never opens runtime Artifacts, infers access, or rebuilds ranking.
 */
export function readOperateExperienceProjection(
	planrDir,
	{
		maxBytes = DEFAULT_MAX_BYTES,
		relativePath = PROJECTION_RELATIVE_PATH,
	} = {},
) {
	const path = join(planrDir, relativePath);
	if (!existsSync(path)) {
		return Object.freeze({
			available: false,
			readOnly: true,
			status: "absent",
			path: `.planr/${relativePath}`,
			view: null,
			reasonCodes: ["OPERATE_PROJECTION_ABSENT"],
		});
	}
	try {
		const view = buildOperateExperienceTransportView(
			safeReadJson(path, maxBytes),
		);
		return Object.freeze({
			available: true,
			readOnly: true,
			status: view.status,
			path: `.planr/${relativePath}`,
			view,
			reasonCodes: STATUS_REASON[view.status] ?? [
				"OPERATE_PROJECTION_UNAVAILABLE",
			],
		});
	} catch {
		return Object.freeze({
			available: true,
			readOnly: true,
			status: "invalid",
			path: `.planr/${relativePath}`,
			view: null,
			reasonCodes: ["OPERATE_PROJECTION_INVALID"],
			recovery:
				"Refresh through OpenPlanr. Do not edit durable operating state by hand.",
		});
	}
}

function exactBinding(view, binding) {
	return (
		view.actorId === binding.actorId &&
		view.scopeId === binding.scopeId &&
		view.domainId === binding.domainId &&
		view.domainVersion === binding.domainVersion
	);
}

function exactEventHead(left, right) {
	return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function exactCycleWorkspaceBinding(view, binding, cycleId) {
	return (
		exactBinding(view, binding) &&
		binding.cycleId === cycleId &&
		binding.subjectId === cycleId &&
		binding.generatedAt === view.generatedAt &&
		binding.viewHash === view.viewHash &&
		exactEventHead(binding.eventHead, view.eventHead)
	);
}

function exactExecutiveBoardBinding(view, binding, cycleId) {
	return exactCycleWorkspaceBinding(view, binding, cycleId);
}

function exactActionWorkspaceBinding(view, binding, actionId) {
	return (
		exactBinding(view, binding) &&
		binding.actionId === actionId &&
		binding.subjectId === actionId &&
		binding.generatedAt === view.generatedAt &&
		binding.viewHash === view.viewHash &&
		exactEventHead(binding.eventHead, view.eventHead)
	);
}

function exactRecoveryDisplayBinding(view, binding) {
	return (
		exactBinding(view, binding) &&
		binding.generatedAt === view.generatedAt &&
		binding.viewHash === view.viewHash &&
		exactEventHead(binding.eventHead, view.eventHead)
	);
}

function actionDeepLink(actionId) {
	return `#/operate/actions/${encodeURIComponent(actionId)}`;
}

function verificationFromOutcome(outcome) {
	if (outcome === null) {
		return Object.freeze({
			status: "not-required",
			reasonCodes: Object.freeze([]),
		});
	}
	if (outcome.status === "insufficient-evidence") {
		return Object.freeze({
			status: "unverified",
			reasonCodes: Object.freeze(["OPERATE_VERIFICATION_EVIDENCE_MISSING"]),
		});
	}
	if (
		["succeeded", "failed"].includes(outcome.status) &&
		outcomeCarriesAffirmativeProof(outcome)
	) {
		return Object.freeze({
			status: "verified",
			reasonCodes: Object.freeze([]),
		});
	}
	return Object.freeze({
		status: "unverified",
		reasonCodes: Object.freeze(["OPERATE_VERIFICATION_EVIDENCE_MISSING"]),
	});
}

function verificationFromSharedTruth(truthSummary) {
	const status = truthSummary.proof.status === "verified"
		? "verified"
		: truthSummary.proof.status === "not-required"
			? "not-required"
			: "unverified";
	return Object.freeze({
		status,
		reasonCodes: Object.freeze(
			status === "unverified"
				? truthSummary.proof.reasonCodes.length > 0
					? [...truthSummary.proof.reasonCodes]
					: ["OPERATE_VERIFICATION_EVIDENCE_MISSING"]
				: [],
		),
	});
}

function recoveryStateFromInspection(inspection) {
	const status = inspection?.status;
	if (status === "healthy" || status === "empty") return "restored";
	if (status === "corrupt") return "corrupt";
	if (status === "incompatible") return "incompatible";
	if (status === "locked") return "blocked";
	if (status === "repairable") {
		if (inspection.allowedRecovery === "clear-stale-lock") return "blocked";
		if (inspection.allowedRecovery === "restore-generation") return "uncertain";
		return "uncertain";
	}
	return "blocked";
}

function sanitizeRecoveryInspection(inspection) {
	if (!inspection || typeof inspection !== "object") return inspection;
	const { integrityBoundary: _integrityBoundary, ...sanitized } = inspection;
	return sanitized;
}

function actionHistory(view, actionId) {
	return view.history.filter(
		(entry) =>
			entry.entityId === actionId ||
			entry.deepLinks.some(
				(deepLink) =>
					resolveOperateExperienceSearchDestination(view, deepLink)
						?.subjectId === actionId,
			),
	);
}

function recoveryHistory(view) {
	return view.history.filter((entry) =>
		/(?:recovery|reconcile|restore|lock|corrupt|incompatible)/iu.test(
			`${entry.type}\n${entry.change?.summary ?? ""}\n${entry.result?.status ?? ""}`,
		),
	);
}

function validExecutiveBoardSeatAbsence(absence) {
	if (absence === null) return true;
	if (typeof absence !== "object" || Array.isArray(absence)) return false;
	if (absence.kind === "omitted") {
		return typeof absence.reason === "string" && absence.reason.length > 0;
	}
	if (absence.kind === "lens") {
		return (
			typeof absence.roleId === "string" &&
			typeof absence.roleKind === "string" &&
			typeof absence.absenceCode === "string" &&
			typeof absence.reason === "string"
		);
	}
	if (absence.kind === "terminal") {
		return (
			(absence.outcome === "abandoned" || absence.outcome === "failed") &&
			typeof absence.code === "string" &&
			typeof absence.reason === "string" &&
			typeof absence.recoveryDisposition === "string"
		);
	}
	return false;
}

function validExecutiveBoardGap(entry) {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
	if (entry.kind === "role") {
		return (
			(entry.absenceId === null || typeof entry.absenceId === "string") &&
			typeof entry.roleId === "string" &&
			typeof entry.roleKind === "string" &&
			typeof entry.absenceCode === "string" &&
			typeof entry.reason === "string"
		);
	}
	if (entry.kind === "evidence") {
		return (
			typeof entry.absenceId === "string" &&
			typeof entry.requirementId === "string" &&
			Array.isArray(entry.evidenceKinds) &&
			entry.evidenceKinds.every((kind) => typeof kind === "string") &&
			typeof entry.absenceCode === "string" &&
			typeof entry.reason === "string"
		);
	}
	return false;
}

function validExecutiveBoardChairSynthesis(chair) {
	if (chair === null) return true;
	return (
		Array.isArray(chair.unresolvedGaps) &&
		chair.unresolvedGaps.every(validExecutiveBoardGap)
	);
}

function validExecutiveBoardSeatIdentity(seat) {
	return (
		typeof seat?.roleId === "string" &&
		typeof seat?.label === "string" &&
		seat.roleId !== seat.label &&
		typeof seat?.roleKind === "string" &&
		typeof seat?.roleVersion === "string" &&
		validExecutiveBoardSeatAbsence(seat?.absence ?? null)
	);
}

function exactDisplayBinding(view, binding, surface, subjectId) {
	return (
		exactBinding(view, binding) &&
		binding.generatedAt === view.generatedAt &&
		binding.viewHash === view.viewHash &&
		exactEventHead(binding.eventHead, view.eventHead) &&
		binding.surface === surface &&
		(surface !== "inbox" ||
			(typeof binding.projectId === "string" &&
				/^sha256:[a-f0-9]{64}$/u.test(binding.projectId) &&
				Number.isSafeInteger(binding.generation) &&
				binding.generation >= 0 &&
				binding.subjectId === subjectId)) &&
		(surface !== "cycle" ||
			(binding.subjectId === subjectId && binding.cycleId === subjectId)) &&
		(surface !== "actions" ||
			(binding.subjectId === null &&
				typeof binding.cycleId === "string" &&
				view.cycles.some((cycle) => cycle.cycleId === binding.cycleId)))
	);
}

function exactAuditDisplayBinding(
	view,
	binding,
	{ surface, subjectId, cycleId, query, format },
) {
	if (
		!exactBinding(view, binding) ||
		binding.generatedAt !== view.generatedAt ||
		binding.viewHash !== view.viewHash ||
		!exactEventHead(binding.eventHead, view.eventHead) ||
		binding.surface !== surface ||
		binding.subjectId !== subjectId ||
		binding.cycleId !== cycleId ||
		!view.cycles.some((cycle) => cycle.cycleId === cycleId)
	)
		return false;
	if (surface === "outcome") {
		if (
			typeof subjectId !== "string" ||
			!view.outcomes.some((outcome) => outcome.outcomeId === subjectId)
		)
			return false;
	} else if (surface === "evidence") {
		if (
			subjectId !== null &&
			!view.evidence.some((entry) => entry.evidenceRefId === subjectId) &&
			!view.claims.some((entry) => entry.claimId === subjectId)
		)
			return false;
	} else if (subjectId !== null) {
		return false;
	}
	if (surface === "search")
		return (
			typeof query === "string" &&
			query.length <= 512 &&
			binding.query === query &&
			binding.format === null
		);
	if (surface === "export")
		return (
			["json", "html"].includes(format) &&
			binding.query === null &&
			binding.format === format
		);
	return binding.query === null && binding.format === null;
}

function exactJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function linkedPersistentRows(records, links, entityKind, idField) {
	return records
		.filter((record) =>
			links.some(
				(link) =>
					link.entityKind === entityKind && link.entityId === record[idField],
			),
		)
		.map((record) => ({
			kind: entityKind,
			subjectId: record[idField],
			state: record.state,
			relations: links
				.filter(
					(link) =>
						link.entityKind === entityKind && link.entityId === record[idField],
				)
				.map((link) => link.relation),
		}));
}

function persistentRecordEntries(ledger) {
	return [
		...ledger.findings.map((record) => ({
			entityKind: "finding",
			idField: "findingId",
			record,
		})),
		...ledger.decisions.map((record) => ({
			entityKind: "decision",
			idField: "decisionId",
			record,
		})),
		...ledger.actions.map((record) => ({
			entityKind: "action",
			idField: "actionId",
			record,
		})),
	];
}

function sameLink(left, right) {
	return (
		left.entityKind === right.entityKind &&
		left.entityId === right.entityId &&
		left.cycleId === right.cycleId &&
		left.relation === right.relation
	);
}

function exactPersistentLinkCoverage(ledger, cycleLinks, cycleId, view) {
	const records = persistentRecordEntries(ledger);
	if (
		ledger.cycleLinks.some((link, index) =>
			ledger.cycleLinks
				.slice(0, index)
				.some((candidate) => sameLink(candidate, link)),
		)
	)
		return false;
	if (cycleLinks.some((link) => link.cycleId !== cycleId)) return false;
	if (
		cycleLinks.some(
			(link) =>
				!ledger.cycleLinks.some((candidate) => sameLink(candidate, link)),
		)
	) {
		return false;
	}
	if (
		ledger.cycleLinks.some(
			(link) =>
				!records.some(
					({ entityKind, idField, record }) =>
						entityKind === link.entityKind && record[idField] === link.entityId,
				),
		)
	)
		return false;

	for (const { entityKind, idField, record } of records) {
		const entityId = record[idField];
		const sourceLinks = ledger.cycleLinks.filter(
			(link) =>
				link.entityKind === entityKind &&
				link.entityId === entityId &&
				link.relation === "source",
		);
		if (
			sourceLinks.length !== 1 ||
			sourceLinks[0].cycleId !== record.sourceCycleId
		)
			return false;
		const linkedToCycle = cycleLinks.some(
			(link) => link.entityKind === entityKind && link.entityId === entityId,
		);
		if (
			linkedToCycle &&
			(record.scopeId !== view.scopeId ||
				record.domainId !== view.domainId ||
				record.domainVersion !== view.domainVersion)
		)
			return false;
		if (
			record.sourceCycleId === cycleId &&
			!cycleLinks.some(
				(link) =>
					link.entityKind === entityKind &&
					link.entityId === entityId &&
					link.relation === "source",
			)
		)
			return false;
	}
	return true;
}

function outcomeCarriesAffirmativeProof(outcome) {
	const verification = outcome.verification;
	const metric = outcome.metric;
	const hasAcceptedEvidence =
		outcome.observationIds.length > 0 && outcome.evidenceRefIds.length > 0;
	return (
		["succeeded", "failed"].includes(outcome.status) &&
		outcome.accessReason === null &&
		hasAcceptedEvidence &&
		metric !== null &&
		metric.observed !== null &&
		metric.freshness === "current" &&
		verification !== null &&
		verification.accessReason === null &&
		outcome.verificationPlanId === verification.verificationPlanId &&
		metric.metricId === verification.metricId &&
		metric.metricHash === verification.metricHash
	);
}

function outcomeCarriesRestrictedProof(outcome) {
	const verification = outcome.verification;
	const metric = outcome.metric;
	return (
		outcome.accessReason === "access-denied" &&
		outcome.observationIds.length === 0 &&
		outcome.evidenceRefIds.length === 0 &&
		metric !== null &&
		metric.baseline === null &&
		metric.target === null &&
		metric.observed === null &&
		metric.unit === null &&
		metric.window === null &&
		metric.confidence === null &&
		verification !== null &&
		verification.accessReason === "access-denied" &&
		verification.method === null &&
		verification.evaluationRules.length === 0 &&
		verification.observationRequest === null &&
		outcome.nextObservation === null &&
		outcome.revisit === null &&
		outcome.verificationPlanId === verification.verificationPlanId &&
		metric.metricId === verification.metricId &&
		metric.metricHash === verification.metricHash
	);
}

function outcomeCarriesRestrictedAffirmativeProof(outcome) {
	return (
		["succeeded", "failed"].includes(outcome.status) &&
		outcomeCarriesRestrictedProof(outcome)
	);
}

function entityDeepLink(view, kind, subjectId) {
	if (kind === "cycle")
		return (
			view.cycles.find((entry) => entry.cycleId === subjectId)?.deepLink ?? null
		);
	if (kind === "assignment") {
		return (
			view.cycles.find((cycle) =>
				cycle.assignments.some((entry) => entry.assignmentId === subjectId),
			)?.deepLink ?? null
		);
	}
	if (kind === "evidence")
		return (
			view.evidence.find((entry) => entry.evidenceRefId === subjectId)
				?.deepLink ?? null
		);
	if (kind === "claim")
		return (
			view.claims.find((entry) => entry.claimId === subjectId)?.deepLink ?? null
		);
	if (kind === "outcome")
		return (
			view.outcomes.find((entry) => entry.outcomeId === subjectId)?.deepLink ??
			null
		);
	if (kind === "learning") {
		const outcomeId = view.learnings.find(
			(entry) => entry.learningId === subjectId,
		)?.outcomeId;
		return (
			view.outcomes.find((entry) => entry.outcomeId === outcomeId)?.deepLink ??
			null
		);
	}
	return null;
}

/** Parse one projected link through the exact currently callable read grammar. */
export function resolveOperateExperienceSearchDestination(view, value) {
	if (typeof value !== "string" || !value.startsWith("#/operate/")) return null;
	if (value.includes("?") || value.indexOf("#", 1) !== -1) return null;
	const rest = value.slice("#/operate/".length);
	if (!rest || rest.endsWith("/") || rest.includes("//")) return null;
	const rawParts = rest.split("/");
	if (
		rawParts.length < 1 ||
		rawParts.length > 2 ||
		rawParts.some((part) => part.length === 0 || /%(?:2f|5c)/iu.test(part))
	)
		return null;
	let parts;
	try {
		parts = rawParts.map((part) => decodeURIComponent(part));
	} catch {
		return null;
	}
	if (rawParts[0] !== parts[0]) return null;
	let subjectId = null;
	if (parts.length === 2) {
		subjectId = parts[1];
		if (
			!subjectId ||
			subjectId === "." ||
			subjectId === ".." ||
			/[/\\]/.test(subjectId)
		)
			return null;
	}
	const route = parts[0];
	if (route === "cycles") {
		if (subjectId === null)
			return { route, surface: "cycles", subjectId: null };
		if (!view.cycles.some((entry) => entry.cycleId === subjectId)) return null;
		return { route, surface: "cycle", subjectId };
	}
	if (route === "evidence") {
		if (
			subjectId !== null &&
			!view.evidence.some((entry) => entry.evidenceRefId === subjectId) &&
			!view.claims.some((entry) => entry.claimId === subjectId) &&
			!view.rationale.some(
				(entry) =>
					entry.subjectId === subjectId ||
					entry.evidenceRefIds.includes(subjectId),
			)
		)
			return null;
		return { route, surface: "evidence", subjectId };
	}
	if (route === "outcomes") {
		if (subjectId === null)
			return { route, surface: "outcomes", subjectId: null };
		if (!view.outcomes.some((entry) => entry.outcomeId === subjectId))
			return null;
		return { route, surface: "outcome", subjectId };
	}
	if (route === "today" && subjectId === null)
		return { route, surface: "today", subjectId: null };
	if (route === "history" && subjectId === null)
		return { route, surface: "history", subjectId: null };
	if (route === "actions") {
		if (subjectId === null)
			return { route, surface: "actions", subjectId: null };
		if (!view.actions.some((entry) => entry.actionId === subjectId)) return null;
		return { route, surface: "action", subjectId };
	}
	return null;
}

function exactSearchDeepLink(view, candidates) {
	for (const candidate of candidates) {
		if (resolveOperateExperienceSearchDestination(view, candidate))
			return candidate;
	}
	return null;
}

function surfaceData(
	view,
	surface,
	{
		subjectId = null,
		cycleId = null,
		query = "",
		format = "json",
		projectId = null,
		generation = null,
	} = {},
) {
	if (surface === "today") {
		const activeCycle =
			cycleId === null
				? (view.cycles[0] ?? null)
				: (view.cycles.find((entry) => entry.cycleId === cycleId) ?? null);
		if (cycleId !== null && activeCycle === null) return null;
		return {
			attention: view.attention,
			domainMetrics: view.domainMetrics,
			activeCycle,
			inbox: view.inbox,
			actions: view.actions,
			outcomes: view.outcomes,
			allowedActions: view.allowedActions,
		};
	}
	if (surface === "inbox") {
		if (
			typeof projectId !== "string" ||
			!/^sha256:[a-f0-9]{64}$/u.test(projectId) ||
			!Number.isSafeInteger(generation) ||
			generation < 0
		) return null;
		const items = subjectId === null
			? view.inbox
			: view.inbox.filter((item) => item.itemId === subjectId);
		if (subjectId !== null && items.length !== 1) return null;
		return {
			inbox: items,
			requestBinding: { projectId, generation, subjectId },
		};
	}
	if (surface === "cycles") return { cycles: view.cycles };
	if (surface === "cycle") {
		const cycle = view.cycles.find((entry) => entry.cycleId === subjectId);
		return cycle ? { cycle } : null;
	}
	if (surface === "actions") {
		if (
			typeof projectId !== "string" ||
			!/^sha256:[a-f0-9]{64}$/u.test(projectId) ||
			!Number.isSafeInteger(generation) ||
			generation < 0
		)
			return null;
		return { actions: view.actions, requestBinding: { projectId, generation } };
	}
	if (surface === "action") {
		const action = view.actions.find((entry) => entry.actionId === subjectId);
		return action ? { action } : null;
	}
	if (surface === "evidence") {
		return {
			evidence: view.evidence,
			claims: view.claims,
			rationale: view.rationale,
		};
	}
	if (surface === "outcomes") {
		return {
			domainMetrics: view.domainMetrics,
			outcomes: view.outcomes,
			learnings: view.learnings,
		};
	}
	if (surface === "outcome") {
		const outcome = view.outcomes.find(
			(entry) => entry.outcomeId === subjectId,
		);
		return outcome
			? {
					outcome,
					learnings: view.learnings.filter(
						(entry) => entry.outcomeId === subjectId,
					),
				}
			: null;
	}
	if (surface === "history")
		return { history: view.history, replay: view.replay };
	if (surface === "search") return { query, results: searchView(view, query) };
	if (surface === "export") return buildExport(view, format);
	return null;
}

function searchView(view, query) {
	const needle = String(query).trim().toLocaleLowerCase("en-US");
	if (!needle) return [];
	const rows = [
		...view.attention.map((entry) => ({
			kind: entry.kind,
			subjectId: entry.subjectId,
			title: entry.title,
			summary: entry.whyNow,
			state: entry.state,
			deepLink: exactSearchDeepLink(view, [
				entityDeepLink(view, entry.kind, entry.subjectId),
			]),
		})),
		...view.domainMetrics
			.filter((entry) => entry.accessReason === null)
			.map((entry) => ({
				kind: "metric",
				subjectId: entry.metricId,
				title: entry.title ?? `Metric ${entry.metricId}`,
				summary: [entry.window, entry.unit, entry.freshness]
					.filter((value) => typeof value === "string")
					.join(" · "),
				state: entry.state,
				deepLink: exactSearchDeepLink(
					view,
					entry.dueVerification.map((item) => item.deepLink),
				),
			})),
		...view.cycles.map((entry) => ({
			kind: "cycle",
			subjectId: entry.cycleId,
			title: entry.focus.join(", "),
			summary: entry.health,
			state: entry.state,
			deepLink: exactSearchDeepLink(view, [entry.deepLink]),
		})),
		...view.cycles.flatMap((cycle) =>
			cycle.assignments.map((entry) => ({
				kind: "assignment",
				subjectId: entry.assignmentId,
				title: entry.title ?? `Assignment ${entry.assignmentId}`,
				summary: [entry.role, entry.ownerLabel]
					.filter((value) => typeof value === "string")
					.join(" · "),
				state: entry.state,
				deepLink: exactSearchDeepLink(view, [entry.deepLink, cycle.deepLink]),
			})),
		),
		...view.actions.map((entry) => ({
			kind: "action",
			subjectId: entry.actionId,
			title: entry.title,
			summary: entry.expectedResult,
			state: entry.state,
			deepLink: exactSearchDeepLink(view, [entry.deepLink]),
		})),
		...view.evidence
			.filter(
				(entry) =>
					entry.accessReason === null && entry.accessState === "available",
			)
			.map((entry) => ({
				kind: "evidence",
				subjectId: entry.evidenceRefId,
				title: `Evidence ${entry.evidenceRefId}`,
				summary: [
					entry.evidenceKind,
					entry.claimStatus,
					...entry.gaps,
					...entry.errors.map(({ error }) => error?.code).filter(Boolean),
				]
					.filter((value) => typeof value === "string")
					.join(" · "),
				state: entry.freshness,
				deepLink: exactSearchDeepLink(view, [entry.deepLink]),
			})),
		...view.claims
			.filter(
				(entry) => entry.accessReason === null && entry.statement !== null,
			)
			.map((entry) => ({
				kind: "claim",
				subjectId: entry.claimId,
				title: entry.statement,
				summary: [
					entry.epistemicStatus,
					...entry.gaps,
					...entry.errors.map(({ error }) => error?.code).filter(Boolean),
				].join(" · "),
				state: entry.status,
				deepLink: exactSearchDeepLink(view, [entry.deepLink]),
			})),
		...view.rationale.map((entry) => ({
			kind: entry.kind,
			subjectId: entry.subjectId,
			title: entry.summary,
			summary: entry.kind,
			state: "recorded",
			deepLink: exactSearchDeepLink(view, [
				entityDeepLink(view, entry.kind, entry.subjectId),
				...entry.evidenceRefIds.map((id) =>
					entityDeepLink(view, "evidence", id),
				),
			]),
		})),
		...view.outcomes.map((entry) => ({
			kind: "outcome",
			subjectId: entry.outcomeId,
			title: `Outcome ${entry.status}`,
			summary: [
				entry.metric?.metricId,
				entry.verification?.method,
				entry.revisit?.conditions?.join(" "),
			]
				.filter((value) => typeof value === "string")
				.join(" · "),
			state: entry.status,
			deepLink: exactSearchDeepLink(view, [entry.deepLink]),
		})),
		...view.learnings.map((entry) => ({
			kind: "learning",
			subjectId: entry.learningId,
			title: entry.statement,
			summary: "Learning",
			state: "recorded",
			deepLink: exactSearchDeepLink(view, [
				entityDeepLink(view, "learning", entry.learningId),
			]),
		})),
		...view.history.map((entry) => ({
			kind: "event",
			subjectId: entry.eventId,
			title: entry.change.summary ?? entry.type,
			summary: entry.why ?? entry.type,
			state: entry.result?.status ?? "recorded",
			deepLink: exactSearchDeepLink(view, entry.deepLinks),
		})),
	];
	const seen = new Set();
	return rows
		.filter((entry) => {
			if (seen.has(`${entry.kind}:${entry.subjectId}`)) return false;
			const matches =
				`${entry.kind}\n${entry.subjectId}\n${entry.title}\n${entry.summary}\n${entry.state}`
					.toLocaleLowerCase("en-US")
					.includes(needle);
			if (matches) seen.add(`${entry.kind}:${entry.subjectId}`);
			return matches;
		})
		.map(({ deepLink: resultDeepLink, ...entry }) => ({
			...entry,
			...(resultDeepLink === null ? {} : { deepLink: resultDeepLink }),
		}));
}

function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function exportValue(view) {
	return {
		kind: view.kind,
		schemaVersion: view.schemaVersion,
		protocolVersion: view.protocolVersion,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		status: view.status,
		attention: view.attention,
		domainMetrics: view.domainMetrics,
		cycles: view.cycles,
		inbox: view.inbox.map(({ ownerActorId: _ownerActorId, ...entry }) => entry),
		actions: view.actions.map(
			({ ownerActorId: _ownerActorId, ...entry }) => entry,
		),
		evidence: view.evidence,
		claims: view.claims,
		rationale: view.rationale,
		outcomes: view.outcomes,
		learnings: view.learnings,
		history: view.history,
		replay: view.replay,
		omissions: view.omissions,
	};
}

function buildExport(view, format) {
	const value = exportValue(view);
	if (format === "json") {
		return {
			format,
			mediaType: "application/json",
			content: JSON.stringify(value),
		};
	}
	if (format === "html") {
		const content = `<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenPlanr Operate audit export</title><body><main><h1>Operate audit export</h1><p>${escapeHtml(`${view.domainId} / ${view.scopeId}`)}</p><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></main></body></html>`;
		return { format, mediaType: "text/html; charset=utf-8", content };
	}
	return null;
}

const AUDIT_SURFACES = new Set([
	"evidence",
	"outcomes",
	"outcome",
	"history",
	"search",
	"export",
]);

function hasUniqueIds(records, field) {
	const ids = records.map((entry) => entry[field]);
	return ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length;
}

function restrictedEvidenceIsClosed(entry) {
	if (entry.accessState === "available") return entry.accessReason === null;
	return (
		entry.accessState === "restricted" &&
		entry.claimStatus === "restricted" &&
		entry.evidenceKind === null &&
		entry.resolvedAt === null &&
		entry.source === null &&
		entry.producer === null &&
		entry.observedAt === null &&
		entry.provenance === null &&
		entry.confidence === null &&
		entry.accessReason === "access-denied" &&
		entry.supportClaimIds.length === 0 &&
		entry.contradictClaimIds.length === 0 &&
		entry.gaps.length === 0 &&
		entry.errors.length === 0 &&
		entry.causalLinks.length === 0
	);
}

function restrictedClaimIsClosed(entry) {
	if (entry.accessReason === null) return entry.statement !== null;
	return (
		entry.status === "restricted" &&
		entry.accessReason === "access-denied" &&
		entry.statement === null &&
		entry.source === null &&
		entry.producer === null &&
		entry.provenance === null &&
		entry.confidence === null &&
		entry.supportEvidenceRefIds.length === 0 &&
		entry.contradictEvidenceRefIds.length === 0 &&
		entry.gaps.length === 0 &&
		entry.errors.length === 0 &&
		entry.causalLinks.length === 0
	);
}

function exactEvidenceClaimCustody(view) {
	const evidence = new Map(
		view.evidence.map((entry) => [entry.evidenceRefId, entry]),
	);
	const claims = new Map(view.claims.map((entry) => [entry.claimId, entry]));
	if (
		!hasUniqueIds(view.evidence, "evidenceRefId") ||
		!hasUniqueIds(view.claims, "claimId") ||
		!view.evidence.every(restrictedEvidenceIsClosed) ||
		!view.claims.every(restrictedClaimIsClosed)
	)
		return false;
	for (const entry of view.evidence) {
		if (
			!entry.supportClaimIds.every(
				(id) => claims.get(id)?.supportEvidenceRefIds.includes(entry.evidenceRefId),
			) ||
			!entry.contradictClaimIds.every((id) =>
				claims.get(id)?.contradictEvidenceRefIds.includes(entry.evidenceRefId),
			)
		)
			return false;
	}
	for (const entry of view.claims) {
		if (
			!entry.supportEvidenceRefIds.every(
				(id) => evidence.get(id)?.supportClaimIds.includes(entry.claimId),
			) ||
			!entry.contradictEvidenceRefIds.every((id) =>
				evidence.get(id)?.contradictClaimIds.includes(entry.claimId),
			)
		)
			return false;
	}
	return true;
}

function exactOutcomeCustody(view) {
	if (
		!hasUniqueIds(view.outcomes, "outcomeId") ||
		!hasUniqueIds(view.learnings, "learningId")
	)
		return false;
	const actionIds = new Set(view.actions.map((entry) => entry.actionId));
	const outcomeIds = new Set(view.outcomes.map((entry) => entry.outcomeId));
	for (const outcome of view.outcomes) {
		const verification = outcome.verification;
		const metric = outcome.metric;
		if (
			!actionIds.has(outcome.actionId) ||
			verification === null ||
			metric === null ||
			outcome.verificationPlanId !== verification.verificationPlanId ||
			metric.metricId !== verification.metricId ||
			metric.metricHash !== verification.metricHash
		)
			return false;
		if (
			outcome.status === "insufficient-evidence" &&
			(metric.observed !== null ||
				outcome.observationIds.length !== 0 ||
				outcome.evidenceRefIds.length !== 0 ||
				outcome.snapshot !== null ||
				outcome.delta !== null)
		)
			return false;
		if (
			(outcome.accessReason === "access-denied" ||
				verification.accessReason === "access-denied") &&
			!outcomeCarriesRestrictedProof(outcome)
		)
			return false;
		if (
			["succeeded", "failed"].includes(outcome.status) &&
			!outcomeCarriesAffirmativeProof(outcome) &&
			!outcomeCarriesRestrictedAffirmativeProof(outcome)
		)
			return false;
	}
	return view.learnings.every((entry) => outcomeIds.has(entry.outcomeId));
}

function assertAuditProjectionCustody(view) {
	if (!exactEvidenceClaimCustody(view) || !exactOutcomeCustody(view))
		throw new TypeError("The audit projection is not semantically coherent.");
}

function ownedAuditDeepLink(view, value) {
	const destination = resolveOperateExperienceSearchDestination(view, value);
	return destination?.subjectId !== null &&
		["evidence", "outcomes", "outcome"].includes(destination?.surface)
		? value
		: null;
}

function exactOwnedAuditDeepLink(view, value, surface, subjectId) {
	const destination = resolveOperateExperienceSearchDestination(view, value);
	return destination?.surface === surface && destination.subjectId === subjectId
		? value
		: null;
}

function sanitizeAuditNode(view, value, { omitUnsafeDeepLink = false } = {}) {
	if (Array.isArray(value))
		return value.map((entry) =>
			sanitizeAuditNode(view, entry, { omitUnsafeDeepLink }),
		);
	if (value === null || typeof value !== "object") return value;
	const result = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "deepLink") {
			const link = ownedAuditDeepLink(view, child);
			if (link !== null || !omitUnsafeDeepLink) result[key] = link;
			continue;
		}
		if (key === "deepLinks") {
			result[key] = child
				.map((entry) => ownedAuditDeepLink(view, entry))
				.filter((entry) => entry !== null);
			continue;
		}
		if (key === "error" && child !== null && typeof child === "object") {
			result[key] = sanitizeAuditNode(
				view,
				{ ...child, context: {} },
				{ omitUnsafeDeepLink },
			);
			continue;
		}
		result[key] = sanitizeAuditNode(view, child, { omitUnsafeDeepLink });
	}
	return result;
}

function sanitizeAuditExportNode(view, value) {
	if (Array.isArray(value))
		return value.map((entry) => sanitizeAuditExportNode(view, entry));
	if (value === null || typeof value !== "object") return value;
	const result = {};
	for (const [key, child] of Object.entries(value)) {
		if (
			[
				"ownerActorId",
				"actorId",
				"partyId",
				"requiredCapability",
				"source",
				"producer",
				"provenance",
				"authority",
				"actionLocator",
				"rawHash",
				"canonicalHash",
			].includes(key)
		)
			continue;
		if (key === "errors") {
			result[key] = [];
			continue;
		}
		if (key === "deepLink") {
			result[key] = ownedAuditDeepLink(view, child);
			continue;
		}
		if (key === "deepLinks") {
			result[key] = child
				.map((entry) => ownedAuditDeepLink(view, entry))
				.filter((entry) => entry !== null);
			continue;
		}
		result[key] = sanitizeAuditExportNode(view, child);
	}
	return result;
}

function canonicalizeAuditExportValue(value) {
	if (Array.isArray(value))
		return value.map((entry) => canonicalizeAuditExportValue(entry));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalizeAuditExportValue(value[key])]),
	);
}

function closeEvidenceLinks(view, data) {
	return {
		...data,
		evidence: data.evidence.map((entry) => ({
			...entry,
			deepLink: exactOwnedAuditDeepLink(
				view,
				entry.deepLink,
				"evidence",
				entry.evidenceRefId,
			),
			causalLinks: entry.causalLinks.map((link) => ({
				...link,
				deepLink:
					link.kind === "outcome"
						? exactOwnedAuditDeepLink(
								view,
								link.deepLink,
								"outcome",
								link.subjectId,
							)
						: null,
			})),
		})),
		claims: data.claims.map((entry) => ({
			...entry,
			deepLink: exactOwnedAuditDeepLink(
				view,
				entry.deepLink,
				"evidence",
				entry.claimId,
			),
			causalLinks: entry.causalLinks.map((link) => ({
				...link,
				deepLink:
					link.kind === "outcome"
						? exactOwnedAuditDeepLink(
								view,
								link.deepLink,
								"outcome",
								link.subjectId,
							)
						: null,
			})),
		})),
	};
}

function closeOutcomeLinks(view, data) {
	const closeOutcome = (entry) => ({
		...entry,
		deepLink: exactOwnedAuditDeepLink(
			view,
			entry.deepLink,
			"outcome",
			entry.outcomeId,
		),
		decision:
			entry.decision === null ? null : { ...entry.decision, deepLink: null },
		execution: entry.execution.map((result) => ({ ...result, deepLink: null })),
		rollback: entry.rollback.map((result) => ({ ...result, deepLink: null })),
	});
	if ("outcome" in data)
		return { ...data, outcome: closeOutcome(data.outcome) };
	return {
		...data,
		domainMetrics: data.domainMetrics.map((entry) => ({
			...entry,
			dueVerification: entry.dueVerification.map((item) => ({
				...item,
				deepLink: null,
			})),
		})),
		outcomes: data.outcomes.map(closeOutcome),
	};
}

function searchResultCandidateDeepLink(view, entry) {
	if (entry.kind === "action") {
		return (
			view.actions.find((item) => item.actionId === entry.subjectId)?.deepLink ??
			entry.deepLink
		);
	}
	if (entry.kind === "cycle") {
		return (
			view.cycles.find((item) => item.cycleId === entry.subjectId)?.deepLink ??
			entry.deepLink
		);
	}
	if (entry.kind === "assignment") {
		for (const cycle of view.cycles) {
			const assignment = cycle.assignments.find(
				(item) => item.assignmentId === entry.subjectId,
			);
			if (assignment) {
				return assignment.deepLink ?? cycle.deepLink ?? entry.deepLink;
			}
		}
	}
	return entry.deepLink;
}

function closeSearchLinks(view, data) {
	return {
		...data,
		results: data.results.map((entry) => {
			const candidate = searchResultCandidateDeepLink(view, entry);
			let deepLink = null;
			if (candidate !== undefined) {
				if (entry.kind === "evidence" || entry.kind === "claim") {
					deepLink = exactOwnedAuditDeepLink(
						view,
						candidate,
						"evidence",
						entry.subjectId,
					);
				} else if (entry.kind === "outcome") {
					deepLink = exactOwnedAuditDeepLink(
						view,
						candidate,
						"outcome",
						entry.subjectId,
					);
				} else if (entry.kind === "action") {
					deepLink = exactOwnedAuditDeepLink(
						view,
						candidate,
						"action",
						entry.subjectId,
					);
				} else if (entry.kind === "cycle") {
					deepLink = exactOwnedAuditDeepLink(
						view,
						candidate,
						"cycle",
						entry.subjectId,
					);
				} else if (entry.kind === "assignment") {
					const destination = resolveOperateExperienceSearchDestination(
						view,
						candidate,
					);
					if (destination?.surface === "cycle" && destination.subjectId) {
						deepLink = exactOwnedAuditDeepLink(
							view,
							candidate,
							"cycle",
							destination.subjectId,
						);
					}
				}
			}
			const { deepLink: _deepLink, ...base } = entry;
			return deepLink === null ? base : { ...base, deepLink };
		}),
	};
}

function closeHistoryLinks(view, data) {
	return {
		...data,
		history: data.history.map((entry) => ({
			...entry,
			deepLinks: entry.deepLinks.filter((deepLink) => {
				const destination = resolveOperateExperienceSearchDestination(
					view,
					deepLink,
				);
				if (destination?.surface === "evidence") {
					return (
						destination.subjectId === entry.entityId ||
						entry.evidenceRefIds.includes(destination.subjectId)
					);
				}
				return (
					destination?.surface === "outcome" &&
					destination.subjectId === entry.entityId
				);
			}),
		})),
	};
}

function closeAuditLinks(view, surface, data) {
	if (surface === "evidence") return closeEvidenceLinks(view, data);
	if (surface === "outcomes" || surface === "outcome")
		return closeOutcomeLinks(view, data);
	if (surface === "history") return closeHistoryLinks(view, data);
	if (surface === "search") return closeSearchLinks(view, data);
	return data;
}

function buildAuditExport(view, format) {
	const safeView = sanitizeAuditExportNode(view, view);
	const evidence = closeEvidenceLinks(view, {
		evidence: safeView.evidence,
		claims: safeView.claims,
		rationale: safeView.rationale,
	});
	const outcomes = closeOutcomeLinks(view, {
		domainMetrics: safeView.domainMetrics,
		outcomes: safeView.outcomes,
		learnings: safeView.learnings,
	});
	safeView.evidence = evidence.evidence;
	safeView.claims = evidence.claims;
	safeView.rationale = evidence.rationale;
	safeView.domainMetrics = outcomes.domainMetrics;
	safeView.outcomes = outcomes.outcomes;
	safeView.learnings = outcomes.learnings;
	const value = canonicalizeAuditExportValue(exportValue(safeView));
	if (format === "json") {
		return {
			format,
			mediaType: "application/json",
			content: JSON.stringify(value),
		};
	}
	if (format === "html") {
		const content = `<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenPlanr Operate audit export</title><body><main><h1>Operate audit export</h1><p>${escapeHtml(`${value.domainId} / ${value.scopeId}`)}</p><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></main></body></html>`;
		return { format, mediaType: "text/html; charset=utf-8", content };
	}
	return null;
}

/**
 * Select a surface from the canonical view. This function only filters already
 * projected fields; it never resolves evidence, ranks Today, or grants authority.
 */
export function selectOperateExperienceSurface(
	view,
	{
		surface = "today",
		binding,
		subjectId = null,
		cycleId = null,
		query = "",
		format = "json",
		projectId = null,
		generation = null,
	} = {},
) {
	let truthSummary;
	try {
		view = canonicalTransportView(view);
		truthSummary = transportTruthSummary(view);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The operating view is unavailable until it is refreshed.",
			409,
		);
	}
	if (!binding || !exactBinding(view, binding)) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating view is unavailable for this actor and scope.",
			403,
		);
	}
	if (!SURFACES.has(surface))
		return safeError(
			"OPERATE_SURFACE_UNKNOWN",
			"The requested operating view does not exist.",
			404,
		);
	if (surface === "search" && String(query).length > 512) {
		return safeError(
			"RESULT_CONTRACT_INVALID",
			"The operating search query exceeds the local read limit.",
			400,
		);
	}
	if (surface === "export" && !["json", "html"].includes(format)) {
		return safeError(
			"RESULT_CONTRACT_INVALID",
			"The requested operating export format is unsupported.",
			400,
		);
	}
	if ((surface === "cycle" || surface === "outcome" || surface === "action") && !subjectId) {
		return safeError(
			"OPERATE_SUBJECT_REQUIRED",
			"This operating view requires a subject.",
			400,
		);
	}
	const data = surfaceData(view, surface, {
		subjectId,
		cycleId,
		query,
		format,
		projectId,
		generation,
	});
	if (data === null)
		return safeError(
			"OPERATE_SUBJECT_NOT_FOUND",
			"The requested operating subject does not exist in this scope.",
			404,
		);
	const reasonCodes = STATUS_REASON[view.status] ?? [
		"OPERATE_PROJECTION_UNAVAILABLE",
	];
	return Object.freeze(
		assertOperateExperienceSurfaceV1({
			ok: true,
			kind: "operate-experience-surface",
			schemaVersion: "1.0.0",
			protocolVersion: view.protocolVersion,
			surface,
			readOnly: true,
			mutationEnabled: view.status === "ready",
			scopeId: view.scopeId,
			domainId: view.domainId,
			domainVersion: view.domainVersion,
			actorId: view.actorId,
			accessLevel: view.accessLevel,
			generatedAt: view.generatedAt,
			eventHead: view.eventHead,
			viewHash: view.viewHash,
			truthSummary,
			status: view.status,
			reasonCodes,
			data,
		}),
	);
}

/**
 * Issue one browser-verifiable Evidence/Outcomes/History/Search/Export surface.
 * The canonical legacy selector remains the single projection step. This owner
 * boundary then removes unowned navigation and private error/export metadata
 * before committing every selected byte for browser consumption.
 */
export function selectOperateExperienceAuditDisplaySurface(
	view,
	{
		surface = "evidence",
		binding,
		subjectId = null,
		cycleId = null,
		query = null,
		format = null,
	} = {},
) {
	try {
		view = canonicalTransportView(view);
		assertAuditProjectionCustody(view);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The operating audit view is unavailable until it is refreshed.",
			409,
		);
	}
	if (!AUDIT_SURFACES.has(surface))
		return safeError(
			"OPERATE_SURFACE_UNKNOWN",
			"The requested operating audit view does not exist.",
			404,
		);
	if (
		!binding ||
		!exactAuditDisplayBinding(view, binding, {
			surface,
			subjectId,
			cycleId,
			query,
			format,
		})
	) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating audit view is unavailable for this actor and scope.",
			403,
		);
	}

	const selected = selectOperateExperienceSurface(view, {
		surface,
		binding,
		subjectId,
		cycleId,
		query: query ?? "",
		format: format ?? "json",
	});
	if (!selected.ok) return selected;
	try {
		const payload = structuredClone(selected);
		payload.mutationEnabled = false;
		if (surface === "export") {
			payload.data = buildAuditExport(view, format);
		} else {
			payload.data = closeAuditLinks(view, surface, sanitizeAuditNode(view, payload.data, {
				omitUnsafeDeepLink: surface === "search",
			}));
		}
		return issueOperateExperienceAuditDisplaySurfaceV1(payload, binding);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The operating audit display is unavailable until it is refreshed.",
			409,
		);
	}
}

/**
 * Issue one browser-verifiable Today/Cycles/Cycle display envelope. The legacy
 * surface remains the selected payload so API/CLI compatibility is unchanged;
 * this parallel representation adds exact subset custody for dashboard use.
 */
export function selectOperateExperienceDisplaySurface(
	view,
	{
		surface = "today",
		binding,
		subjectId = null,
		cycleId = null,
	} = {},
) {
	try {
		view = canonicalTransportView(view);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The operating view is unavailable until it is refreshed.",
			409,
		);
	}
	if (!new Set(["today", "inbox", "cycles", "cycle", "actions"]).has(surface)) {
		return safeError(
			"OPERATE_SURFACE_UNKNOWN",
			"The requested operating display does not exist.",
			404,
		);
	}
	const exactSubjectId = surface === "cycle" || surface === "inbox"
		? subjectId
		: null;
	if (
		!binding ||
		!exactDisplayBinding(view, binding, surface, exactSubjectId)
	) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating view is unavailable for this actor and scope.",
			403,
		);
	}
	const selected = selectOperateExperienceSurface(view, {
		surface,
		binding,
		subjectId: exactSubjectId,
		cycleId,
		projectId: binding.projectId,
		generation: binding.generation,
	});
	if (!selected.ok) return selected;
	try {
		return issueOperateExperienceDisplaySurfaceV1(selected);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The operating display is unavailable until it is refreshed.",
			409,
		);
	}
}

/**
 * Select one exact Inbox item by its public itemId. The item remains inside the
 * existing Inbox display envelope so collection custody, actor/scope binding,
 * and the display integrity hash are identical to the collection read.
 */
export function selectOperateInboxItemDisplaySurface(
	view,
	{ binding, subjectId = null } = {},
) {
	if (typeof subjectId !== "string" || subjectId.length === 0) {
		return safeError(
			"OPERATE_SUBJECT_REQUIRED",
			"This operating Inbox view requires an item subject.",
			400,
		);
	}
	return selectOperateExperienceDisplaySurface(view, {
		surface: "inbox",
		binding,
		subjectId,
	});
}

/**
 * Compose Cycle detail only from the canonical owner read and the already
 * access-screened experience projection. The result intentionally carries no
 * Finding, Decision, or Action body fields from the owner ledger.
 */
export function selectOperateCycleWorkspace(
	view,
	cycleRead,
	{ binding, subjectId } = {},
) {
	let truthSummary;
	try {
		view = canonicalTransportView(view);
		truthSummary = transportTruthSummary(view);
		assertProtocolArtifact("operate-api-envelope", cycleRead, {
			protocolVersion: "2.0.0",
		});
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Cycle view is unavailable until it is refreshed.",
			409,
		);
	}
	if (!cycleRead.ok || cycleRead.operation !== "operate.cycle.get") {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Cycle view is unavailable until it is refreshed.",
			409,
		);
	}
	if (typeof subjectId !== "string" || subjectId.length === 0) {
		return safeError(
			"OPERATE_SUBJECT_REQUIRED",
			"This operating view requires a subject.",
			400,
		);
	}
	if (!binding || !exactCycleWorkspaceBinding(view, binding, subjectId)) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating view is unavailable for this actor and scope.",
			403,
		);
	}

	const owner = cycleRead.data;
	const cycle = view.cycles.find((entry) => entry.cycleId === subjectId);
	const ledger = owner.persistentWork.ledger;
	const links = owner.persistentWork.cycleLinks;
	const expectedLinks = ledger.cycleLinks.filter(
		(link) => link.cycleId === subjectId,
	);
	const canonicalStages = [
		"observe",
		"understand",
		"decide",
		"govern",
		"act",
		"verify",
		"learn",
	];
	const route = cycle
		? resolveOperateExperienceSearchDestination(view, cycle.deepLink)
		: null;
	const availableAssignmentIds =
		cycle?.assignments
			.filter((assignment) => assignment.state === "available")
			.map((assignment) => assignment.assignmentId) ?? [];
	const ownerAssignmentIds = owner.availableAssignments.map(
		(assignment) => assignment.assignmentId,
	);
	if (
		!cycle ||
		owner.cycle.cycleId !== subjectId ||
		owner.cycle.scopeId !== view.scopeId ||
		owner.cycle.domainId !== view.domainId ||
		owner.cycle.domainVersion !== view.domainVersion ||
		owner.cycle.state !== cycle.state ||
		owner.cycle.health !== cycle.health ||
		!exactJson(owner.cycle.focus, cycle.focus) ||
		owner.cycle.createdAt !== cycle.createdAt ||
		owner.cycle.updatedAt !== cycle.updatedAt ||
		ledger.scopeId !== view.scopeId ||
		ledger.domainId !== view.domainId ||
		ledger.domainVersion !== view.domainVersion ||
		ledger.generatedAt !== view.generatedAt ||
		!exactJson(links, expectedLinks) ||
		!exactPersistentLinkCoverage(ledger, links, subjectId, view) ||
		!exactJson(
			cycle.stages.map((stage) => stage.id),
			canonicalStages,
		) ||
		!exactJson(availableAssignmentIds, ownerAssignmentIds) ||
		!exactJson(owner.actions, cycleRead.allowedActions) ||
		!exactJson(cycle.replayCheckpoint, view.replay.checkpoint) ||
		!exactEventHead(view.replay.finalHead, view.eventHead) ||
		view.replay.parityProof.sourceStateHash !== view.sourceStateHash ||
		route?.surface !== "cycle" ||
		route.subjectId !== subjectId
	) {
		return safeError(
			"OPERATE_PROJECTION_STALE",
			"The Cycle reads do not identify one current durable state.",
			409,
		);
	}

	const findings = linkedPersistentRows(
		ledger.findings,
		links,
		"finding",
		"findingId",
	);
	const decisions = linkedPersistentRows(
		ledger.decisions,
		links,
		"decision",
		"decisionId",
	);
	const actions = linkedPersistentRows(
		ledger.actions,
		links,
		"action",
		"actionId",
	);
	const assignments = cycle.assignments.map((assignment) => {
		const destination = resolveOperateExperienceSearchDestination(
			view,
			assignment.deepLink,
		);
		return {
			...assignment,
			deepLink:
				destination?.surface === "cycle" && destination.subjectId === subjectId
					? assignment.deepLink
					: null,
		};
	});
	const projectedCycle = {
		...cycle,
		assignments,
		executiveBoard: sanitizeExecutiveBoardForCycleWorkspace(cycle.executiveBoard),
	};
	const actionIds = actions.map((entry) => entry.subjectId);
	const sourceActionIds = ledger.actions
		.filter((entry) => entry.sourceCycleId === subjectId)
		.map((entry) => entry.actionId);
	if (!exactJson(cycle.persistentActionIds, sourceActionIds)) {
		return safeError(
			"OPERATE_PROJECTION_STALE",
			"The Cycle reads do not identify one current durable state.",
			409,
		);
	}
	const outcomes = view.outcomes
		.filter((entry) => actionIds.includes(entry.actionId))
		.map((outcome) => {
			const destination = resolveOperateExperienceSearchDestination(
				view,
				outcome.deepLink,
			);
			return {
				...outcome,
				deepLink:
					destination?.surface === "outcome" &&
					destination.subjectId === outcome.outcomeId
						? outcome.deepLink
						: null,
			};
		});
	const outcomeIds = outcomes.map((entry) => entry.outcomeId);
	const learnings = view.learnings.filter((entry) =>
		outcomeIds.includes(entry.outcomeId),
	);
		const verification = verificationFromSharedTruth(truthSummary);

	return Object.freeze({
		ok: true,
		kind: "operate-cycle-workspace",
		schemaVersion: "1.0.0",
		protocolVersion: view.protocolVersion,
		readOnly: true,
		mutationEnabled: false,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		actorId: view.actorId,
		accessLevel: view.accessLevel,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
		truthSummary,
		status: view.status,
		reasonCodes: STATUS_REASON[view.status] ?? [
			"OPERATE_PROJECTION_UNAVAILABLE",
		],
		data: Object.freeze({
			ownerCycle: Object.freeze({
				cycleId: owner.cycle.cycleId,
				scopeId: owner.cycle.scopeId,
				domainId: owner.cycle.domainId,
				domainVersion: owner.cycle.domainVersion,
				state: owner.cycle.state,
				health: owner.cycle.health,
				focus: owner.cycle.focus,
				createdAt: owner.cycle.createdAt,
				updatedAt: owner.cycle.updatedAt,
			}),
			cycle: projectedCycle,
			progress: owner.progress,
			replay: view.replay,
			verification,
			persistentWork: Object.freeze({
				findings,
				decisions,
				actions,
				outcomes,
				learnings,
				cycleLinks: links,
			}),
			allowedActions: cycleRead.allowedActions,
		}),
	});
}

/** Issue the sanitized Cycle workspace with browser-verifiable exact custody. */
export function selectOperateCycleDisplayWorkspace(
	view,
	cycleRead,
	options = {},
) {
	const selected = selectOperateCycleWorkspace(view, cycleRead, options);
	if (!selected.ok) return selected;
	try {
		return issueOperateCycleDisplayWorkspaceV1(selected);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Cycle display is unavailable until it is refreshed.",
			409,
		);
	}
}

function exactReviewWorkspaceBinding(payload, binding, subjectId) {
	return Boolean(binding) &&
		binding.actorId === payload.actorId &&
		binding.scopeId === payload.scopeId &&
		binding.domainId === payload.domainId &&
		binding.domainVersion === payload.domainVersion &&
		binding.cycleId === payload.cycleId &&
		binding.reviewId === payload.reviewId &&
		binding.reviewId === subjectId &&
		binding.generatedAt === payload.generatedAt &&
		binding.sourceArtifactKind === payload.sourceArtifactKind &&
		binding.sourceArtifactHash === payload.sourceArtifactHash &&
		binding.sourceViewHash === payload.sourceViewHash &&
		exactEventHead(binding.sourceEventHead, payload.sourceEventHead) &&
		exactEventHead(binding.sourceReadEventHead, payload.sourceReadEventHead);
}

/**
 * Compose one owner-bound Review workspace only from an exact verified pending
 * read or immutable terminal receipt and its exact actor-screened view.
 */
export function selectOperateReviewWorkspace(
	view,
	reviewSource,
	{ binding, subjectId } = {},
) {
	let payload;
	try {
		payload = buildOperateReviewWorkspacePayloadV1(reviewSource, view);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Review workspace is unavailable until its verified sources agree.",
			409,
		);
	}
	if (typeof subjectId !== "string" || subjectId.length === 0) {
		return safeError(
			"OPERATE_SUBJECT_REQUIRED",
			"This Review workspace requires one Review identity.",
			400,
		);
	}
	if (subjectId !== payload.reviewId) {
		return safeError(
			"OPERATE_SUBJECT_NOT_FOUND",
			"The requested Review does not exist in this scope.",
			404,
		);
	}
	if (!exactReviewWorkspaceBinding(payload, binding, subjectId)) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested Review is unavailable for this actor and scope.",
			403,
		);
	}
	return payload;
}

/** Issue the canonical Review workspace with payload-only display integrity. */
export function selectOperateReviewDisplayWorkspace(
	view,
	reviewSource,
	options = {},
) {
	const selected = selectOperateReviewWorkspace(view, reviewSource, options);
	if (!selected.ok) return selected;
	try {
		return issueOperateReviewDisplayWorkspaceV1(selected);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Review display is unavailable until it is refreshed.",
			409,
		);
	}
}

/**
 * Compose Action detail only from the canonical access-safe experience projection.
 */
export function selectOperateActionWorkspace(
	view,
	{ binding, subjectId, commandsAvailable = false } = {},
) {
	try {
		view = canonicalTransportView(view);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Action view is unavailable until it is refreshed.",
			409,
		);
	}
	if (typeof subjectId !== "string" || subjectId.length === 0) {
		return safeError(
			"OPERATE_SUBJECT_REQUIRED",
			"This operating view requires a subject.",
			400,
		);
	}
	if (!binding || !exactActionWorkspaceBinding(view, binding, subjectId)) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating view is unavailable for this actor and scope.",
			403,
		);
	}
	const action = view.actions.find((entry) => entry.actionId === subjectId);
	const route = action
		? resolveOperateExperienceSearchDestination(view, action.deepLink)
		: null;
	const outcome =
		view.outcomes.find((entry) => entry.actionId === subjectId) ?? null;
	const learnings = outcome
		? view.learnings.filter((entry) => entry.outcomeId === outcome.outcomeId)
		: [];
	const allowedActions = view.allowedActions.filter(
		(entry) => entry.subjectId === subjectId,
	);
	const mutationEnabled =
		commandsAvailable === true &&
		view.status === "ready" &&
		allowedActions.some((entry) => entry.action.effect !== "read-only");
	const inbox = view.inbox.filter((entry) => entry.subjectId === subjectId);
	if (
		!action ||
		action.deepLink !== actionDeepLink(subjectId) ||
		route?.surface !== "action" ||
		route.subjectId !== subjectId
	) {
		return safeError(
			"OPERATE_PROJECTION_STALE",
			"The Action reads do not identify one current durable state.",
			409,
		);
	}
	return Object.freeze({
		ok: true,
		kind: "operate-action-workspace",
		schemaVersion: "1.0.0",
		protocolVersion: view.protocolVersion,
		readOnly: !mutationEnabled,
		mutationEnabled,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		actorId: view.actorId,
		accessLevel: view.accessLevel,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
		status: view.status,
		reasonCodes: STATUS_REASON[view.status] ?? [
			"OPERATE_PROJECTION_UNAVAILABLE",
		],
		data: Object.freeze({
			action,
			outcome,
			learnings,
			inbox,
			history: actionHistory(view, subjectId),
			replay: view.replay,
			verification: verificationFromOutcome(outcome),
			boundaries: ACTION_WORKSPACE_BOUNDARIES,
			allowedActions,
		}),
	});
}

/** Issue the sanitized Action workspace with browser-verifiable exact custody. */
export function selectOperateActionDisplayWorkspace(view, options = {}) {
	const selected = selectOperateActionWorkspace(view, options);
	if (!selected.ok) return selected;
	try {
		return issueOperateActionDisplayWorkspaceV1(selected);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The Action display is unavailable until it is refreshed.",
			409,
		);
	}
}

/** Issue the sanitized recovery display with browser-verifiable exact custody. */
export function selectOperateRecoveryDisplay(view, recoveryRead, { binding } = {}) {
	try {
		view = canonicalTransportView(view);
		assertProtocolArtifact("operate-api-envelope", recoveryRead, {
			protocolVersion: "2.0.0",
		});
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The recovery view is unavailable until it is refreshed.",
			409,
		);
	}
	if (!recoveryRead.ok || recoveryRead.operation !== "operate.recovery.inspect") {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The recovery view is unavailable until it is refreshed.",
			409,
		);
	}
	if (!binding || !exactRecoveryDisplayBinding(view, binding)) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating view is unavailable for this actor and scope.",
			403,
		);
	}
	const inspection = sanitizeRecoveryInspection(recoveryRead.data);
	if (!inspection || typeof inspection !== "object") {
		return safeError(
			"OPERATE_PROJECTION_STALE",
			"The recovery reads do not identify one current durable state.",
			409,
		);
	}
	const selected = Object.freeze({
		ok: true,
		kind: "operate-recovery",
		schemaVersion: "1.0.0",
		protocolVersion: view.protocolVersion,
		readOnly: true,
		mutationEnabled: false,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		actorId: view.actorId,
		accessLevel: view.accessLevel,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
		status: view.status,
		reasonCodes: STATUS_REASON[view.status] ?? [
			"OPERATE_PROJECTION_UNAVAILABLE",
		],
		data: Object.freeze({
			inspection,
			history: recoveryHistory(view),
			allowedActions: recoveryRead.allowedActions ?? [],
			recoveryState: recoveryStateFromInspection(inspection),
		}),
	});
	try {
		return issueOperateRecoveryDisplaySurfaceV1(selected);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The recovery display is unavailable until it is refreshed.",
			409,
		);
	}
}

/** Issue the sanitized executive board with browser-verifiable exact custody. */
export function selectOperateExecutiveBoardDisplay(view, { binding, subjectId } = {}) {
	try {
		view = canonicalTransportView(view);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The executive board view is unavailable until it is refreshed.",
			409,
		);
	}
	if (typeof subjectId !== "string" || subjectId.length === 0) {
		return safeError(
			"OPERATE_SUBJECT_REQUIRED",
			"This operating view requires a subject.",
			400,
		);
	}
	if (!binding || !exactExecutiveBoardBinding(view, binding, subjectId)) {
		return safeError(
			"OPERATE_BINDING_MISMATCH",
			"The requested operating view is unavailable for this actor and scope.",
			403,
		);
	}
	if (view.domainId !== "business") {
		return safeError(
			"OPERATE_PROJECTION_UNAVAILABLE",
			"The executive board is only available for business operating cycles.",
			404,
		);
	}
	const cycle = view.cycles.find((entry) => entry.cycleId === subjectId);
	const executiveBoard = cycle?.executiveBoard ?? null;
	if (
		!cycle ||
		!executiveBoard ||
		executiveBoard.cycleId !== subjectId ||
		!Array.isArray(executiveBoard.seats) ||
		!executiveBoard.seats.every(validExecutiveBoardSeatIdentity) ||
		!validExecutiveBoardChairSynthesis(executiveBoard.chairSynthesis ?? null)
	) {
		return safeError(
			"OPERATE_PROJECTION_STALE",
			"The executive board reads do not identify one current durable state.",
			409,
		);
	}
	const route = resolveOperateExperienceSearchDestination(view, cycle.deepLink);
	if (route?.surface !== "cycle" || route.subjectId !== subjectId) {
		return safeError(
			"OPERATE_PROJECTION_STALE",
			"The executive board reads do not identify one current durable state.",
			409,
		);
	}

	const selected = Object.freeze({
		ok: true,
		kind: "operate-executive-board",
		schemaVersion: "1.0.0",
		protocolVersion: view.protocolVersion,
		readOnly: true,
		mutationEnabled: false,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		actorId: view.actorId,
		accessLevel: view.accessLevel,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
		status: view.status,
		reasonCodes: STATUS_REASON[view.status] ?? [
			"OPERATE_PROJECTION_UNAVAILABLE",
		],
		data: Object.freeze({
			cycleId: subjectId,
			executiveBoard,
		}),
	});
	try {
		return issueOperateExecutiveBoardDisplaySurfaceV1(selected);
	} catch {
		return safeError(
			"OPERATE_PROJECTION_INVALID",
			"The executive board display is unavailable until it is refreshed.",
			409,
		);
	}
}

export function encodeOperateExperienceCheckpoint({ eventHead, viewHash }) {
	const value = JSON.stringify({
		sequence: eventHead.sequence,
		hash: eventHead.hash,
		viewHash,
	});
	return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeOperateExperienceCheckpoint(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 512)
		return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		if (
			!Number.isInteger(parsed.sequence) ||
			parsed.sequence < 0 ||
			(parsed.sequence === 0
				? parsed.hash !== null
				: !/^sha256:[a-f0-9]{64}$/.test(parsed.hash)) ||
			!/^sha256:[a-f0-9]{64}$/.test(parsed.viewHash)
		)
			return null;
		return Object.freeze({
			eventHead: { sequence: parsed.sequence, hash: parsed.hash },
			viewHash: parsed.viewHash,
		});
	} catch {
		return null;
	}
}

export {
	DEFAULT_MAX_BYTES as OPERATE_EXPERIENCE_MAX_BYTES,
	PROJECTION_RELATIVE_PATH as OPERATE_EXPERIENCE_RELATIVE_PATH,
};
