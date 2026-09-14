import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	assertOperateExperienceDisplaySurfaceV1,
	validateOperateExperienceDisplaySurfaceV1,
} from "../../schemas/v1.2.0/operate-experience-display-surface.mjs";
import { selectOperateExperienceDisplaySurface } from "../../lib/dashboard/operate-experience-reader.mjs";
import { sha256Jcs } from "../../lib/protocol/jcs.mjs";
import { rehashExperienceView } from "./experience-view-test-support.mjs";

const fixture = JSON.parse(
	readFileSync(
		new URL(
			"../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json",
			import.meta.url,
		),
		"utf8",
	),
)["operate-experience-view"];

const lifecycleStage = {
	created: 0,
	observing: 0,
	advising: 1,
	challenging: 1,
	synthesizing: 1,
	awaiting_review: 2,
	approved: 3,
	executing: 4,
	verifying: 5,
	closed: 6,
	blocked: 0,
	failed: 0,
	cancelled: 0,
};
const transportStatuses = [
	"ready",
	"read-only",
	"stale",
	"partial",
	"blocked",
	"offline",
	"incompatible",
	"corrupt",
];

function cycle(
	focus = ["API/CLI and C#/.NET delivery"],
	cycleState = "approved",
) {
	const current = lifecycleStage[cycleState];
	return {
		cycleId: "cycle-1",
		state: cycleState,
		health: "normal",
		focus,
		createdAt: fixture.generatedAt,
		updatedAt: fixture.generatedAt,
		stages: [
			"observe",
			"understand",
			"decide",
			"govern",
			"act",
			"verify",
			"learn",
		].map((id, index) => {
			let state = index < current ? "complete" : index === current ? "current" : "waiting";
			if (cycleState === "closed") state = "complete";
			if (index === current && ["blocked", "failed"].includes(cycleState)) {
				state = cycleState;
			}
			if (index === current && cycleState === "cancelled") state = "skipped";
			return {
			id,
			state,
			reason: ["blocked", "failed", "skipped"].includes(state)
				? `Cycle is ${cycleState}.`
				: null,
			inputArtifactIds: [],
			outputArtifactIds: [],
			gates: [],
			evidenceGapIds: [],
			uncertaintyIds: [],
			persistentActionIds: [],
		};
		}),
		assignments: [],
		lensAbsences: [],
		executiveBoard: null,
		dependencies: [],
		blockers: [],
		persistentActionIds: [],
		replayCheckpoint: null,
		deepLink: "#/operate/cycles/cycle-1",
	};
}

function currentView(focus, cycleState = "approved", status = "ready") {
	const base = {
		...structuredClone(fixture),
		status,
		cycles: [cycle(focus, cycleState)],
	};
	return rehashExperienceView(base);
}

function replayMatrixView(status, genesis) {
	const view = currentView(undefined, "approved", status);
	if (genesis) {
		view.eventHead = { sequence: 0, hash: null };
		view.replay.tail = {
			...view.replay.tail,
			startSequence: null,
			endSequence: null,
			eventCount: 0,
		};
		view.replay.finalHead = { sequence: 0, hash: null };
		view.replay.parityProof.finalEventHashMatches = true;
	}
	return rehashView(view);
}

function rehashView(view) {
	return rehashExperienceView(view);
}

function checkpointedView() {
	const view = currentView();
	const checkpoint = {
		createdAt: view.generatedAt,
		eventHead: structuredClone(view.eventHead),
		runtimeStateHash: view.sourceStateHash,
		eventReplayIndexHash: view.replay.tail.eventReplayIndexHash,
		recoveryVersion: "2.0.0",
	};
	view.replay.checkpoint = checkpoint;
	view.replay.tail = {
		...view.replay.tail,
		startSequence: view.eventHead.sequence + 1,
		endSequence: null,
		eventCount: 0,
	};
	view.replay.parityProof.checkpointVerified = true;
	view.replay.parityProof.stateParityVerified = true;
	view.cycles[0].replayCheckpoint = structuredClone(checkpoint);
	return rehashView(view);
}

function binding(view, surface, subjectId = null) {
	return {
		actorId: view.actorId,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
		surface,
		subjectId,
		cycleId: subjectId,
	};
}

function selected(view, surface, subjectId = null) {
	const expected = binding(view, surface, subjectId);
	const value = selectOperateExperienceDisplaySurface(view, {
		surface,
		subjectId,
		binding: expected,
	});
	return { value, expected };
}

test("display owner issues exact versioned Today, Cycles, and Cycle commitments", () => {
	const view = currentView();
	for (const [surface, subjectId] of [
		["today", null],
		["cycles", null],
		["cycle", "cycle-1"],
	]) {
		const { value, expected } = selected(view, surface, subjectId);
		assert.equal(value.kind, "operate-experience-display-surface");
		assert.equal(value.schemaVersion, "1.0.0");
		assert.equal(value.payload.surface, surface);
		assert.equal(value.payload.viewHash, view.viewHash);
		assert.equal(value.integrity.sourceViewHash, view.viewHash);
		assert.match(value.integrity.contentHash, /^sha256:[a-f0-9]{64}$/u);
		assert.equal(assertOperateExperienceDisplaySurfaceV1(value, expected), value);
	}
});

test("display owner rejects every recomputed full-view replay substitution before selection", () => {
	const mutations = [
		(view) => {
			view.replay.finalHead = { sequence: 0, hash: null };
		},
		(view) => {
			view.replay.parityProof.sourceStateHash = `sha256:${"a".repeat(64)}`;
		},
		(view) => {
			view.replay.parityProof.eventReplayIndexHash = `sha256:${"b".repeat(64)}`;
		},
		(view) => {
			view.replay.parityProof.checkpointVerified = true;
		},
		(view) => {
			view.replay.tail = { ...view.replay.tail, startSequence: 2 };
		},
		(view) => {
			view.replay.tail = { ...view.replay.tail, endSequence: null };
		},
		(view) => {
			view.replay.tail = { ...view.replay.tail, eventCount: 0 };
		},
		(view) => {
			view.replay.parityProof.finalEventHashMatches = false;
		},
		(view) => {
			view.cycles[0].replayCheckpoint = {
				createdAt: view.generatedAt,
				eventHead: structuredClone(view.eventHead),
				runtimeStateHash: view.sourceStateHash,
				eventReplayIndexHash: view.replay.tail.eventReplayIndexHash,
				recoveryVersion: "2.0.0",
			};
		},
		(view) => {
			const checkpoint = {
				createdAt: view.generatedAt,
				eventHead: structuredClone(view.eventHead),
				runtimeStateHash: `sha256:${"c".repeat(64)}`,
				eventReplayIndexHash: view.replay.tail.eventReplayIndexHash,
				recoveryVersion: "2.0.0",
			};
			view.replay.checkpoint = checkpoint;
			view.replay.tail = {
				...view.replay.tail,
				startSequence: view.eventHead.sequence + 1,
				endSequence: null,
				eventCount: 0,
			};
			view.replay.parityProof.checkpointVerified = true;
			view.cycles[0].replayCheckpoint = structuredClone(checkpoint);
		},
	];
	for (const mutate of mutations) {
		for (const [surface, subjectId] of [
			["today", null],
			["cycles", null],
			["cycle", "cycle-1"],
		]) {
			const view = currentView();
			mutate(view);
			rehashView(view);
			const { value } = selected(view, surface, subjectId);
			assert.deepEqual(value, {
				ok: false,
				status: 409,
				error: {
					reasonCode: "OPERATE_PROJECTION_INVALID",
					message: "The operating view is unavailable until it is refreshed.",
					retryable: false,
				},
			});
			assert.doesNotMatch(JSON.stringify(value), /sourceStateHash|finalHead|eventReplayIndexHash/u);
		}
	}
});

test("replay custody is unconditional across every owner status and Event-head form", () => {
	for (const status of transportStatuses) {
		for (const genesis of [true, false]) {
			for (const [surface, subjectId] of [
				["today", null],
				["cycles", null],
				["cycle", "cycle-1"],
			]) {
				const canonical = replayMatrixView(status, genesis);
				const accepted = selected(canonical, surface, subjectId).value;
				assert.equal(
					accepted.kind,
					"operate-experience-display-surface",
					`${status}:${genesis ? "genesis" : "non-genesis"}:${surface}`,
				);

				const substituted = structuredClone(canonical);
				substituted.replay.parityProof.finalEventHashMatches = false;
				rehashView(substituted);
				const refused = selected(substituted, surface, subjectId).value;
				assert.equal(refused.error.reasonCode, "OPERATE_PROJECTION_INVALID");
				assert.equal(
					JSON.stringify(refused).includes(status),
					false,
					`${status}:${genesis ? "genesis" : "non-genesis"}:${surface}`,
				);
			}
		}
	}
});

test("display owner preserves exact restart and replay parity", () => {
	for (const view of [currentView(), checkpointedView()]) {
		const restarted = structuredClone(view);
		for (const [surface, subjectId] of [
			["today", null],
			["cycles", null],
			["cycle", "cycle-1"],
		]) {
			assert.deepEqual(
				selected(restarted, surface, subjectId).value,
				selected(view, surface, subjectId).value,
			);
		}
	}
});

test("Cycle display assertion requires both exact expected Cycle identities", () => {
	const view = currentView();
	const { value, expected } = selected(view, "cycle", "cycle-1");
	for (const field of ["subjectId", "cycleId"]) {
		const foreign = { ...expected, [field]: "cycle-foreign" };
		assert.throws(() => assertOperateExperienceDisplaySurfaceV1(value, foreign));
		const missing = { ...expected };
		delete missing[field];
		assert.throws(() => assertOperateExperienceDisplaySurfaceV1(value, missing));
	}
});

test("display owner enforces the exact canonical lifecycle matrix", () => {
	for (const cycleState of Object.keys(lifecycleStage)) {
		const view = currentView(undefined, cycleState);
		const { value, expected } = selected(view, "cycles");
		assert.equal(
			assertOperateExperienceDisplaySurfaceV1(value, expected),
			value,
			cycleState,
		);
		const hostile = structuredClone(value);
		hostile.payload.data.cycles[0].stages[6].state = "revisited";
		assert.throws(
			() => assertOperateExperienceDisplaySurfaceV1(hostile, expected),
			cycleState,
		);
	}
});

test("display verification rejects every exact byte, lifecycle, binding, order, and digest substitution", () => {
	const view = currentView();
	const { value, expected } = selected(view, "cycles");
	const mutations = [
		(candidate) => candidate.payload.data.cycles[0].focus.push("/private/tamper"),
		(candidate) => {
			candidate.payload.data.cycles[0].state = "executing";
		},
		(candidate) => {
			candidate.payload.data.cycles[0].stages[3].reason = "private-state";
		},
		(candidate) => candidate.payload.data.cycles[0].stages.reverse(),
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
			candidate.privateBody = "must-not-echo";
		},
	];
	for (const mutate of mutations) {
		const candidate = structuredClone(value);
		mutate(candidate);
		assert.equal(validateOperateExperienceDisplaySurfaceV1(candidate, expected).length, 1);
		assert.throws(
			() => assertOperateExperienceDisplaySurfaceV1(candidate, expected),
			(error) =>
				error.code === "E_OPERATE_EXPERIENCE_DISPLAY_INVALID" &&
				!error.message.includes("must-not-echo"),
		);
	}
	assert.throws(() =>
		assertOperateExperienceDisplaySurfaceV1(value, {
			...expected,
			viewHash: `sha256:${"e".repeat(64)}`,
		}),
	);
});

test("display verification rejects hidden fields, accessors, and proxies without evaluating private values", () => {
	const { value, expected } = selected(currentView(), "today");
	const nonEnumerable = structuredClone(value);
	Object.defineProperty(nonEnumerable.payload, "privateBody", {
		enumerable: false,
		value: "/private/non-enumerable-value-must-not-echo",
	});
	assert.throws(
		() => assertOperateExperienceDisplaySurfaceV1(nonEnumerable, expected),
		(error) => !error.message.includes("non-enumerable-value-must-not-echo"),
	);
	const symbol = structuredClone(value);
	symbol.payload[Symbol("privateBody")] =
		"/private/symbol-value-must-not-echo";
	assert.throws(
		() => assertOperateExperienceDisplaySurfaceV1(symbol, expected),
		(error) => !error.message.includes("symbol-value-must-not-echo"),
	);
	let getterReads = 0;
	const accessor = structuredClone(value);
	Object.defineProperty(accessor.payload, "privateBody", {
		enumerable: true,
		get() {
			getterReads += 1;
			return "/private/getter-value-must-not-echo";
		},
	});
	assert.throws(
		() => assertOperateExperienceDisplaySurfaceV1(accessor, expected),
		(error) => !error.message.includes("getter-value-must-not-echo"),
	);
	assert.equal(getterReads, 0);
	const proxy = new Proxy(structuredClone(value), {});
	assert.throws(() => assertOperateExperienceDisplaySurfaceV1(proxy, expected));
});

test("owner provenance permits arbitrary public technology, URL, query, and shell-shaped text", () => {
	for (const focus of [
		"API/CLI with C#/.NET",
		"IPv6 HTTPS https://[2001:db8::1]/v2/status",
		"Public query https://docs.example.test/?next=/private-looking/example#/$HOME/guide",
		"Document literal $HOME/guides and $(pwd)/examples",
		"Windows documentation %USERPROFILE%/OpenPlanr",
	]) {
		const view = currentView([focus]);
		const { value, expected } = selected(view, "today");
		assert.equal(value.payload.data.activeCycle.focus[0], focus);
		assert.equal(assertOperateExperienceDisplaySurfaceV1(value, expected), value);
	}
});
