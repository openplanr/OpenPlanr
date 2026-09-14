import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	assertOperateExperienceAuditDisplaySurfaceV1,
	issueOperateExperienceAuditDisplaySurfaceV1,
	validateOperateExperienceAuditDisplaySurfaceV1,
} from "../../lib/dashboard/operate-experience-audit-display-contract.mjs";
import { selectOperateExperienceAuditDisplaySurface } from "../../lib/dashboard/operate-experience-reader.mjs";
import { sha256Jcs } from "../../lib/protocol/jcs.mjs";
import { rehashExperienceView } from "./experience-view-test-support.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const PRIVATE_ERROR_LOCATOR =
	"private-repository-locator-must-not-cross-audit-export";
const PRIVATE_CLAIM =
	"private-restricted-claim-must-not-cross-the-owner-boundary";

const emptyFixture = JSON.parse(
	readFileSync(
		new URL(
			"../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json",
			import.meta.url,
		),
		"utf8",
	),
)["operate-experience-view"];

function rehashView(view) {
	return rehashExperienceView(view);
}

function cycle() {
	return {
		cycleId: "cycle-1",
		state: "approved",
		health: "normal",
		focus: ["API/CLI, C#/.NET, and https://[2001:db8::1]/audit?q=$HOME"],
		createdAt: "2026-08-11T07:00:00Z",
		updatedAt: emptyFixture.generatedAt,
		stages: [
			"observe",
			"understand",
			"decide",
			"govern",
			"act",
			"verify",
			"learn",
		].map((id, index) => ({
			id,
			state: index < 4 ? "complete" : index === 4 ? "current" : "waiting",
			reason: null,
			inputArtifactIds: [],
			outputArtifactIds: [],
			gates: [],
			evidenceGapIds: [],
			uncertaintyIds: [],
			persistentActionIds: [],
		})),
		assignments: [],
		lensAbsences: [],
		executiveBoard: null,
		dependencies: [],
		blockers: [],
		persistentActionIds: ["act_00000001"],
		replayCheckpoint: null,
		deepLink: "#/operate/cycles/cycle-1",
	};
}

function action() {
	return {
		actionId: "act_00000001",
		revision: 1,
		actionHash: HASH_A,
		title: "Measure retention without inventing success",
		state: "completed",
		ownerActorId: emptyFixture.actorId,
		expectedResult: "The exact Outcome remains evidence-bound.",
		verificationPlanId: "verify-1",
		deliveryRoute: {
			kind: "operating-delivery-route",
			schemaVersion: "1.0.0",
			protocolVersion: "2.0.0",
			routeId: "droute_00000001",
			scopeId: emptyFixture.scopeId,
			domainId: emptyFixture.domainId,
			domainVersion: emptyFixture.domainVersion,
			action: {
				actionId: "act_00000001",
				revision: 1,
				actionHash: HASH_A,
			},
			eventHead: structuredClone(emptyFixture.eventHead),
			route: "observe-only",
			rationale: "The audit representation is read-only.",
			createdAt: emptyFixture.generatedAt,
			routeHash: HASH_B,
		},
		dependencyActionIds: [],
		executions: [],
		rollbacks: [],
		deepLink: "#/operate/actions/act_foreign_00000001",
	};
}

function availableEvidence() {
	return {
		evidenceRefId: "evidence-available",
		classification: "public",
		accessState: "available",
		freshness: "current",
		evidenceKind: "operate-artifact",
		resolvedAt: emptyFixture.generatedAt,
		claimStatus: "supported",
		supportClaimIds: ["claim-retention"],
		contradictClaimIds: [],
		source: {
			evidenceKind: "operate-artifact",
			provider: { id: "provider-public", version: "1.0.0" },
			resolver: { id: "resolver-public", version: "1.0.0" },
		},
		producer: {
			actorId: "advisor-agent",
			roleId: "advisor",
			runtime: "openplanr",
		},
		observedAt: emptyFixture.generatedAt,
		scope: {
			scopeId: emptyFixture.scopeId,
			domainId: emptyFixture.domainId,
			domainVersion: emptyFixture.domainVersion,
		},
		sensitivity: "public",
		provenance: {
			sourceArtifactId: "artifact-source",
			evidenceArtifactId: "artifact-evidence",
			rawHash: HASH_A,
			canonicalHash: HASH_B,
			sizeBytes: 128,
			mediaType: "application-json",
			accessLevel: "public",
		},
		confidence: 0.8,
		gaps: ["gap-one-window"],
		errors: [
			{
				resolutionId: "resolution-1",
				error: {
					code: "SOURCE_STALE",
					retryable: false,
					context: { repositoryId: PRIVATE_ERROR_LOCATOR },
				},
				resolvedAt: emptyFixture.generatedAt,
			},
		],
		accessReason: null,
		causalLinks: [
			{
				kind: "outcome",
				subjectId: "outcome-1",
				relation: "evaluates",
				deepLink: "#/operate/outcomes/outcome-1",
			},
			{
				kind: "action",
				subjectId: "act_00000001",
				relation: "informs",
				deepLink: "#/operate/actions/act_foreign_00000001",
			},
		],
		deepLink: "#/operate/evidence/evidence-available",
	};
}

function restrictedEvidence() {
	return {
		evidenceRefId: "evidence-restricted",
		classification: "restricted",
		accessState: "restricted",
		freshness: "stale",
		evidenceKind: null,
		resolvedAt: null,
		claimStatus: "restricted",
		supportClaimIds: [],
		contradictClaimIds: [],
		source: null,
		producer: null,
		observedAt: null,
		scope: {
			scopeId: emptyFixture.scopeId,
			domainId: emptyFixture.domainId,
			domainVersion: emptyFixture.domainVersion,
		},
		sensitivity: "restricted",
		provenance: null,
		confidence: null,
		gaps: [],
		errors: [],
		accessReason: "access-denied",
		causalLinks: [],
		deepLink: "#/operate/evidence/evidence-that-does-not-exist",
	};
}

function claims() {
	const scope = {
		scopeId: emptyFixture.scopeId,
		domainId: emptyFixture.domainId,
		domainVersion: emptyFixture.domainVersion,
	};
	return [
		{
			claimId: "claim-retention",
			status: "supported",
			epistemicStatus: "strongly-supported",
			statement:
				"Retention <script>alert('public-text')</script> remains measurable.",
			supportEvidenceRefIds: ["evidence-available"],
			contradictEvidenceRefIds: [],
			source: null,
			producer: null,
			observedAt: emptyFixture.generatedAt,
			scope,
			sensitivity: "public",
			provenance: null,
			confidence: 0.9,
			gaps: [],
			errors: [],
			accessReason: null,
			causalLinks: [
				{
					kind: "action",
					subjectId: "act_00000001",
					relation: "informs",
					deepLink: "#/operate/actions/act_foreign_00000001",
				},
			],
			deepLink: "#/operate/evidence/claim-retention",
		},
		{
			claimId: "claim-restricted",
			status: "restricted",
			epistemicStatus: "unknown",
			statement: null,
			supportEvidenceRefIds: [],
			contradictEvidenceRefIds: [],
			source: null,
			producer: null,
			observedAt: emptyFixture.generatedAt,
			scope,
			sensitivity: "restricted",
			provenance: null,
			confidence: null,
			gaps: [],
			errors: [],
			accessReason: "access-denied",
			causalLinks: [],
			deepLink: "#/operate/evidence/claim-restricted",
		},
	];
}

function metric() {
	return {
		metricId: "metric-retention",
		title: "Retention",
		value: null,
		unit: "percent",
		change: null,
		window: "Q3",
		freshness: "unknown",
		state: "unavailable",
		target: 85,
		threshold: 75,
		evidenceRefIds: [],
		snapshot: null,
		delta: null,
		dueVerification: [
			{
				verificationPlanId: "verify-1",
				actionId: "act_00000001",
				state: "insufficient-evidence",
				dueAt: null,
				window: "Q3",
				deepLink: "#/operate/actions/act_foreign_00000001",
			},
		],
		accessReason: null,
	};
}

function outcome() {
	return {
		outcomeId: "outcome-1",
		actionId: "act_00000001",
		verificationPlanId: "verify-1",
		status: "insufficient-evidence",
		metric: {
			metricId: "metric-retention",
			metricHash: HASH_B,
			baseline: 72,
			target: 85,
			observed: null,
			unit: "percent",
			window: "Q3",
			dueAt: null,
			freshness: "unknown",
			confidence: null,
		},
		observationIds: [],
		evidenceRefIds: [],
		observedAt: emptyFixture.generatedAt,
		decision: {
			decisionId: "decision-1",
			revision: 1,
			state: "approved",
			deepLink: "#/operate/inbox/decision-1",
		},
		execution: [
			{
				resultId: "result-1",
				operationId: "operation-1",
				status: "succeeded",
				completedAt: emptyFixture.generatedAt,
				effectSummary: {
					changed: true,
					summary: "The contained effect completed; value remains unverified.",
					affectedTargetIds: ["target-1"],
				},
				targetBeforeHash: HASH_A,
				targetAfterHash: HASH_C,
				accessReason: null,
				deepLink: "#/operate/history/operation-1",
			},
		],
		rollback: [],
		verification: {
			verificationPlanId: "verify-1",
			verificationPlanHash: HASH_C,
			metricId: "metric-retention",
			metricHash: HASH_B,
			method: "Wait for one accepted observation.",
			evaluationRules: ["Do not infer success without an observation."],
			observationRequest: {
				kind: "future-observation",
				reason: "Observe one full retention window.",
			},
			accessReason: null,
		},
		nextObservation: {
			kind: "future-observation",
			reason: "Observe one full retention window.",
			dueAt: null,
		},
		revisit: {
			decisionIds: ["decision-1"],
			conditions: ["The target remains unobserved."],
		},
		snapshot: null,
		delta: null,
		accessReason: null,
		deepLink: "#/operate/outcomes/outcome-1",
	};
}

function restrictedAffirmativeOutcome() {
	const value = outcome();
	value.status = "succeeded";
	value.metric = {
		...value.metric,
		baseline: null,
		target: null,
		observed: null,
		unit: null,
		window: null,
		freshness: "current",
		confidence: null,
	};
	value.verification = {
		...value.verification,
		method: null,
		evaluationRules: [],
		observationRequest: null,
		accessReason: "access-denied",
	};
	value.nextObservation = null;
	value.revisit = null;
	value.accessReason = "access-denied";
	return value;
}

function restrictedInsufficientOutcome() {
	const value = outcome();
	value.metric = {
		...value.metric,
		baseline: null,
		target: null,
		observed: null,
		unit: null,
		window: null,
		confidence: null,
	};
	value.verification = {
		...value.verification,
		method: null,
		evaluationRules: [],
		observationRequest: null,
		accessReason: "access-denied",
	};
	value.nextObservation = null;
	value.revisit = null;
	value.accessReason = "access-denied";
	return value;
}

function privateInboxItem() {
	return {
		itemId: "approval:private-export",
		kind: "approval",
		subjectId: "act_00000001",
		ownerActorId: "private-owner-actor-must-not-cross-export",
		state: "waiting",
		title: "A named approval remains required",
		consequence:
			"The read-only audit export retains only safe aggregate state.",
		expiresAt: null,
		blocking: true,
		evidence: [],
		requiredParties: [
			{
				partyId: "review-owner:private-party-must-not-cross-export",
				actorKind: "human",
				actorId: "private-party-must-not-cross-export",
				requiredCapability: { id: "operate-review", version: "1.0.0" },
				state: "required",
				redacted: false,
			},
		],
		redactions: [],
		actionLocator: null,
		navigationLocator: null,
		unavailableReason: {
			code: "OPERATE_APPROVAL_PARTY_UNAVAILABLE",
			message: "No exact owner-issued approval is available to this actor.",
		},
	};
}

function historyEvent() {
	return {
		eventId: "event-1",
		sequence: 1,
		type: "verification.recorded",
		entityId: "outcome-1",
		actorKind: "runtime",
		actorId: "openplanr",
		timestamp: emptyFixture.generatedAt,
		correlationId: "correlation-1",
		eventHash: emptyFixture.eventHead.hash,
		change: {
			subjectKind: "outcome",
			summary: "Insufficient evidence was recorded without false success.",
		},
		why: "No accepted observation exists.",
		authority: null,
		evidenceRefIds: [],
		prior: { previousEventHash: null, causationId: null },
		result: {
			status: "insufficient-evidence",
			completedAt: emptyFixture.generatedAt,
		},
		next: { label: "Inspect Outcome", tool: "operate.outcome.get" },
		deepLinks: [
			"#/operate/outcomes/outcome-1",
			"#/operate/history/operation-1",
			"#/operate/outcomes/outcome%2Fencoded",
		],
		beforeAfter: null,
	};
}

function auditView(overrides = {}) {
	const omissions = [
		{ classification: "restricted", count: 2, reason: "access-denied" },
	];
	const base = {
		...structuredClone(emptyFixture),
		attention: [
			{
				attentionId: "attention-outcome-1",
				kind: "outcome",
				subjectId: "outcome-1",
				priority: 700,
				title: "Retention evidence remains incomplete",
				whyNow: "The observation window is open.",
				consequence: "The product must not claim success.",
				state: "insufficient-evidence",
				dueAt: null,
				evidenceRefIds: [],
			},
		],
		domainMetrics: [metric()],
		cycles: [cycle()],
		actions: [action()],
		evidence: [availableEvidence(), restrictedEvidence()],
		claims: claims(),
		rationale: [
			{
				nodeId: "rationale-1",
				kind: "outcome",
				subjectId: "outcome-1",
				summary: "The accepted Evidence does not contain an observation.",
				artifactId: null,
				evidenceRefIds: ["evidence-available"],
			},
		],
		outcomes: [outcome()],
		learnings: [
			{
				learningId: "learning-1",
				outcomeId: "outcome-1",
				statement:
					"Missing evidence is itself a reason to revisit the Decision.",
				decisionIds: ["decision-1"],
				evidenceRefIds: ["evidence-available"],
				createdAt: emptyFixture.generatedAt,
			},
		],
		history: [historyEvent()],
		replay: {
			...structuredClone(emptyFixture.replay),
			redactions: structuredClone(omissions),
		},
		omissions,
		export: {
			formats: ["html", "json"],
			accessSafe: true,
			redactionCount: 2,
		},
		...overrides,
	};
	return rehashView(base);
}

function auditBinding(
	view,
	surface,
	{ subjectId = null, query = null, format = null } = {},
) {
	return {
		actorId: view.actorId,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		cycleId: "cycle-1",
		subjectId,
		surface,
		query,
		format,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
	};
}

function selected(
	view,
	surface,
	{ subjectId = null, query = null, format = null } = {},
) {
	const expected = auditBinding(view, surface, { subjectId, query, format });
	const value = selectOperateExperienceAuditDisplaySurface(view, {
		surface,
		binding: expected,
		subjectId,
		cycleId: expected.cycleId,
		...(surface === "search" ? { query } : {}),
		...(surface === "export" ? { format } : {}),
	});
	return { expected, value };
}

function assertRefused(value, privateMarker = null) {
	assert.equal(value?.ok, false);
	assert.equal(typeof value?.error?.reasonCode, "string");
	if (privateMarker !== null) {
		assert.equal(JSON.stringify(value).includes(privateMarker), false);
	}
}

function reverseTopLevelKeys(value) {
	return Object.fromEntries(Object.entries(value).reverse());
}

function withoutContentHash(value) {
	const copy = structuredClone(value);
	delete copy.integrity.contentHash;
	return copy;
}

test("audit owner issues and synchronously verifies all six exact selected surfaces", () => {
	const view = auditView();
	const cases = [
		["evidence", { subjectId: null, query: null, format: null }],
		["outcomes", { subjectId: null, query: null, format: null }],
		["outcome", { subjectId: "outcome-1", query: null, format: null }],
		["history", { subjectId: null, query: null, format: null }],
		["search", { subjectId: null, query: " Retention Ω ", format: null }],
		["export", { subjectId: null, query: null, format: "json" }],
	];
	for (const [surface, options] of cases) {
		const { expected, value } = selected(view, surface, options);
		assert.equal(value.kind, "operate-experience-audit-display-surface");
		assert.equal(value.schemaVersion, "1.0.0");
		assert.equal(value.protocolVersion, "2.0.0");
		assert.deepEqual(value.requestBinding, expected);
		assert.equal(value.payload.surface, surface);
		assert.equal(value.payload.viewHash, view.viewHash);
		assert.equal(value.integrity.algorithm, "sha-256-jcs");
		assert.equal(
			value.integrity.domain,
			"openplanr:operate-experience-audit-display-surface:1.0.0",
		);
		assert.equal(value.integrity.sourceViewHash, view.viewHash);
		assert.match(value.integrity.contentHash, /^sha256:[a-f0-9]{64}$/u);
		assert.equal(
			assertOperateExperienceAuditDisplaySurfaceV1(value, expected),
			value,
		);
		assert.deepEqual(
			issueOperateExperienceAuditDisplaySurfaceV1(value.payload, expected),
			value,
		);
	}

	const evidenceDetail = selected(view, "evidence", {
		subjectId: "evidence-available",
		query: null,
		format: null,
	});
	assert.equal(
		assertOperateExperienceAuditDisplaySurfaceV1(
			evidenceDetail.value,
			evidenceDetail.expected,
		),
		evidenceDetail.value,
	);
});

test("restricted affirmative Outcomes preserve honest state without reopening hidden proof", () => {
	const view = auditView({ outcomes: [restrictedAffirmativeOutcome()] });
	for (const [surface, options] of [
		["outcomes", {}],
		["outcome", { subjectId: "outcome-1" }],
	]) {
		const { expected, value } = selected(view, surface, options);
		assert.equal(
			assertOperateExperienceAuditDisplaySurfaceV1(value, expected),
			value,
		);
		const projected =
			surface === "outcome"
				? value.payload.data.outcome
				: value.payload.data.outcomes[0];
		assert.equal(projected.status, "succeeded");
		assert.equal(projected.accessReason, "access-denied");
		assert.equal(projected.metric.observed, null);
		assert.deepEqual(projected.observationIds, []);
		assert.deepEqual(projected.evidenceRefIds, []);
	}

	const widened = restrictedAffirmativeOutcome();
	widened.metric.baseline = 72;
	const hostile = auditView({ outcomes: [widened] });
	assertRefused(selected(hostile, "outcomes").value);
});

test("restricted insufficient-evidence Outcomes close verification and metric custody", () => {
	const closed = restrictedInsufficientOutcome();
	const view = auditView({ outcomes: [closed] });
	const selectedOutcome = selected(view, "outcome", {
		subjectId: closed.outcomeId,
	});
	assert.equal(
		assertOperateExperienceAuditDisplaySurfaceV1(
			selectedOutcome.value,
			selectedOutcome.expected,
		),
		selectedOutcome.value,
	);
	assert.equal(selectedOutcome.value.payload.data.outcome.metric.target, null);
	assert.equal(
		selectedOutcome.value.payload.data.outcome.verification.method,
		null,
	);
	assert.equal(
		selectedOutcome.value.payload.data.outcome.nextObservation,
		null,
	);

	const widened = restrictedInsufficientOutcome();
	widened.metric.target = 85;
	widened.verification.method = "private verification method";
	widened.nextObservation = {
		kind: "future-observation",
		reason: "private next observation",
		dueAt: null,
	};
	const hostile = auditView({ outcomes: [widened] });
	assertRefused(selected(hostile, "outcomes").value);

	const reissued = structuredClone(selectedOutcome.value.payload);
	reissued.data.outcome.metric.target = 85;
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			reissued,
			selectedOutcome.expected,
		),
	);
});

test("public issuer refuses re-committed privacy, truth, and route lookalikes", () => {
	const view = auditView();
	const evidence = selected(view, "evidence");
	const outcomes = selected(view, "outcomes");
	const history = selected(view, "history");
	const exported = selected(view, "export", { format: "json" });

	const restoredPrivateClaim = structuredClone(evidence.value.payload);
	restoredPrivateClaim.data.claims[1].statement = PRIVATE_CLAIM;
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			restoredPrivateClaim,
			evidence.expected,
		),
	);

	const swappedEvidenceLink = structuredClone(evidence.value.payload);
	swappedEvidenceLink.data.evidence[0].deepLink =
		"#/operate/evidence/claim-retention";
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			swappedEvidenceLink,
			evidence.expected,
		),
	);

	const falseSuccess = structuredClone(outcomes.value.payload);
	falseSuccess.data.outcomes[0].status = "succeeded";
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			falseSuccess,
			outcomes.expected,
		),
	);

	const foreignHistoryLink = structuredClone(history.value.payload);
	foreignHistoryLink.data.history[0].deepLinks = [
		"#/operate/outcomes/outcome-foreign",
	];
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			foreignHistoryLink,
			history.expected,
		),
	);

	const privateExport = structuredClone(exported.value.payload);
	const privateExportValue = JSON.parse(privateExport.data.content);
	privateExportValue.actorId = "private-reissued-export-actor";
	privateExport.data.content = JSON.stringify(privateExportValue);
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			privateExport,
			exported.expected,
		),
	);

	const reorderedExport = structuredClone(exported.value.payload);
	const reorderedExportValue = Object.fromEntries(
		Object.entries(JSON.parse(reorderedExport.data.content)).reverse(),
	);
	reorderedExport.data.content = JSON.stringify(reorderedExportValue);
	assert.throws(() =>
		issueOperateExperienceAuditDisplaySurfaceV1(
			reorderedExport,
			exported.expected,
		),
	);
});

test("audit JCS commitment rejects domain, digest, surface, order, and hostile JSON substitutions", () => {
	const view = auditView();
	const evidence = selected(view, "evidence");
	const outcomes = selected(view, "outcomes");
	const mutations = [
		(candidate) => {
			candidate.kind = "operate-experience-display-surface";
		},
		(candidate) => {
			candidate.schemaVersion = "1.0.1";
		},
		(candidate) => {
			candidate.protocolVersion = "1.1.0";
		},
		(candidate) => {
			candidate.integrity.algorithm = "sha-512";
		},
		(candidate) => {
			candidate.integrity.domain = "openplanr:foreign-domain:1.0.0";
		},
		(candidate) => {
			candidate.integrity.sourceViewHash = HASH_C;
		},
		(candidate) => {
			candidate.integrity.contentHash = HASH_C;
		},
		(candidate) => {
			candidate.integrity.contentHash = sha256Jcs(
				withoutContentHash(candidate),
			);
		},
		(candidate) => {
			candidate.integrity.contentHash = outcomes.value.integrity.contentHash;
		},
		(candidate) => candidate.payload.data.evidence.reverse(),
		(candidate) => {
			candidate.payload.data.evidence[0].confidence = 0.81;
		},
		(candidate) => {
			candidate.payload.data.evidence[0].gaps.push("same-schema-tamper");
		},
		(candidate) => {
			candidate.payload.data.claims[0].statement = "same-schema claim tamper";
		},
		(candidate) => {
			candidate.payload.data.rationale[0].summary =
				"same-schema rationale tamper";
		},
		(candidate) => {
			candidate.privateBody = "private-envelope-member-must-not-echo";
		},
	];
	for (const mutate of mutations) {
		const candidate = structuredClone(evidence.value);
		mutate(candidate);
		assert.equal(
			validateOperateExperienceAuditDisplaySurfaceV1(
				candidate,
				evidence.expected,
			).length,
			1,
		);
		assert.throws(
			() =>
				assertOperateExperienceAuditDisplaySurfaceV1(
					candidate,
					evidence.expected,
				),
			(error) =>
				error.code === "E_OPERATE_EXPERIENCE_AUDIT_DISPLAY_INVALID" &&
				!String(error.message).includes(
					"private-envelope-member-must-not-echo",
				),
		);
	}

	const reordered = reverseTopLevelKeys(evidence.value);
	assert.equal(
		assertOperateExperienceAuditDisplaySurfaceV1(reordered, evidence.expected)
			.integrity.contentHash,
		evidence.value.integrity.contentHash,
		"JCS intentionally ignores member insertion order",
	);
});

test("audit verification refuses non-data graphs, accessors, proxies, and non-finite values without echo", () => {
	const { value, expected } = selected(auditView(), "outcomes");
	const hostile = [];

	const sparse = structuredClone(value);
	delete sparse.payload.data.outcomes[0];
	hostile.push(sparse);

	const cyclic = structuredClone(value);
	cyclic.payload.data.self = cyclic.payload.data;
	hostile.push(cyclic);

	const nonPlain = structuredClone(value);
	Object.setPrototypeOf(nonPlain.payload.data, {
		privatePrototype: "must-not-echo",
	});
	hostile.push(nonPlain);

	for (const number of [
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]) {
		const candidate = structuredClone(value);
		candidate.payload.data.domainMetrics[0].value = number;
		hostile.push(candidate);
	}

	const undefinedValue = structuredClone(value);
	undefinedValue.payload.data.outcomes[0].metric.observed = undefined;
	hostile.push(undefinedValue);

	const unpairedSurrogate = structuredClone(value);
	unpairedSurrogate.payload.data.learnings[0].statement = "\ud800";
	hostile.push(unpairedSurrogate);

	for (const candidate of hostile) {
		assert.throws(
			() => assertOperateExperienceAuditDisplaySurfaceV1(candidate, expected),
			(error) => !String(error.message).includes("privatePrototype"),
		);
	}

	let reads = 0;
	const accessor = structuredClone(value);
	Object.defineProperty(accessor.payload, "privateBody", {
		enumerable: true,
		get() {
			reads += 1;
			return "private-accessor-value-must-not-echo";
		},
	});
	assert.throws(
		() => assertOperateExperienceAuditDisplaySurfaceV1(accessor, expected),
		(error) =>
			!String(error.message).includes("private-accessor-value-must-not-echo"),
	);
	assert.equal(reads, 0);
	assert.throws(() =>
		assertOperateExperienceAuditDisplaySurfaceV1(
			new Proxy(structuredClone(value), {}),
			expected,
		),
	);
});

test("audit assertion independently requires every exact current selection binding field", () => {
	const view = auditView();
	const matrices = [
		selected(view, "outcome", { subjectId: "outcome-1" }),
		selected(view, "search", { query: " Retention Ω " }),
		selected(view, "export", { format: "html" }),
	];
	const foreign = {
		actorId: "actor-foreign",
		scopeId: "scope-foreign",
		domainId: "software",
		domainVersion: "9.9.9",
		cycleId: "cycle-foreign",
		subjectId: "outcome-foreign",
		surface: "history",
		query: "retention ω",
		format: "json",
		generatedAt: "2026-08-11T08:00:01Z",
		eventHead: { sequence: 2, hash: HASH_B },
		viewHash: HASH_C,
	};
	for (const { value, expected } of matrices) {
		for (const field of Object.keys(expected)) {
			const substituted = {
				...expected,
				[field]: field === "eventHead" ? foreign.eventHead : foreign[field],
			};
			assert.throws(
				() => assertOperateExperienceAuditDisplaySurfaceV1(value, substituted),
				field,
			);
			const missing = { ...expected };
			delete missing[field];
			assert.throws(
				() => assertOperateExperienceAuditDisplaySurfaceV1(value, missing),
				`missing ${field}`,
			);
		}
	}

	const search = selected(view, "search", { query: " Retention Ω " });
	for (const alias of ["Retention Ω", " retention ω ", "  Retention Ω  "]) {
		assert.throws(() =>
			assertOperateExperienceAuditDisplaySurfaceV1(search.value, {
				...search.expected,
				query: alias,
			}),
		);
	}
	const exported = selected(view, "export", { format: "html" });
	assert.throws(() =>
		assertOperateExperienceAuditDisplaySurfaceV1(exported.value, {
			...exported.expected,
			format: "json",
		}),
	);
});

test("audit commitment rejects same-schema leaf changes for every selected surface", () => {
	const view = auditView();
	const cases = [
		[
			selected(view, "evidence"),
			(candidate) => {
				candidate.payload.data.evidence[0].classification = "internal";
			},
		],
		[
			selected(view, "outcomes"),
			(candidate) => {
				candidate.payload.data.domainMetrics[0].target = 86;
			},
		],
		[
			selected(view, "outcome", { subjectId: "outcome-1" }),
			(candidate) => {
				candidate.payload.data.outcome.verification.metricHash = HASH_C;
			},
		],
		[
			selected(view, "history"),
			(candidate) => {
				candidate.payload.data.history[0].why = "A substituted reason.";
			},
		],
		[
			selected(view, "search", { query: "retention" }),
			(candidate) => {
				candidate.payload.data.results[0].title = "Substituted search title";
			},
		],
		[
			selected(view, "export", { format: "json" }),
			(candidate) => {
				candidate.payload.data.content += " ";
			},
		],
	];
	for (const [{ value, expected }, mutate] of cases) {
		const candidate = structuredClone(value);
		mutate(candidate);
		assert.throws(() =>
			assertOperateExperienceAuditDisplaySurfaceV1(candidate, expected),
		);
	}
});

test("audit owner rejects rehashed access, Outcome, Learning, and replay lookalikes before issuance", () => {
	const cases = [
		{
			surface: "evidence",
			marker: PRIVATE_CLAIM,
			mutate(view) {
				view.claims[1].statement = PRIVATE_CLAIM;
			},
		},
		{
			surface: "outcomes",
			mutate(view) {
				view.outcomes[0].metric.observed = 92;
			},
		},
		{
			surface: "outcomes",
			mutate(view) {
				view.outcomes[0].verification.metricHash = HASH_C;
			},
		},
		{
			surface: "outcomes",
			mutate(view) {
				view.learnings[0].outcomeId = "outcome-foreign";
			},
		},
		{
			surface: "history",
			mutate(view) {
				view.replay.parityProof.finalEventHashMatches = false;
			},
		},
	];
	for (const { surface, marker = null, mutate } of cases) {
		const view = auditView();
		mutate(view);
		rehashView(view);
		assertRefused(selected(view, surface).value, marker);
	}
});

test("audit owner preserves row order and omits every unsupported or unowned navigation target", () => {
	const view = auditView();
	const evidence = selected(view, "evidence").value.payload.data;
	assert.deepEqual(
		evidence.evidence.map(({ evidenceRefId }) => evidenceRefId),
		["evidence-available", "evidence-restricted"],
	);
	assert.equal(
		evidence.evidence[0].deepLink,
		"#/operate/evidence/evidence-available",
	);
	assert.equal(
		evidence.evidence[0].causalLinks[0].deepLink,
		"#/operate/outcomes/outcome-1",
	);
	assert.equal(evidence.evidence[0].causalLinks[1].deepLink, null);
	assert.equal(evidence.evidence[1].deepLink, null);
	assert.equal(
		evidence.claims[0].deepLink,
		"#/operate/evidence/claim-retention",
	);
	assert.equal(evidence.claims[0].causalLinks[0].deepLink, null);

	const outcomes = selected(view, "outcomes").value.payload.data;
	assert.equal(outcomes.domainMetrics[0].dueVerification[0].deepLink, null);
	assert.equal(outcomes.outcomes[0].deepLink, "#/operate/outcomes/outcome-1");
	assert.equal(outcomes.outcomes[0].decision.deepLink, null);
	assert.equal(outcomes.outcomes[0].execution[0].deepLink, null);
	assert.deepEqual(
		outcomes.learnings.map(({ learningId }) => learningId),
		["learning-1"],
	);

	const history = selected(view, "history").value.payload.data.history[0];
	assert.deepEqual(history.deepLinks, ["#/operate/outcomes/outcome-1"]);

	for (const query of ["act_00000001", "learning-1", "retention"]) {
		const search = selected(view, "search", { query }).value.payload.data
			.results;
		for (const result of search) {
			if (result.kind === "action") assert.equal("deepLink" in result, false);
			if (result.kind === "learning") {
				assert.equal("deepLink" in result, false);
			}
		}
	}

	const encoded = auditView();
	encoded.evidence[0].deepLink = "#/operate/evidence/evidence%2Favailable";
	rehashView(encoded);
	assert.equal(
		selected(encoded, "evidence").value.payload.data.evidence[0].deepLink,
		null,
	);
});

test("audit search preserves callable action deep links", () => {
	const view = auditView({
		actions: [
			{
				...action(),
				deepLink: "#/operate/actions/act_00000001",
			},
		],
	});
	const { value } = selected(view, "search", { query: "Measure retention" });
	assert.notEqual(value.ok, false, JSON.stringify(value));
	const results = value.payload.data.results;
	const hit = results.find((entry) => entry.kind === "action");
	assert.equal(hit?.deepLink, "#/operate/actions/act_00000001");
});

test("audit search and Export preserve exact safe text while excluding restricted indexes and locators", () => {
	const view = auditView({ inbox: [privateInboxItem()] });
	for (const query of [PRIVATE_ERROR_LOCATOR, "claim-restricted", HASH_A]) {
		assert.deepEqual(
			selected(view, "search", { query }).value.payload.data.results,
			[],
			query,
		);
	}
	const publicSearch = selected(view, "search", { query: "<script>" }).value
		.payload.data;
	assert.equal(publicSearch.query, "<script>");
	assert.equal(publicSearch.results[0].title.includes("<script>"), true);

	const jsonExport = selected(view, "export", { format: "json" }).value.payload
		.data;
	assert.equal(jsonExport.format, "json");
	assert.equal(jsonExport.mediaType, "application/json");
	const parsed = JSON.parse(jsonExport.content);
	assert.equal(JSON.stringify(parsed).includes(PRIVATE_ERROR_LOCATOR), false);
	assert.equal(JSON.stringify(parsed).includes(PRIVATE_CLAIM), false);
	assert.equal(
		JSON.stringify(parsed).includes(
			"private-owner-actor-must-not-cross-export",
		),
		false,
	);
	assert.equal(
		JSON.stringify(parsed).includes("private-party-must-not-cross-export"),
		false,
	);
	assert.equal(JSON.stringify(parsed).includes("requiredCapability"), false);
	assert.equal(JSON.stringify(parsed).includes("#/operate/actions/"), false);
	assert.equal(
		JSON.stringify(parsed).includes("#/operate/history/operation-1"),
		false,
	);

	const first = selected(view, "export", { format: "html" }).value;
	const second = selected(structuredClone(view), "export", {
		format: "html",
	}).value;
	assert.deepEqual(
		second,
		first,
		"same replayed state produces exact Export bytes",
	);
	const html = first.payload.data.content;
	assert.equal(first.payload.data.mediaType, "text/html; charset=utf-8");
	assert.equal(html.includes("<script>alert('public-text')</script>"), false);
	assert.equal(
		html.includes("&lt;script&gt;alert('public-text')&lt;/script&gt;"),
		true,
	);
	assert.equal(html.includes(PRIVATE_ERROR_LOCATOR), false);
	assert.equal(
		html.includes("private-owner-actor-must-not-cross-export"),
		false,
	);
	assert.equal(html.includes("private-party-must-not-cross-export"), false);
	assert.equal(html.includes("requiredCapability"), false);
	assert.equal(html.includes("#/operate/actions/"), false);
	assert.equal(html.includes("#/operate/history/operation-1"), false);
});

test("audit restart bytes are deterministic and stale or late foreign envelopes fail expected custody", () => {
	const view = auditView();
	for (const [surface, options] of [
		["evidence", {}],
		["outcomes", {}],
		["outcome", { subjectId: "outcome-1" }],
		["history", {}],
		["search", { query: "retention" }],
		["export", { format: "json" }],
	]) {
		assert.deepEqual(
			selected(structuredClone(view), surface, options).value,
			selected(view, surface, options).value,
		);
	}

	const early = selected(view, "history");
	const laterView = auditView({
		generatedAt: "2026-08-11T08:00:01Z",
		eventHead: { sequence: 2, hash: HASH_B },
		history: [
			{
				...historyEvent(),
				eventId: "event-2",
				sequence: 2,
				eventHash: HASH_B,
				timestamp: "2026-08-11T08:00:01Z",
			},
		],
		replay: {
			...structuredClone(view.replay),
			tail: {
				...structuredClone(view.replay.tail),
				endSequence: 2,
				eventCount: 2,
			},
			finalHead: { sequence: 2, hash: HASH_B },
		},
	});
	const later = selected(laterView, "history");
	assert.throws(() =>
		assertOperateExperienceAuditDisplaySurfaceV1(early.value, later.expected),
	);
	assert.throws(() =>
		assertOperateExperienceAuditDisplaySurfaceV1(later.value, early.expected),
	);
});
