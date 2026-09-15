import assert from "node:assert/strict";
import test from "node:test";

import {
	assertDashboardBootstrapV1,
	validateDashboardBootstrapV1,
} from "../../lib/protocol/contracts.mjs";

const projectId = `sha256:${"a".repeat(64)}`;

function bootstrap() {
	return {
		kind: "dashboard-bootstrap",
		schemaVersion: "1.0.0",
		protocolVersion: "1.2.0",
		ui: {
			buildId: "dashboard-test",
			expectedBuildId: "dashboard-test",
			assetManifestHash: `sha256:${"b".repeat(64)}`,
		},
		server: { packageVersion: "0.0.0-test" },
		capabilities: {
			planningGraph: { schemaVersion: "1.0.0" },
			operateExperience: {
				protocolVersion: "2.0.0",
				schemaVersion: "1.0.0",
			},
			operateCommands: {
				protocolVersion: "2.0.0",
				transportVersion: "1.0.0",
				available: true,
			},
			diagnostics: { schemaVersion: "1.0.0", available: true },
		},
		project: {
			projectId,
			name: "Test project",
			branch: "feature/test",
			products: ["planning", "operate"],
		},
		queryRoots: {
			planning: {
				actorId: "human-owner",
				projectId,
				scopeId: "planning",
				domainId: "planning",
				domainVersion: "1.0.0",
				generation: 0,
			},
			operate: {
				actorId: "human-owner",
				projectId,
				scopeId: "business",
				domainId: "business",
				domainVersion: "2.0.0",
				generation: 0,
			},
		},
		origin: "http://127.0.0.1:4317",
		compatibility: { status: "compatible", reasonCodes: [] },
	};
}

test("dashboard bootstrap binds both product query roots to its exact project", () => {
	const value = bootstrap();
	assert.equal(assertDashboardBootstrapV1(value), value);

	for (const product of ["planning", "operate"]) {
		const foreign = structuredClone(value);
		foreign.queryRoots[product].projectId = `sha256:${"c".repeat(64)}`;
		assert.deepEqual(validateDashboardBootstrapV1(foreign), [
			{
				path: `$.queryRoots.${product}.projectId`,
				rule: "semantic",
				detail: "dashboard query roots must belong to the exact bootstrap project",
			},
		]);
	}
});

test("dashboard bootstrap permits an unavailable product root without inventing identity", () => {
	const value = bootstrap();
	value.queryRoots.operate = null;
	assert.equal(assertDashboardBootstrapV1(value), value);
});
