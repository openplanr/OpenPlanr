import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { get } from "node:http";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveWorkspaceDependencyRoot } from "../helpers/workspace-dependency.mjs";

import * as operateExperienceReader from "../../lib/dashboard/operate-experience-reader.mjs";
import * as operateReviewDisplayContract from "../../lib/dashboard/operate-review-display-workspace-contract.mjs";
import * as operateReviewProjection from "../../lib/dashboard/operate-review-workspace-projection-v2.mjs";
import { createDashboardServer } from "../../lib/dashboard/server.mjs";
import {
	assertOperateCycleDisplayWorkspaceV1,
	validateOperateCycleDisplayWorkspaceV1,
} from "../../schemas/v1.2.0/operate-cycle-display-workspace.mjs";
import {
	validateOperateExperienceArtifactV2,
	validateProtocolArtifact,
} from "../../lib/protocol/contracts.mjs";
import { sha256Jcs } from "../../lib/protocol/jcs.mjs";
import { pairedOpenPlanrTools } from "../helpers/paired-openplanr.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const { typescript } = pairedOpenPlanrTools();
const {
	selectOperateCycleDisplayWorkspace,
	selectOperateCycleWorkspace,
	selectOperateExecutiveBoardDisplay,
} = operateExperienceReader;
const EXPECTED_READER_EXPORTS = [
	"OPERATE_EXPERIENCE_MAX_BYTES",
	"OPERATE_EXPERIENCE_RELATIVE_PATH",
	"assertOperateExperienceTransportView",
	"buildOperateExperienceTransportView",
	"decodeOperateExperienceCheckpoint",
	"encodeOperateExperienceCheckpoint",
	"readOperateExperienceProjection",
	"resolveOperateExperienceSearchDestination",
	"selectOperateActionDisplayWorkspace",
	"selectOperateActionWorkspace",
	"selectOperateCycleDisplayWorkspace",
	"selectOperateCycleWorkspace",
	"selectOperateExecutiveBoardDisplay",
	"selectOperateExperienceAuditDisplaySurface",
	"selectOperateExperienceDisplaySurface",
	"selectOperateExperienceSurface",
	"selectOperateInboxItemDisplaySurface",
	"selectOperateRecoveryDisplay",
	"selectOperateReviewDisplayWorkspace",
	"selectOperateReviewWorkspace",
].sort();
const EXPECTED_REVIEW_CONTRACT_EXPORTS = [
	"OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN",
	"OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA_V1",
	"assertOperateReviewDisplayWorkspaceV1",
	"issueOperateReviewDisplayWorkspaceV1",
	"validateOperateReviewDisplayWorkspaceV1",
].sort();
const EXPECTED_REVIEW_PROJECTION_EXPORTS = [
	"assertOperateReviewWorkspacePayloadSafeV1",
	"buildOperateReviewWorkspacePayloadV1",
	"deriveOperateSharedTruthSummaryV1",
].sort();
const all = JSON.parse(
	readFileSync(
		join(
			root,
			"conformance/fixtures/operating-runtime-v2/all-contracts-valid.json",
		),
		"utf8",
	),
);
const experienceFixture = JSON.parse(
	readFileSync(
		join(
			root,
			"conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json",
		),
		"utf8",
	),
)["operate-experience-view"];

function dashboardStaticRoot(parent) {
	const staticRoot = join(parent, "dashboard");
	mkdirSync(staticRoot, { recursive: true });
	writeFileSync(join(staticRoot, "index.html"), '<main id="root"></main>\n');
	writeFileSync(
		join(staticRoot, "dashboard-manifest.json"),
		JSON.stringify({
			kind: "openplanr-dashboard-build",
			schemaVersion: "1.0.0",
			buildId: "dashboard-cycle-contract-test",
			entry: "index.html",
			assets: [],
		}),
	);
	return staticRoot;
}

function request(port, path, headers = {}) {
	return new Promise((resolvePromise, reject) => {
		const req = get({ host: "127.0.0.1", port, path, headers }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				body += chunk;
			});
			res.on("end", () =>
				resolvePromise({ status: res.statusCode, headers: res.headers, body }),
			);
		});
		req.on("error", reject);
		req.setTimeout(4_000, () => req.destroy(new Error("request timed out")));
	});
}

const stages = () =>
	["observe", "understand", "decide", "govern", "act", "verify", "learn"].map(
		(id, index) => ({
			id,
			state: "complete",
			reason: null,
			inputArtifactIds: index === 0 ? ["art_00000001"] : [],
			outputArtifactIds: index === 2 ? ["art_00000002"] : [],
			gates:
				index === 2
					? [{ kind: "review", subjectId: "rev_00000001", state: "approved" }]
					: index === 5
						? [
								{
									kind: "verification",
									subjectId: "out_00000001",
									state: "insufficient-evidence",
								},
							]
						: [],
			evidenceGapIds: index === 5 ? ["gap_verification"] : [],
			uncertaintyIds: index === 5 ? ["unc_verification"] : [],
			persistentActionIds: index >= 4 ? ["act_00000001"] : [],
		}),
	);

export function cycleWorkspace(domainId = "business") {
	const cycleId = "cyc_00000001";
	const generatedAt = "2026-08-11T08:00:00Z";
	const scopeId = `scope-${domainId}`;
	const cycle = {
		cycleId,
		state: "closed",
		health: "normal",
		focus: [`${domainId} retention`],
		createdAt: "2026-08-08T08:00:00Z",
		updatedAt: "2026-08-11T08:00:00Z",
		stages: stages(),
		assignments: [
			{
				assignmentId: "asg_00000001",
				title: "Inspect accepted evidence",
				role: "advisor",
				ownerLabel: "current-actor",
				state: "validated",
				absence: null,
				dueAt: null,
				next: null,
				deepLink: `#/operate/cycles/${cycleId}`,
				dependencies: [],
				blockers: [],
				inputArtifactIds: ["art_00000001"],
				outputArtifactIds: ["art_00000002"],
			},
		],
		lensAbsences: [],
		executiveBoard: null,
		dependencies: [
			{
				subjectKind: "action",
				subjectId: "act_00000001",
				dependsOn: [
					{ actionId: "act_dependency", state: "completed", resolved: true },
				],
			},
		],
		blockers: [
			{
				subjectKind: "action",
				subjectId: "act_00000001",
				blockingSubjectIds: ["gap_verification"],
			},
		],
		persistentActionIds: ["act_00000001"],
		replayCheckpoint: null,
		deepLink: `#/operate/cycles/${cycleId}`,
	};
	const outcome = {
		outcomeId: "out_00000001",
		actionId: "act_00000001",
		verificationPlanId: "vfy_00000001",
		status: "insufficient-evidence",
		metric: null,
		observationIds: [],
		evidenceRefIds: [],
		observedAt: generatedAt,
		decision: null,
		execution: [],
		rollback: [],
		verification: null,
		nextObservation: {
			kind: "future-observation",
			reason: "Another accepted observation is required.",
			dueAt: null,
		},
		revisit: null,
		snapshot: null,
		delta: null,
		accessReason: null,
		deepLink: "#/operate/outcomes/out_00000001",
	};
	const learning = {
		learningId: "lrn_00000001",
		outcomeId: "out_00000001",
		statement: "More observation is needed.",
		decisionIds: ["dec_00000001"],
		evidenceRefIds: [],
		createdAt: generatedAt,
	};
	const base = {
		...structuredClone(experienceFixture),
		scopeId,
		domainId,
		generatedAt,
		cycles: [cycle],
		outcomes: [outcome],
		learnings: [learning],
		replay: {
			...structuredClone(experienceFixture.replay),
			checkpoint: null,
			finalHead: structuredClone(experienceFixture.eventHead),
			parityProof: {
				...structuredClone(experienceFixture.replay.parityProof),
				sourceStateHash: experienceFixture.sourceStateHash,
				finalEventHashMatches: true,
			},
		},
	};
	delete base.viewHash;
	const view = { ...base, viewHash: sha256Jcs(base) };

	const ownerCycle = {
		...structuredClone(all["operating-cycle"]),
		cycleId,
		scopeId,
		domainId,
		state: "closed",
		focus: [`${domainId} retention`],
		activeReviewId: null,
		updatedAt: generatedAt,
		closedAt: generatedAt,
	};
	const finding = {
		...structuredClone(all["operating-finding"]),
		scopeId,
		domainId,
		sourceCycleId: cycleId,
	};
	const decision = {
		...structuredClone(all["operating-decision"]),
		scopeId,
		domainId,
		sourceCycleId: cycleId,
		state: "approved",
		outcome: "Observe the declared metric before changing allocation.",
	};
	const action = {
		...structuredClone(all["operating-action"]),
		scopeId,
		domainId,
		sourceCycleId: cycleId,
		state: "approved",
	};
	const cycleLinks = [
		{
			entityKind: "finding",
			entityId: finding.findingId,
			cycleId,
			relation: "source",
		},
		{
			entityKind: "decision",
			entityId: decision.decisionId,
			cycleId,
			relation: "source",
		},
		{
			entityKind: "action",
			entityId: action.actionId,
			cycleId,
			relation: "source",
		},
		{
			entityKind: "action",
			entityId: action.actionId,
			cycleId,
			relation: "touched",
		},
		{
			entityKind: "action",
			entityId: action.actionId,
			cycleId,
			relation: "carried-forward",
		},
	];
	const ledger = {
		kind: "operating-work-ledger",
		schemaVersion: "1.0.0",
		protocolVersion: "2.0.0",
		scopeId,
		domainId,
		domainVersion: "1.0.0",
		generatedAt,
		findings: [finding],
		decisions: [decision],
		actions: [action],
		cycleLinks,
	};
	const allowedActions = [
		{
			tool: "operate.cycle.get",
			arguments: { cycleId },
			label: "Inspect the current cycle",
			effect: "read-only",
		},
	];
	const cycleRead = {
		ok: true,
		operation: "operate.cycle.get",
		data: {
			cycle: ownerCycle,
			progress: {
				total: 1,
				pending: 0,
				available: 0,
				active: 0,
				submitted: 0,
				validated: 1,
				rejected: 0,
				terminal: 1,
			},
			availableAssignments: [],
			acceptedArtifactIds: ["art_00000002"],
			persistentWork: { ledger, cycleLinks },
			actions: allowedActions,
		},
		allowedActions,
	};
	const binding = {
		actorId: view.actorId,
		scopeId,
		domainId,
		domainVersion: view.domainVersion,
		cycleId,
		subjectId: cycleId,
		generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
	};
	return { view, cycleRead, binding };
}

function rehashView(input) {
	delete input.view.viewHash;
	input.view.viewHash = sha256Jcs(input.view);
	input.binding = { ...input.binding, viewHash: input.view.viewHash };
	return input;
}

export function attachStructuredExecutiveBoardFinding(input) {
	const cycleId = input.binding.cycleId;
	const advisorArtifactId = "art_00000002";
	const challengerArtifactId = "art_00000003";
	input.view.cycles[0].executiveBoard = {
		cycleId,
		planId: "ipl_00000001",
		seats: [
			{
				roleId: "strategy-finance",
				label: "CEO",
				roleKind: "advisor",
				roleVersion: "1.0.0",
				assignmentId: "asg_00000001",
				assignmentState: "validated",
				artifact: {
					artifactId: advisorArtifactId,
					rawHash: `sha256:${"a".repeat(64)}`,
					canonicalHash: `sha256:${"b".repeat(64)}`,
				},
				absence: null,
			},
			{
				roleId: "challenge",
				label: "Challenger",
				roleKind: "challenger",
				roleVersion: "1.0.0",
				assignmentId: "asg_00000002",
				assignmentState: "validated",
				artifact: {
					artifactId: challengerArtifactId,
					rawHash: `sha256:${"c".repeat(64)}`,
					canonicalHash: `sha256:${"d".repeat(64)}`,
				},
				absence: null,
			},
		],
		challengerFindings: {
			artifact: {
				artifactId: challengerArtifactId,
				rawHash: `sha256:${"c".repeat(64)}`,
				canonicalHash: `sha256:${"d".repeat(64)}`,
			},
			findings: [
				{
					findingId: "fnd_00000001",
					sourceArtifactId: challengerArtifactId,
					sourceAssignmentId: "asg_00000002",
					sourceLocalFindingId: "finding:asg_00000002:1",
					findingType: "unsupported",
					severity: "high",
					confidence: 0.8,
					targets: [
						{
							advisorArtifactId,
							analysisIds: [],
							claimIds: ["claim:asg_00000001:1"],
							measurementIds: [],
							riskIds: [],
							recommendationIds: [],
						},
					],
					supportingEvidenceRefIds: [],
					contradictingEvidenceRefIds: [],
					title: "Evidence custody is incomplete",
					statement: "The recommendation exceeds the available observation window.",
					rationale: "The cited observation does not cover the full decision period.",
					correctionCondition: "Collect one complete bounded observation window.",
					state: "open",
					ownerActorId: null,
					revisitAt: null,
				},
			],
			dissent: [],
		},
		chairSynthesis: null,
	};
	return rehashView(input);
}

function affirmativeWorkspace(status = "succeeded", domainId = "business") {
	const input = cycleWorkspace(domainId);
	const metricHash = `sha256:${"a".repeat(64)}`;
	const planHash = `sha256:${"b".repeat(64)}`;
	const verify = input.view.cycles[0].stages[5];
	verify.state = "complete";
	verify.reason = null;
	verify.gates = [
		{
			kind: "verification",
			subjectId: "out_00000001",
			state: status,
		},
	];
	verify.evidenceGapIds = [];
	verify.uncertaintyIds = [];
	Object.assign(input.view.outcomes[0], {
		status,
		metric: {
			metricId: "met_00000001",
			metricHash,
			baseline: 0.5,
			target: 1,
			observed: 0.75,
			unit: "ratio",
			window: "current",
			dueAt: null,
			freshness: "current",
			confidence: 0.8,
		},
		observationIds: ["obs_00000001"],
		evidenceRefIds: ["evd_00000001"],
		verification: {
			verificationPlanId: "vfy_00000001",
			verificationPlanHash: planHash,
			metricId: "met_00000001",
			metricHash,
			method: "Compare the accepted observation.",
			evaluationRules: ["Record the observed value."],
			observationRequest: null,
			accessReason: null,
		},
		nextObservation: null,
	});
	return rehashView(input);
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("Cycle workspace preserves canonical spine, owner work-link order, proof, and closed learning", () => {
	const { view, cycleRead, binding } = cycleWorkspace();
	assert.deepEqual(
		validateOperateExperienceArtifactV2("operate-experience-view", view),
		[],
	);
	for (const [kind, value] of [
		["operating-cycle", cycleRead.data.cycle],
		["operating-work-ledger", cycleRead.data.persistentWork.ledger],
	]) {
		assert.deepEqual(
			validateProtocolArtifact(kind, value, { protocolVersion: "2.0.0" }),
			[],
			kind,
		);
	}
	assert.deepEqual(
		validateProtocolArtifact("operate-api-envelope", cycleRead, {
			protocolVersion: "2.0.0",
		}),
		[],
	);
	const selected = selectOperateCycleWorkspace(view, cycleRead, {
		binding,
		subjectId: binding.cycleId,
	});
	assert.equal(selected.ok, true);
	assert.deepEqual(selected.data.ownerCycle.focus, view.cycles[0].focus);
	assert.deepEqual(selected.data.progress, cycleRead.data.progress);
	assert.deepEqual(selected.data.replay, view.replay);
	assert.deepEqual(selected.data.allowedActions, cycleRead.allowedActions);
	assert.deepEqual(
		selected.data.cycle.stages.map(({ id }) => id),
		["observe", "understand", "decide", "govern", "act", "verify", "learn"],
	);
	assert.deepEqual(selected.data.cycle.assignments, view.cycles[0].assignments);
	assert.deepEqual(
		selected.data.cycle.dependencies,
		view.cycles[0].dependencies,
	);
	assert.deepEqual(selected.data.cycle.blockers, view.cycles[0].blockers);
	assert.deepEqual(
		selected.data.persistentWork.cycleLinks,
		cycleRead.data.persistentWork.cycleLinks,
	);
	assert.deepEqual(selected.data.persistentWork.actions[0].relations, [
		"source",
		"touched",
		"carried-forward",
	]);
	assert.equal(
		selected.data.persistentWork.outcomes[0].status,
		"insufficient-evidence",
	);
	assert.equal(
		selected.data.persistentWork.learnings[0].statement,
		"More observation is needed.",
	);
	assert.equal(selected.data.cycle.stages[5].state, "complete");
	assert.deepEqual(selected.data.verification, {
		status: "unverified",
		reasonCodes: ["OPERATE_VERIFICATION_EVIDENCE_MISSING"],
	});
	assert.equal(
		JSON.stringify(selected).includes("Revenue is below plan."),
		false,
	);
	assert.equal(
		JSON.stringify(selected).includes("Retention is the largest risk."),
		false,
	);
});

test("Cycle display workspace commits the sanitized owner DTO and rejects every post-owner substitution", () => {
	const input = cycleWorkspace();
	input.cycleRead.data.persistentWork.ledger.findings[0].statement =
		"private-finding-body-must-not-cross";
	input.cycleRead.data.persistentWork.ledger.decisions[0].rationale =
		"private-decision-body-must-not-cross";
	input.cycleRead.data.persistentWork.ledger.actions[0].expectedResult =
		"private-action-body-must-not-cross";
	const display = selectOperateCycleDisplayWorkspace(
		input.view,
		input.cycleRead,
		{
			binding: input.binding,
			subjectId: input.binding.cycleId,
		},
	);
	assert.equal(display.kind, "operate-cycle-display-workspace");
	assert.equal(display.payload.kind, "operate-cycle-workspace");
	assert.equal(display.integrity.sourceViewHash, input.view.viewHash);
	assert.match(display.integrity.contentHash, /^sha256:[a-f0-9]{64}$/u);
	assert.equal(assertOperateCycleDisplayWorkspaceV1(display, input.binding), display);
	assert.equal(JSON.stringify(display).includes("private-finding-body-must-not-cross"), false);
	assert.equal(JSON.stringify(display).includes("private-decision-body-must-not-cross"), false);
	assert.equal(JSON.stringify(display).includes("private-action-body-must-not-cross"), false);
	for (const collection of ["findings", "decisions", "actions"]) {
		for (const item of display.payload.data.persistentWork[collection]) {
			assert.deepEqual(Object.keys(item), ["kind", "subjectId", "state", "relations"]);
		}
	}

	const mutations = [
		(candidate) => candidate.payload.data.cycle.focus.push("/private/tamper"),
		(candidate) => {
			candidate.payload.data.ownerCycle.state = "failed";
		},
		(candidate) => {
			candidate.payload.data.cycle.stages[5].reason = "PRIVATE\nSTATE";
		},
		(candidate) => candidate.payload.data.cycle.stages.reverse(),
		(candidate) => candidate.payload.data.persistentWork.cycleLinks.reverse(),
		(candidate) => {
			candidate.payload.data.persistentWork.cycleLinks[0].cycleId = "cyc_00000002";
		},
		(candidate) => {
			candidate.payload.scopeId = "scope-foreign";
		},
		(candidate) => {
			candidate.integrity.sourceViewHash = `sha256:${"c".repeat(64)}`;
		},
		(candidate) => {
			candidate.integrity.contentHash = `sha256:${"d".repeat(64)}`;
		},
		(candidate) => {
			candidate.payload.data.persistentWork.findings[0].privateBody =
				"private-value-must-not-echo";
		},
	];
	for (const mutate of mutations) {
		const candidate = structuredClone(display);
		mutate(candidate);
		assert.equal(validateOperateCycleDisplayWorkspaceV1(candidate, input.binding).length, 1);
		assert.throws(
			() => assertOperateCycleDisplayWorkspaceV1(candidate, input.binding),
			(error) =>
				error.code === "E_OPERATE_CYCLE_DISPLAY_INVALID" &&
				!error.message.includes("private-value-must-not-echo"),
		);
	}
	assert.throws(() =>
		assertOperateCycleDisplayWorkspaceV1(display, {
			...input.binding,
			viewHash: `sha256:${"e".repeat(64)}`,
		}),
	);
});

test("Cycle HTTP detail composes the strict workspace from one exact owner read", async () => {
	const parent = mkdtempSync(join(tmpdir(), "operate-cycle-http-contract-"));
	const input = cycleWorkspace();
	let ownerRequest = null;
	const dashboard = createDashboardServer({
		staticRoot: dashboardStaticRoot(parent),
		planrDir: join(root, "conformance/fixtures/dashboard-graph/.planr"),
		watch: false,
		getOperatingExperience: () => ({
			available: true,
			readOnly: true,
			status: "ready",
			view: input.view,
			reasonCodes: [],
		}),
		getOperatingCycleRead: async (requestValue) => {
			ownerRequest = requestValue;
			return input.cycleRead;
		},
	});
	try {
		const port = await dashboard.listen(0, {
			env: { ...process.env, PLANR_HOME: join(parent, "home") },
		});
		const query = new URLSearchParams({
			scopeId: input.binding.scopeId,
			domainId: input.binding.domainId,
			domainVersion: input.binding.domainVersion,
		});
		const response = await request(
			port,
			`/api/operate/cycles/${input.binding.cycleId}?${query}`,
			{ "X-OpenPlanr-Actor": input.binding.actorId },
		);
		assert.equal(response.status, 200, response.body);
		assert.match(response.headers["cache-control"] ?? "", /no-store/u);
		assert.equal(Object.isFrozen(ownerRequest), true);
		assert.deepEqual(ownerRequest, {
			cycleId: input.binding.cycleId,
			actorId: input.binding.actorId,
			scopeId: input.binding.scopeId,
			domainId: input.binding.domainId,
			domainVersion: input.binding.domainVersion,
		});
		const display = JSON.parse(response.body);
		assert.equal(display.kind, "operate-cycle-display-workspace");
		assert.equal(assertOperateCycleDisplayWorkspaceV1(display, input.binding), display);
		assert.notEqual(display.kind, "operate-experience-display-surface");
	} finally {
		await dashboard.close();
		rmSync(parent, { recursive: true, force: true });
	}
});

test("Cycle HTTP detail fails closed when the exact owner read is absent, malformed, foreign, or throws", async () => {
	const input = cycleWorkspace();
	const privateMarker = "private-cycle-owner-read-must-not-echo";
	const cases = [
		{
			name: "absent",
			provider: null,
			reasonCode: "OPERATE_PROJECTION_UNAVAILABLE",
		},
		{
			name: "invalid",
			provider: async () => ({ privateMarker }),
			reasonCode: "OPERATE_PROJECTION_INVALID",
		},
		{
			name: "foreign",
			provider: async () => {
				const foreign = structuredClone(input.cycleRead);
				foreign.data.cycle.scopeId = privateMarker;
				return foreign;
			},
			reasonCode: "OPERATE_PROJECTION_STALE",
		},
		{
			name: "throwing",
			provider: async () => {
				throw new Error(privateMarker);
			},
			reasonCode: "OPERATE_PROJECTION_UNAVAILABLE",
		},
	];
	for (const testCase of cases) {
		const parent = mkdtempSync(join(tmpdir(), `operate-cycle-http-${testCase.name}-`));
		const dashboard = createDashboardServer({
			staticRoot: dashboardStaticRoot(parent),
			planrDir: join(root, "conformance/fixtures/dashboard-graph/.planr"),
			watch: false,
			getOperatingExperience: () => ({
				available: true,
				readOnly: true,
				status: "ready",
				view: input.view,
				reasonCodes: [],
			}),
			getOperatingCycleRead: testCase.provider,
		});
		try {
			const port = await dashboard.listen(0, {
				env: { ...process.env, PLANR_HOME: join(parent, "home") },
			});
			const query = new URLSearchParams({
				scopeId: input.binding.scopeId,
				domainId: input.binding.domainId,
				domainVersion: input.binding.domainVersion,
			});
			const response = await request(
				port,
				`/api/operate/cycles/${input.binding.cycleId}?${query}`,
				{ "X-OpenPlanr-Actor": input.binding.actorId },
			);
			assert.equal(response.status, 409, `${testCase.name}: ${response.body}`);
			assert.match(response.headers["cache-control"] ?? "", /no-store/u);
			assert.equal(response.body.includes(privateMarker), false);
			assert.equal(JSON.parse(response.body).error.reasonCode, testCase.reasonCode);
		} finally {
			await dashboard.close();
			rmSync(parent, { recursive: true, force: true });
		}
	}
});

test("Cycle and Executive Board display issuers preserve a structured durable Finding", () => {
	const input = attachStructuredExecutiveBoardFinding(cycleWorkspace());
	const selected = selectOperateCycleWorkspace(input.view, input.cycleRead, {
		binding: input.binding,
		subjectId: input.binding.cycleId,
	});
	assert.equal(selected.ok, true);
	assert.equal(
		selected.data.cycle.executiveBoard.challengerFindings.findings[0].findingId,
		"fnd_00000001",
	);

	const cycleDisplay = selectOperateCycleDisplayWorkspace(
		input.view,
		input.cycleRead,
		{ binding: input.binding, subjectId: input.binding.cycleId },
	);
	assert.equal(cycleDisplay.kind, "operate-cycle-display-workspace");
	assert.equal(
		cycleDisplay.payload.data.cycle.executiveBoard.challengerFindings.findings[0]
			.sourceLocalFindingId,
		"finding:asg_00000002:1",
	);

	const boardDisplay = selectOperateExecutiveBoardDisplay(input.view, {
		binding: input.binding,
		subjectId: input.binding.cycleId,
	});
	assert.equal(boardDisplay.kind, "operate-executive-board-display-surface");
	assert.deepEqual(
		boardDisplay.payload.data.executiveBoard.challengerFindings.findings[0].targets,
		input.view.cycles[0].executiveBoard.challengerFindings.findings[0].targets,
	);
});

test("Cycle display custody accepts owner-certified public path-shaped focus without lexical inference", () => {
	for (const focus of [
		"API/CLI and C#/.NET",
		"IPv6 https://[2001:db8::1]/status?next=/private-looking/example",
		"Document $HOME/guides, $(pwd)/examples, and %USERPROFILE%/OpenPlanr",
	]) {
		const input = cycleWorkspace();
		input.view.cycles[0].focus = [focus];
		input.cycleRead.data.cycle.focus = [focus];
		rehashView(input);
		const display = selectOperateCycleDisplayWorkspace(
			input.view,
			input.cycleRead,
			{ binding: input.binding, subjectId: input.binding.cycleId },
		);
		assert.equal(display.payload.data.cycle.focus[0], focus);
		assert.equal(assertOperateCycleDisplayWorkspaceV1(display, input.binding), display);
	}
});

test("Cycle workspace has one behavior shape for business and software domains", () => {
	for (const domainId of ["business", "software"]) {
		const { view, cycleRead, binding } = cycleWorkspace(domainId);
		const selected = selectOperateCycleWorkspace(view, cycleRead, {
			binding,
			subjectId: binding.cycleId,
		});
		assert.equal(selected.ok, true);
		assert.equal(selected.domainId, domainId);
		assert.deepEqual(
			selected.data.cycle.stages.map(({ id, state }) => ({ id, state })),
			stages().map(({ id, state }) => ({ id, state })),
		);
		assert.deepEqual(Object.keys(selected.data.persistentWork), [
			"findings",
			"decisions",
			"actions",
			"outcomes",
			"learnings",
			"cycleLinks",
		]);
	}
});

test("Cycle verification requires affirmative bound proof and keeps result success separate", () => {
	for (const domainId of ["business", "software"]) {
		for (const status of ["succeeded", "failed"]) {
			const input = affirmativeWorkspace(status, domainId);
			const selected = selectOperateCycleWorkspace(
				input.view,
				input.cycleRead,
				{
					binding: input.binding,
					subjectId: input.binding.cycleId,
				},
			);
			assert.equal(selected.ok, true, `${domainId}:${status}`);
			assert.deepEqual(selected.data.verification, {
				status: "verified",
				reasonCodes: [],
			});
			assert.equal(selected.data.persistentWork.outcomes[0].status, status);
		}
	}

	const evidenceOnly = affirmativeWorkspace("succeeded");
	evidenceOnly.view.outcomes[0].observationIds = [];
	rehashView(evidenceOnly);
	const evidenceOnlySelected = selectOperateCycleWorkspace(
		evidenceOnly.view,
		evidenceOnly.cycleRead,
		{
			binding: evidenceOnly.binding,
			subjectId: evidenceOnly.binding.cycleId,
		},
	);
	assert.equal(evidenceOnlySelected.ok, true);
	assert.deepEqual(evidenceOnlySelected.data.verification, {
		status: "unverified",
		reasonCodes: ["OPERATE_VERIFICATION_EVIDENCE_MISSING"],
	});

	const gateDriftCases = [
		(input) =>
			input.view.cycles[0].stages[5].gates.push({
				kind: "approval",
				subjectId: "apr_unresolved",
				state: "pending",
			}),
		(input) =>
			input.view.cycles[0].stages[5].gates.push({
				kind: "execution",
				subjectId: "op_unresolved",
				state: "pending",
			}),
		(input) =>
			input.view.cycles[0].stages[5].gates.unshift({
				kind: "review",
				subjectId: "rev_unresolved",
				state: "pending",
			}),
		(input) =>
			input.view.cycles[0].stages[5].gates.push({
				kind: "verification",
				subjectId: "out_00000001",
				state: "blocked",
			}),
		(input) =>
			input.view.cycles[0].stages[5].gates.push(
				structuredClone(input.view.cycles[0].stages[5].gates[0]),
			),
		(input) => {
			input.view.cycles[0].stages[5].gates[0].subjectId = "out_00000009";
		},
		(input) => {
			input.view.cycles[0].stages[5].gates[0].state = "failed";
		},
		(input) => {
			input.view.cycles[0].stages[5].gates = [];
		},
	];
	for (const [index, mutate] of gateDriftCases.entries()) {
		const input = affirmativeWorkspace("succeeded");
		mutate(input);
		rehashView(input);
		const selected = selectOperateCycleWorkspace(input.view, input.cycleRead, {
			binding: input.binding,
			subjectId: input.binding.cycleId,
		});
		assert.equal(selected.ok, true, `gate drift ${index}`);
		assert.deepEqual(selected.data.verification, {
			status: "unverified",
			reasonCodes: ["OPERATE_VERIFICATION_EVIDENCE_MISSING"],
		});
	}

	for (const status of [
		"blocked",
		"cancelled",
		"partial",
		"uncertain",
		"unknown",
	]) {
		const input = affirmativeWorkspace(status);
		const outcome = input.view.outcomes[0];
		outcome.observationIds = [];
		outcome.evidenceRefIds = [];
		outcome.metric = null;
		outcome.verification = null;
		rehashView(input);
		const selected = selectOperateCycleWorkspace(input.view, input.cycleRead, {
			binding: input.binding,
			subjectId: input.binding.cycleId,
		});
		assert.equal(selected.ok, true, status);
		assert.deepEqual(selected.data.verification, {
			status: "unverified",
			reasonCodes: ["OPERATE_VERIFICATION_EVIDENCE_MISSING"],
		});
	}

	const noAction = cycleWorkspace();
	noAction.cycleRead.data.persistentWork.ledger.actions = [];
	noAction.cycleRead.data.persistentWork.ledger.cycleLinks =
		noAction.cycleRead.data.persistentWork.ledger.cycleLinks.filter(
			(link) => link.entityKind !== "action",
		);
	noAction.cycleRead.data.persistentWork.cycleLinks = structuredClone(
		noAction.cycleRead.data.persistentWork.ledger.cycleLinks,
	);
	noAction.view.cycles[0].persistentActionIds = [];
	for (const stage of noAction.view.cycles[0].stages)
		stage.persistentActionIds = [];
	Object.assign(noAction.view.cycles[0].stages[5], {
		state: "waiting",
		gates: [],
		evidenceGapIds: [],
		uncertaintyIds: [],
	});
	noAction.view.outcomes = [];
	noAction.view.learnings = [];
	rehashView(noAction);
	const selected = selectOperateCycleWorkspace(
		noAction.view,
		noAction.cycleRead,
		{
			binding: noAction.binding,
			subjectId: noAction.binding.cycleId,
		},
	);
	assert.equal(selected.ok, true);
	assert.deepEqual(selected.data.verification, {
		status: "unverified",
		reasonCodes: ["OPERATE_VERIFICATION_EVIDENCE_MISSING"],
	});
});

test("Cycle workspace fails closed for stale time, foreign binding, replay, route, and link drift", () => {
	const original = cycleWorkspace();
	const cases = [
		{
			...original,
			binding: { ...original.binding, actorId: "foreign-actor" },
			reason: "OPERATE_BINDING_MISMATCH",
		},
		{
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				value.data.persistentWork.ledger.generatedAt = "2026-08-11T08:00:01Z";
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		{
			...original,
			view: structuredClone(original.view),
			mutateView(value) {
				value.replay.finalHead = { sequence: 0, hash: null };
			},
			reason: "OPERATE_PROJECTION_INVALID",
		},
		{
			...original,
			view: structuredClone(original.view),
			mutateView(value) {
				value.cycles[0].deepLink = "#/operate/cycles/cyc_foreign";
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		{
			...original,
			view: structuredClone(original.view),
			mutateView(value) {
				value.cycles[0].focus = ["foreign substituted focus"];
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		{
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				value.data.persistentWork.cycleLinks = [
					...value.data.persistentWork.cycleLinks,
				].reverse();
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		...["scopeId", "domainId", "domainVersion"].map((field) => ({
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				value.data.persistentWork.ledger.actions[0][field] = `foreign-${field}`;
			},
			reason: "OPERATE_PROJECTION_STALE",
		})),
		{
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				value.data.persistentWork.ledger.actions[0].sourceCycleId =
					"cyc_foreign_0001";
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		{
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				const retained = value.data.persistentWork.ledger.cycleLinks.filter(
					(link) =>
						!(link.entityKind === "finding" && link.relation === "source"),
				);
				value.data.persistentWork.ledger.cycleLinks = retained;
				value.data.persistentWork.cycleLinks = structuredClone(retained);
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		{
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				const duplicate = structuredClone(
					value.data.persistentWork.ledger.cycleLinks[0],
				);
				value.data.persistentWork.ledger.cycleLinks.push(duplicate);
				value.data.persistentWork.cycleLinks.push(structuredClone(duplicate));
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
		{
			...original,
			cycleRead: structuredClone(original.cycleRead),
			mutate(value) {
				value.data.persistentWork.ledger.cycleLinks[0].relation = "touched";
				value.data.persistentWork.cycleLinks[0].relation = "touched";
			},
			reason: "OPERATE_PROJECTION_STALE",
		},
	];
	for (const [caseIndex, entry] of cases.entries()) {
		entry.mutate?.(entry.cycleRead);
		entry.mutateView?.(entry.view);
		if (entry.mutateView) {
			delete entry.view.viewHash;
			entry.view.viewHash = sha256Jcs(entry.view);
			entry.binding = { ...entry.binding, viewHash: entry.view.viewHash };
		}
		const result = selectOperateCycleWorkspace(entry.view, entry.cycleRead, {
			binding: entry.binding,
			subjectId: entry.binding.cycleId,
		});
		assert.equal(result.ok, false, `negative case ${caseIndex}`);
		assert.equal(result.error.reasonCode, entry.reason);
	}
});

test("Cycle selector contains no local reducer, rank, sort, or dedupe authority", () => {
	const source = readFileSync(
		join(root, "lib/dashboard/operate-experience-reader.mjs"),
		"utf8",
	);
	const selector = source.slice(
		source.indexOf("export function selectOperateCycleWorkspace("),
		source.indexOf("export function encodeOperateExperienceCheckpoint("),
	);
	assert.doesNotMatch(selector, /\.sort\s*\(/u);
	assert.doesNotMatch(selector, /\b(?:dedupe|normalize|rank|reduce)\w*\s*\(/iu);
	assert.match(selector, /ledger\.cycleLinks\.filter/u);
	assert.match(selector, /view\.outcomes\s*\.filter/u);
});

test("packed installed Node 20 Cycle reader matches source bytes and behavior", {
	timeout: 120_000,
	skip: typescript ? false : "paired OpenPlanr TypeScript is required for declaration parity",
}, async () => {
	assert.ok(Number(process.versions.node.split(".")[0]) >= 20);
	assert.deepEqual(
		Object.keys(operateExperienceReader).sort(),
		EXPECTED_READER_EXPORTS,
	);
	assert.deepEqual(Object.keys(operateReviewDisplayContract).sort(), EXPECTED_REVIEW_CONTRACT_EXPORTS);
	assert.deepEqual(Object.keys(operateReviewProjection).sort(), EXPECTED_REVIEW_PROJECTION_EXPORTS);
	const temporaryRoot = mkdtempSync(join(tmpdir(), "planr-cycle-pack-"));
	try {
		const packed = spawnSync(
			"npm",
			[
				"pack",
				"--ignore-scripts",
				"--json",
				"--cache",
				join(temporaryRoot, "npm-cache"),
				"--pack-destination",
				temporaryRoot,
			],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(packed.status, 0, packed.stderr);
		const [{ filename }] = JSON.parse(packed.stdout);
		const installedRoot = join(
			temporaryRoot,
			"consumer",
			"node_modules",
			"planr-pipeline",
		);
		mkdirSync(installedRoot, { recursive: true });
		const extracted = spawnSync(
			"tar",
			[
				"-xzf",
				join(temporaryRoot, filename),
				"-C",
				installedRoot,
				"--strip-components=1",
			],
			{ encoding: "utf8" },
		);
		assert.equal(extracted.status, 0, extracted.stderr);
		cpSync(
			resolveWorkspaceDependencyRoot("@noble/hashes"),
			join(temporaryRoot, "consumer", "node_modules", "@noble", "hashes"),
			{ recursive: true },
		);
		const relativeReader = "lib/dashboard/operate-experience-reader.mjs";
		const relativeTypes = "lib/dashboard/operate-experience-reader.d.mts";
		const reviewFiles = [
			"lib/dashboard/operate-review-display-workspace-contract.mjs",
			"lib/dashboard/operate-review-display-workspace-contract.d.mts",
			"lib/dashboard/operate-review-workspace-projection-v2.mjs",
			"lib/dashboard/operate-review-workspace-projection-v2.d.mts",
		];
		assert.equal(
			sha256(join(installedRoot, relativeReader)),
			sha256(join(root, relativeReader)),
		);
		assert.equal(
			sha256(join(installedRoot, relativeTypes)),
			sha256(join(root, relativeTypes)),
		);
		for (const relativePath of reviewFiles) {
			assert.equal(sha256(join(installedRoot, relativePath)), sha256(join(root, relativePath)), relativePath);
		}
		const consumerRoot = join(temporaryRoot, "consumer");
		const publicImport = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				`Promise.all([import('planr-pipeline/dashboard/operate-experience-reader'), import('planr-pipeline/dashboard/operate-review-display-workspace-contract'), import('planr-pipeline/operate/review-workspace-projection-v2')]).then(([reader, contract, projection]) => { const expectedReader = ${JSON.stringify(EXPECTED_READER_EXPORTS)}; const expectedContract = ${JSON.stringify(EXPECTED_REVIEW_CONTRACT_EXPORTS)}; const expectedProjection = ${JSON.stringify(EXPECTED_REVIEW_PROJECTION_EXPORTS)}; if (JSON.stringify(Object.keys(reader).sort()) !== JSON.stringify(expectedReader)) process.exit(2); if (JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify(expectedContract)) process.exit(3); if (JSON.stringify(Object.keys(projection).sort()) !== JSON.stringify(expectedProjection)) process.exit(4); })`,
			],
			{ cwd: consumerRoot, encoding: "utf8" },
		);
		assert.equal(publicImport.status, 0, publicImport.stderr);
		writeFileSync(
			join(consumerRoot, "index.mts"),
			[
				"import * as reader from 'planr-pipeline/dashboard/operate-experience-reader';",
				"import * as reviewContract from 'planr-pipeline/dashboard/operate-review-display-workspace-contract';",
				"import * as reviewProjection from 'planr-pipeline/operate/review-workspace-projection-v2';",
				"import type { OperateReviewDisplayWorkspaceV1 } from 'planr-pipeline/dashboard/operate-review-display-workspace-contract';",
				"import type { OperateReviewWorkspacePayloadV1, OperateSharedTruthSummaryV1 } from 'planr-pipeline/operate/review-workspace-projection-v2';",
				`const expected = ${JSON.stringify(EXPECTED_READER_EXPORTS)} as const;`,
				"type Expected = (typeof expected)[number];",
				"type Actual = keyof typeof reader;",
				"const noMissing: Exclude<Expected, Actual> extends never ? true : never = true;",
				"const noExtra: Exclude<Actual, Expected> extends never ? true : never = true;",
				"const selected: unknown = reader.selectOperateCycleWorkspace({}, {}, {});",
				"const contractValidator: (value: unknown) => unknown = reviewContract.validateOperateReviewDisplayWorkspaceV1;",
				"declare const view: Parameters<typeof reviewProjection.deriveOperateSharedTruthSummaryV1>[0];",
				"const summary: OperateSharedTruthSummaryV1 = reviewProjection.deriveOperateSharedTruthSummaryV1(view);",
				"declare const payload: OperateReviewWorkspacePayloadV1;",
				"const display: OperateReviewDisplayWorkspaceV1 = reviewContract.issueOperateReviewDisplayWorkspaceV1(payload);",
				"void noMissing; void noExtra;",
				"void selected;",
				"void contractValidator; void summary; void display;",
				"",
			].join("\n"),
		);
		const typedImport = spawnSync(
			process.execPath,
			[
				typescript,
				"--noEmit",
				"--target",
				"ES2022",
				"--module",
				"Node16",
				"--moduleResolution",
				"Node16",
				join(consumerRoot, "index.mts"),
			],
			{ cwd: consumerRoot, encoding: "utf8" },
		);
		assert.equal(typedImport.status, 0, typedImport.stderr);
		const installed = await import(
			pathToFileURL(join(installedRoot, relativeReader)).href
		);
		assert.deepEqual(Object.keys(installed).sort(), EXPECTED_READER_EXPORTS);
		const installedReviewContract = await import(
			pathToFileURL(join(installedRoot, reviewFiles[0])).href
		);
		const installedReviewProjection = await import(
			pathToFileURL(join(installedRoot, reviewFiles[2])).href
		);
		assert.deepEqual(Object.keys(installedReviewContract).sort(), EXPECTED_REVIEW_CONTRACT_EXPORTS);
		assert.deepEqual(Object.keys(installedReviewProjection).sort(), EXPECTED_REVIEW_PROJECTION_EXPORTS);
		const installedFixture = JSON.parse(readFileSync(join(
			installedRoot,
			"conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json",
		)))["operate-review-display-workspace"];
		assert.deepEqual(installedReviewContract.validateOperateReviewDisplayWorkspaceV1(installedFixture), []);
		const input = cycleWorkspace();
		assert.deepEqual(
			installed.selectOperateCycleWorkspace(input.view, input.cycleRead, {
				binding: input.binding,
				subjectId: input.binding.cycleId,
			}),
			selectOperateCycleWorkspace(input.view, input.cycleRead, {
				binding: input.binding,
				subjectId: input.binding.cycleId,
			}),
		);
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
});
