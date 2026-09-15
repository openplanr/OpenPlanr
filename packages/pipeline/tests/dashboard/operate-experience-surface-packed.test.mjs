import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const custodyPaths = Object.freeze([
	"schemas/v1.2.0/operate-experience-surface.schema.json",
	"schemas/v1.2.0/operate-experience-surface.mjs",
	"lib/dashboard/operate-experience-surface-contract.mjs",
	"lib/dashboard/generated/operate-experience-surface-schema-data.mjs",
	"schemas/v1.2.0/dashboard-bootstrap.schema.json",
]);

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	assert.equal(
		result.status,
		0,
		`${command} ${args.join(" ")} failed\n${result.stderr}`,
	);
	return result;
}

test("packed consumer resolves and executes the public dashboard surface assertion", {
	timeout: 120_000,
}, () => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), "planr-surface-pack-"));
	try {
		const packed = run(
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
			{ cwd: root },
		);
		const [{ filename }] = JSON.parse(packed.stdout);
		const installedPackage = join(
			temporaryRoot,
			"consumer",
			"node_modules",
			"planr-pipeline",
		);
		mkdirSync(installedPackage, { recursive: true });
		run("tar", [
			"-xzf",
			join(temporaryRoot, filename),
			"-C",
			installedPackage,
			"--strip-components=1",
		]);
		const consumer = join(temporaryRoot, "consumer");
		writeFileSync(
			join(consumer, "package.json"),
			JSON.stringify({ type: "module" }),
		);
		writeFileSync(
			join(consumer, "verify.mjs"),
			`
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { resolve } from 'node:path';
      import {
        assertOperateExperienceSurfaceV1,
        validateOperateExperienceSurfaceV1,
      } from 'planr-pipeline/schemas/v1.2.0/operate-experience-surface.mjs';
      import { deriveOperateSharedTruthSummaryV1 } from 'planr-pipeline/operate/review-workspace-projection-v2';
      const root = resolve('node_modules/planr-pipeline');
      const view = JSON.parse(readFileSync(resolve(
        root, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'
      ), 'utf8'))['operate-experience-view'];
      const surface = {
        ok: true,
        kind: 'operate-experience-surface', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
        surface: 'today', readOnly: true, mutationEnabled: true,
        scopeId: view.scopeId, domainId: view.domainId, domainVersion: view.domainVersion,
        actorId: view.actorId, accessLevel: view.accessLevel, generatedAt: view.generatedAt,
        eventHead: view.eventHead, viewHash: view.viewHash,
        truthSummary: deriveOperateSharedTruthSummaryV1(view),
        status: 'ready', reasonCodes: [],
        data: {
          attention: view.attention, domainMetrics: view.domainMetrics,
          activeCycle: view.cycles[0] ?? null, inbox: view.inbox, actions: view.actions,
          outcomes: view.outcomes, allowedActions: view.allowedActions,
        },
      };
      assert.deepEqual(validateOperateExperienceSurfaceV1(surface), []);
      assert.equal(assertOperateExperienceSurfaceV1(surface), surface);
      const hostile = structuredClone(surface);
      hostile.data.allowedActions = [{
        subjectId: 'cycle-1',
        action: {
          tool: 'operate.cycle.get', arguments: { cycleId: 'cycle-1', privatePath: '/private' },
          label: 'Refresh', effect: 'read-only',
        },
      }];
      assert.ok(validateOperateExperienceSurfaceV1(hostile).length > 0);
    `,
		);
		for (const path of custodyPaths) {
			assert.equal(
				sha256(join(installedPackage, path)),
				sha256(join(root, path)),
				`${path}: packed bytes must match source`,
			);
		}
		run(process.execPath, ["verify.mjs"], { cwd: consumer });
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
});
