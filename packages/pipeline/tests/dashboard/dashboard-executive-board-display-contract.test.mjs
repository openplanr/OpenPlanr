import assert from "node:assert/strict";
import test from "node:test";

import {
	assertOperateExecutiveBoardDisplaySurfaceV1,
	validateOperateExecutiveBoardDisplaySurfaceV1,
} from "../../schemas/v1.2.0/operate-executive-board-display-surface.mjs";
import {
	assertOperateExperienceTransportView,
	selectOperateExecutiveBoardDisplay,
	selectOperateExperienceDisplaySurface,
	selectOperateExperienceSurface,
} from "../../lib/dashboard/operate-experience-reader.mjs";
import { sha256Jcs } from "../../lib/protocol/jcs.mjs";
import { cycleWorkspace } from "./dashboard-cycle-parity.test.mjs";

function rehashView(input) {
	delete input.view.viewHash;
	input.view.viewHash = sha256Jcs(input.view);
	input.binding = { ...input.binding, viewHash: input.view.viewHash };
	return input;
}

function multilineText(length) {
	assert.ok(length >= 3);
	return `D\n${"D".repeat(length - 2)}`;
}

function executiveBoardFixture() {
	const input = cycleWorkspace("business");
	const cycleId = input.binding.cycleId;
	input.view.cycles[0].lensAbsences = [];
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
					artifactId: "art_00000002",
					rawHash: `sha256:${"e".repeat(64)}`,
					canonicalHash: `sha256:${"f".repeat(64)}`,
				},
				absence: null,
			},
			{
				roleId: "chair",
				label: "Chair",
				roleKind: "chair",
				roleVersion: "1.0.0",
				assignmentId: null,
				assignmentState: null,
				artifact: null,
				absence: { kind: "omitted", reason: "not-selected" },
			},
		],
		challengerFindings: null,
		chairSynthesis: null,
	};
	return rehashView(input);
}

function materializedExecutiveBoardFixture() {
	const input = executiveBoardFixture();
	const board = input.view.cycles[0].executiveBoard;
	Object.assign(board, {
		boardId: `xbr_${"a".repeat(32)}`,
		reviewId: "rev_00000001",
		projectionMode: "materialized",
		authoritativeForMutation: true,
		materializedEventId: "evt_board_materialized_00000001",
		sourceEventHead: structuredClone(input.view.eventHead),
		sourceBoardHash: `sha256:${"b".repeat(64)}`,
		semanticHash: `sha256:${"c".repeat(64)}`,
		traceMatrix: {
			kind: "operating-trace-matrix",
			schemaVersion: "1.0.0",
			protocolVersion: "2.0.0",
			matrixId: `trx_${"d".repeat(32)}`,
			scopeId: input.view.scopeId,
			domainId: input.view.domainId,
			domainVersion: input.view.domainVersion,
			cycleId: input.binding.cycleId,
			eventHead: structuredClone(input.view.eventHead),
			limits: { maxNodes: 8192, maxEdges: 32768, truncated: false },
			nodes: [],
			edges: [],
			omissions: [],
			proof: {
				terminalAssignments: 0,
				acceptedArtifacts: 0,
				verifiedEvidence: 0,
				staleEvidence: 0,
				supportedClaims: 0,
				contradictedClaims: 0,
				unverifiedClaims: 0,
				restrictedNodes: 0,
				typedAbsences: 0,
				verifiedActions: 0,
			},
			matrixHash: `sha256:${"e".repeat(64)}`,
		},
	});
	return rehashView(input);
}

test("Today and Cycles displays resolve materialized Board trace custody", () => {
	const input = materializedExecutiveBoardFixture();
	for (const surface of ["today", "cycles"]) {
		const display = selectOperateExperienceDisplaySurface(input.view, {
			surface,
			binding: {
				actorId: input.view.actorId,
				scopeId: input.view.scopeId,
				domainId: input.view.domainId,
				domainVersion: input.view.domainVersion,
				generatedAt: input.view.generatedAt,
				eventHead: input.view.eventHead,
				viewHash: input.view.viewHash,
				surface,
				subjectId: null,
			},
		});
		assert.equal(display.payload?.ok, true, JSON.stringify(display));
		assert.equal(display.kind, "operate-experience-display-surface", surface);
		assert.equal(display.payload.kind, "operate-experience-surface", surface);
	}
});

test("executive board display commits stable role identity and rejects title substitution", () => {
	const input = executiveBoardFixture();
	const display = selectOperateExecutiveBoardDisplay(input.view, {
		binding: input.binding,
		subjectId: input.binding.cycleId,
	});
	assert.equal(display.kind, "operate-executive-board-display-surface");
	assert.equal(display.payload.kind, "operate-executive-board");
	assert.equal(display.payload.data.executiveBoard.seats[0].roleId, "strategy-finance");
	assert.equal(display.payload.data.executiveBoard.seats[0].label, "CEO");
	assert.equal(assertOperateExecutiveBoardDisplaySurfaceV1(display, input.binding), display);

	const hostile = structuredClone(display);
	hostile.payload.data.executiveBoard.seats[0].label = "strategy-finance";
	assert.throws(() =>
		assertOperateExecutiveBoardDisplaySurfaceV1(hostile, input.binding),
	);
});

test("executive board display refuses foreign bindings and missing boards", () => {
	const input = executiveBoardFixture();
	const foreign = selectOperateExecutiveBoardDisplay(input.view, {
		binding: { ...input.binding, scopeId: "scope-foreign" },
		subjectId: input.binding.cycleId,
	});
	assert.equal(foreign.ok, false);
	assert.equal(foreign.error.reasonCode, "OPERATE_BINDING_MISMATCH");

	const software = cycleWorkspace("software");
	software.view.cycles[0].executiveBoard = executiveBoardFixture().view.cycles[0].executiveBoard;
	rehashView(software);
	const unavailable = selectOperateExecutiveBoardDisplay(software.view, {
		binding: software.binding,
		subjectId: software.binding.cycleId,
	});
	assert.equal(unavailable.ok, false);
	assert.equal(unavailable.error.reasonCode, "OPERATE_PROJECTION_UNAVAILABLE");

	const missing = executiveBoardFixture();
	delete missing.view.cycles[0].executiveBoard;
	rehashView(missing);
	const stale = selectOperateExecutiveBoardDisplay(missing.view, {
		binding: missing.binding,
		subjectId: missing.binding.cycleId,
	});
	assert.equal(stale.ok, false);
	assert.equal(stale.error.reasonCode, "OPERATE_PROJECTION_STALE");
});

test("executive board display rejects post-owner integrity substitutions", () => {
	const input = executiveBoardFixture();
	const display = selectOperateExecutiveBoardDisplay(input.view, {
		binding: input.binding,
		subjectId: input.binding.cycleId,
	});
	const mutations = [
		(candidate) => {
			candidate.payload.data.executiveBoard.planId = "ipl_foreign";
		},
		(candidate) => {
			candidate.integrity.sourceViewHash = `sha256:${"c".repeat(64)}`;
		},
		(candidate) => {
			candidate.integrity.contentHash = `sha256:${"d".repeat(64)}`;
		},
		(candidate) => {
			candidate.payload.scopeId = "scope-foreign";
		},
	];
	for (const mutate of mutations) {
		const candidate = structuredClone(display);
		mutate(candidate);
		assert.equal(validateOperateExecutiveBoardDisplaySurfaceV1(candidate, input.binding).length, 1);
		assert.throws(() =>
			assertOperateExecutiveBoardDisplaySurfaceV1(candidate, input.binding),
		);
	}
});

test("multiline 513 and 4096 character dissent remain exact across Experience, Cycle, Export, and Dashboard reads", () => {
	for (const length of [513, 4096]) {
		const input = executiveBoardFixture();
		const statement = multilineText(length);
		assert.equal(statement.length, length);
		assert.equal(statement.includes("\n"), true);
		const dissent = {
			sourceArtifactId: "art_challenger_long_dissent",
			localDissentId: "dissent:asg_challenger_long_dissent:1",
			statement,
			resolutionCondition: "Resolve only after the declared evidence window closes.",
		};
		input.view.cycles[0].executiveBoard.challengerFindings = {
			artifact: null,
			findings: [],
			dissent: [structuredClone(dissent)],
		};
		input.view.cycles[0].executiveBoard.chairSynthesis = {
			artifact: {
				artifactId: "art_chair_long_dissent",
				intelligencePlanId: input.view.cycles[0].executiveBoard.planId,
				advisorArtifactIds: ["art_00000002"],
				challengerArtifactId: dissent.sourceArtifactId,
			},
			decisions: [],
			dissent: [structuredClone(dissent)],
			unresolvedGaps: [],
		};
		rehashView(input);
		assert.equal(assertOperateExperienceTransportView(input.view), input.view);
		assert.equal(
			input.view.cycles[0].executiveBoard.chairSynthesis.dissent[0].statement,
			statement,
		);

		const cycle = selectOperateExperienceSurface(input.view, {
			surface: "cycle",
			binding: input.binding,
			subjectId: input.binding.cycleId,
		});
		assert.equal(
			cycle.data.cycle.executiveBoard.chairSynthesis.dissent[0].statement,
			statement,
		);

		const exported = selectOperateExperienceSurface(input.view, {
			surface: "export",
			binding: input.binding,
			format: "json",
		});
		const exportValue = JSON.parse(exported.data.content);
		assert.equal(
			exportValue.cycles[0].executiveBoard.chairSynthesis.dissent[0].statement,
			statement,
		);

		const display = selectOperateExecutiveBoardDisplay(input.view, {
			binding: input.binding,
			subjectId: input.binding.cycleId,
		});
		assert.equal(
			display.payload.data.executiveBoard.chairSynthesis.dissent[0].statement,
			statement,
		);
	}
});
