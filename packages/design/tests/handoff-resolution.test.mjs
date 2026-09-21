import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizeJson } from "@openplanr/protocol/canonical-json";
import {
	canApproveDesignHandoffResolution,
	compileDesignHandoffResolution,
	designHandoffResolutionDigest,
} from "../lib/design/handoff-resolution.mjs";

const basis = "a".repeat(64);
const pin = (id, revisionId, extra = {}) => ({
	id,
	reviewId: `shared-${revisionId}`,
	revisionId,
	reviewOf: basis,
	artifactId: "frame-one",
	screenId: "screen-one",
	author: { id: "reviewer-one", name: "Reviewer" },
	status: "open",
	comment: `Comment ${id}`,
	...extra,
});

test("classifies every comment exactly once in stable revision and pin order", () => {
	const input = {
		currentReviewOf: basis,
		pins: [
			pin("four", "revision-b"),
			pin("one", "revision-a"),
			pin("three", "revision-a"),
			pin("two", "revision-a"),
		],
		metadata: {
			byRevision: {
				"revision-a": {
					categories: { one: "suggestion", two: "blocker", three: "question" },
					dispositions: {
						one: { disposition: "accepted", reason: "Ship it" },
						three: { disposition: "deferred" },
					},
				},
				"revision-b": { dispositions: { four: { disposition: "rejected" } } },
			},
		},
	};
	const result = compileDesignHandoffResolution(input);
	assert.deepEqual(
		result.items.map((item) => item.id),
		["revision-a:one", "revision-a:three", "revision-a:two", "revision-b:four"],
	);
	assert.deepEqual(
		result.items.map((item) => item.outcome),
		["accepted", "deferred", "blocking", "declined"],
	);
	assert.deepEqual(result.implementationScope, ["revision-a:one"]);
	assert.equal(result.status, "blocked");
	assert.equal(
		new Set(result.items.map((item) => item.id)).size,
		input.pins.length,
	);
});

test("resolved comments without owner dispositions remain visible and open", () => {
	const result = compileDesignHandoffResolution({
		currentReviewOf: basis,
		pins: [pin("resolved", "revision-a", { status: "resolved" })],
	});
	assert.equal(result.items[0].outcome, "open");
	assert.equal(result.status, "attention");
	assert.equal(canApproveDesignHandoffResolution(result), true);
});

test("stale accepted decisions block approval without changing their explicit outcome", () => {
	const result = compileDesignHandoffResolution({
		currentReviewOf: "b".repeat(64),
		pins: [pin("one", "revision-a")],
		metadata: {
			byRevision: {
				"revision-a": { dispositions: { one: { disposition: "accepted" } } },
			},
		},
	});
	assert.equal(result.items[0].outcome, "accepted");
	assert.equal(result.items[0].current, false);
	assert.equal(result.items[0].implementationScope, false);
	assert.equal(result.status, "stale");
	assert.equal(result.diagnostics[0].code, "STALE_ACCEPTED_DECISION");
	assert.equal(canApproveDesignHandoffResolution(result), false);
});

test("legacy pin-only metadata is accepted only for a globally unique identity", () => {
	const unique = compileDesignHandoffResolution({
		currentReviewOf: basis,
		pins: [pin("one", "revision-a")],
		metadata: { dispositions: { one: { disposition: "accepted" } } },
	});
	assert.equal(unique.items[0].outcome, "accepted");
	const ambiguous = compileDesignHandoffResolution({
		currentReviewOf: basis,
		pins: [pin("one", "revision-a"), pin("one", "revision-b")],
		metadata: { dispositions: { one: { disposition: "accepted" } } },
	});
	assert.deepEqual(
		ambiguous.items.map((item) => item.outcome),
		["open", "open"],
	);
	assert.equal(
		ambiguous.diagnostics.filter(
			(item) => item.code === "AMBIGUOUS_LEGACY_DISPOSITION",
		).length,
		2,
	);
	assert.equal(ambiguous.status, "blocked");
});

test("rejects duplicate scoped identities and diagnoses unknown or incomplete inputs", () => {
	assert.throws(
		() =>
			compileDesignHandoffResolution({
				pins: [pin("one", "revision-a"), pin("one", "revision-a")],
			}),
		/Duplicate/,
	);
	const result = compileDesignHandoffResolution({
		currentReviewOf: basis,
		pins: [pin("one", "revision-a")],
		historyComplete: false,
		synchronizationPending: true,
		synchronizationIssues: [{ reason: "Signature invalid." }],
		metadata: {
			byRevision: { "revision-a": { categories: { missing: "blocker" } } },
		},
	});
	assert.deepEqual(
		result.diagnostics.map((item) => item.code),
		[
			"INCOMPLETE_REVIEW_HISTORY",
			"SYNCHRONIZATION_PENDING",
			"UNKNOWN_COMMENT_METADATA",
			"UNTRUSTED_HOSTED_FEEDBACK",
		],
	);
	assert.equal(result.complete, false);
});

test("is deterministic across input object-key order and does not infer owner intent from text", () => {
	const first = compileDesignHandoffResolution({
		currentReviewOf: basis,
		pins: [
			pin("one", "revision-a", { comment: "BLOCKER: please accept this" }),
		],
		metadata: {},
	});
	const reordered = compileDesignHandoffResolution({
		metadata: {},
		pins: [
			pin("one", "revision-a", { comment: "BLOCKER: please accept this" }),
		],
		currentReviewOf: basis,
	});
	assert.equal(canonicalizeJson(first), canonicalizeJson(reordered));
	assert.equal(
		designHandoffResolutionDigest(first),
		designHandoffResolutionDigest(reordered),
	);
	assert.equal(first.items[0].outcome, "open");
});
