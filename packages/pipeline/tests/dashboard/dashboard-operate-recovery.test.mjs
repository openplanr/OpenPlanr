import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	assertOperateRecoveryDisplaySurfaceV1,
	validateOperateRecoveryDisplaySurfaceV1,
} from "../../schemas/v1.2.0/operate-recovery-display-surface.mjs";
import { selectOperateRecoveryDisplay, buildOperateExperienceTransportView } from "../../lib/dashboard/operate-experience-reader.mjs";
import { sha256Jcs } from "../../lib/protocol/jcs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const emptyView = structuredClone(
	JSON.parse(
		readFileSync(
			join(
				root,
				"conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json",
			),
			"utf8",
		),
	),
)["operate-experience-view"];

function historyEntry(overrides = {}) {
	return {
		eventId: "event-recovery-1",
		sequence: 1,
		type: "recovery.inspect",
		entityId: "runtime",
		actorKind: "runtime",
		actorId: "runtime",
		timestamp: emptyView.generatedAt,
		correlationId: "correlation-recovery-1",
		eventHash: emptyView.eventHead.hash,
		change: { subjectKind: "runtime", summary: "Recovery inspection recorded" },
		why: "Recovery inspection requested.",
		authority: null,
		evidenceRefIds: [],
		prior: { previousEventHash: null, causationId: null },
		result: null,
		next: null,
		deepLinks: [],
		beforeAfter: null,
		...overrides,
	};
}

function recoveryFixture(status = "repairable") {
	const view = {
		...structuredClone(emptyView),
		history: [historyEntry()],
	};
	delete view.viewHash;
	const transportView = buildOperateExperienceTransportView({
		...view,
		viewHash: sha256Jcs(view),
	});
	const binding = {
		actorId: transportView.actorId,
		scopeId: transportView.scopeId,
		domainId: transportView.domainId,
		domainVersion: transportView.domainVersion,
		generatedAt: transportView.generatedAt,
		eventHead: transportView.eventHead,
		viewHash: transportView.viewHash,
	};
	const recoveryRead = {
		ok: true,
		operation: "operate.recovery.inspect",
		data: {
			status,
			currentGeneration: "gen_00000001",
			recoverableGeneration: status === "repairable" ? "gen_00000000" : null,
			generationCount: 2,
			reason: "A stale writer lock was detected.",
			allowedRecovery:
				status === "repairable" ? "clear-stale-lock" : "none",
			lock: {
				status: status === "repairable" ? "stale" : "absent",
				ownerPid: status === "repairable" ? 4242 : null,
				nonce: status === "repairable" ? "nonce-001" : null,
				expiresAt: null,
				reason: "stale lock",
			},
			integrityBoundary: {
				model: "project-local-integrity",
				detects: ["accidental-corruption"],
				authenticity: "not-provided",
				outsideBoundary: ["fully-coordinated-same-user-offline-rewrite"],
				futureRequirement: "externally-anchored-or-signed-custody",
			},
		},
		allowedActions:
			status === "repairable"
				? [
						{
							tool: "operate.recovery.clear-stale-lock",
							arguments: {},
							label: "Archive the stale writer lock and retry safely",
							effect: "machine-local-write",
						},
					]
				: [],
	};
	return { view: transportView, binding, recoveryRead };
}

function rehashView(input) {
	const base = structuredClone(input.view);
	delete base.viewHash;
	const view = buildOperateExperienceTransportView({
		...base,
		viewHash: sha256Jcs(base),
	});
	input.view = view;
	input.binding = { ...input.binding, viewHash: view.viewHash };
	return input;
}

test("recovery display sanitizes inspection and commits stable recovery state", () => {
	const input = recoveryFixture("repairable");
	const display = selectOperateRecoveryDisplay(
		input.view,
		input.recoveryRead,
		{ binding: input.binding },
	);
	assert.equal(display.kind, "operate-recovery-display-surface");
	assert.equal(display.payload.kind, "operate-recovery");
	assert.equal(display.payload.data.recoveryState, "blocked");
	assert.equal("integrityBoundary" in display.payload.data.inspection, false);
	assert.equal(assertOperateRecoveryDisplaySurfaceV1(display, input.binding), display);
	assert.equal(
		JSON.stringify(display).includes("externally-anchored-or-signed-custody"),
		false,
	);
});

test("recovery display refuses foreign bindings and invalid envelopes", () => {
	const input = recoveryFixture();
	const foreign = selectOperateRecoveryDisplay(input.view, input.recoveryRead, {
		binding: { ...input.binding, domainId: "foreign" },
	});
	assert.equal(foreign.ok, false);
	assert.equal(foreign.error.reasonCode, "OPERATE_BINDING_MISMATCH");

	const invalid = selectOperateRecoveryDisplay(
		input.view,
		{ ok: true, operation: "operate.cycle.get", data: {}, allowedActions: [] },
		{ binding: input.binding },
	);
	assert.equal(invalid.ok, false);
	assert.equal(invalid.error.reasonCode, "OPERATE_PROJECTION_INVALID");
});

test("recovery display rejects stale inspection and post-owner substitutions", () => {
	const input = recoveryFixture("healthy");
	const stale = structuredClone(input);
	stale.recoveryRead.data.status = "corrupt";
	const staleDisplay = selectOperateRecoveryDisplay(
		stale.view,
		stale.recoveryRead,
		{ binding: stale.binding },
	);
	assert.equal(staleDisplay.payload.data.recoveryState, "corrupt");

	const display = selectOperateRecoveryDisplay(
		input.view,
		input.recoveryRead,
		{ binding: input.binding },
	);
	const hostile = structuredClone(display);
	hostile.payload.data.inspection.integrityBoundary = { model: "foreign" };
	assert.throws(() =>
		assertOperateRecoveryDisplaySurfaceV1(hostile, input.binding),
	);

	const foreignBinding = recoveryFixture();
	rehashView(foreignBinding);
	foreignBinding.binding.generatedAt = "2026-01-01T00:00:00Z";
	const mismatched = selectOperateRecoveryDisplay(
		foreignBinding.view,
		foreignBinding.recoveryRead,
		{ binding: foreignBinding.binding },
	);
	assert.equal(mismatched.ok, false);
	assert.equal(mismatched.error.reasonCode, "OPERATE_BINDING_MISMATCH");

	for (const mutate of [
		(candidate) => {
			candidate.integrity.contentHash = `sha256:${"d".repeat(64)}`;
		},
		(candidate) => {
			candidate.payload.data.recoveryState = "corrupt";
		},
	]) {
		const candidate = structuredClone(display);
		mutate(candidate);
		assert.equal(
			validateOperateRecoveryDisplaySurfaceV1(candidate, input.binding).length,
			1,
		);
	}
});
