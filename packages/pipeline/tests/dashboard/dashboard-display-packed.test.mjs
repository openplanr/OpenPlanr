import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as actionDisplay from "../../schemas/v1.2.0/operate-action-display-workspace.mjs";
import * as boardDisplay from "../../schemas/v1.2.0/operate-executive-board-display-surface.mjs";
import * as cycleDisplay from "../../schemas/v1.2.0/operate-cycle-display-workspace.mjs";
import * as recoveryDisplay from "../../schemas/v1.2.0/operate-recovery-display-surface.mjs";
import * as surfaceDisplay from "../../schemas/v1.2.0/operate-experience-display-surface.mjs";
import * as displayContract from "../../lib/dashboard/operate-experience-display-contract.mjs";
import { selectOperateExperienceDisplaySurface } from "../../lib/dashboard/operate-experience-reader.mjs";
import { pairedOpenPlanrTools } from "../helpers/paired-openplanr.mjs";
import { collectFilePaths } from "../helpers/files.mjs";
import { resolveWorkspaceDependencyRoot } from "../helpers/workspace-dependency.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const { typescript, vite } = pairedOpenPlanrTools();
const node20Executable = process.env.PLANR_NODE20_EXECUTABLE;
const SURFACE_EXPORTS = Object.freeze([
	"OPERATE_EXPERIENCE_DISPLAY_SURFACE_SCHEMA_V1",
	"assertOperateExperienceDisplaySurfaceV1",
	"assertOperateExperiencePreviewV1",
	"validateOperateExperienceDisplaySurfaceV1",
	"validateOperateExperiencePreviewV1",
].sort());
const WORKSPACE_EXPORTS = Object.freeze([
	"OPERATE_CYCLE_DISPLAY_WORKSPACE_SCHEMA_V1",
	"assertOperateCycleDisplayWorkspaceV1",
	"validateOperateCycleDisplayWorkspaceV1",
].sort());
const ACTION_EXPORTS = Object.freeze([
	"OPERATE_ACTION_DISPLAY_WORKSPACE_SCHEMA_V1",
	"assertOperateActionDisplayWorkspaceV1",
	"validateOperateActionDisplayWorkspaceV1",
].sort());
const BOARD_EXPORTS = Object.freeze([
	"OPERATE_EXECUTIVE_BOARD_DISPLAY_SURFACE_SCHEMA_V1",
	"assertOperateExecutiveBoardDisplaySurfaceV1",
	"validateOperateExecutiveBoardDisplaySurfaceV1",
].sort());
const RECOVERY_EXPORTS = Object.freeze([
	"OPERATE_RECOVERY_DISPLAY_SURFACE_SCHEMA_V1",
	"assertOperateRecoveryDisplaySurfaceV1",
	"validateOperateRecoveryDisplaySurfaceV1",
].sort());
const CONTRACT_EXPORTS = Object.freeze([
	...SURFACE_EXPORTS,
	...WORKSPACE_EXPORTS,
	...ACTION_EXPORTS,
	...BOARD_EXPORTS,
	...RECOVERY_EXPORTS,
	"ACTION_WORKSPACE_DOMAIN",
	"RECOVERY_DISPLAY_DOMAIN",
	"issueOperateActionDisplayWorkspaceV1",
	"issueOperateCycleDisplayWorkspaceV1",
	"issueOperateExecutiveBoardDisplaySurfaceV1",
	"issueOperateExperienceDisplaySurfaceV1",
	"issueOperateRecoveryDisplaySurfaceV1",
].sort());
const CUSTODY = Object.freeze([
	"lib/dashboard/operate-experience-display-contract.d.mts",
	"lib/dashboard/operate-experience-display-contract.mjs",
	"lib/dashboard/operate-experience-reader.d.mts",
	"lib/dashboard/operate-experience-reader.mjs",
	"lib/dashboard/generated/operate-experience-surface-schema-data.mjs",
	"schemas/v1.2.0/operate-action-display-workspace.d.mts",
	"schemas/v1.2.0/operate-action-display-workspace.mjs",
	"schemas/v1.2.0/operate-action-display-workspace.schema.json",
	"schemas/v1.2.0/operate-cycle-display-workspace.d.mts",
	"schemas/v1.2.0/operate-cycle-display-workspace.mjs",
	"schemas/v1.2.0/operate-cycle-display-workspace.schema.json",
	"schemas/v1.2.0/operate-executive-board-display-surface.d.mts",
	"schemas/v1.2.0/operate-executive-board-display-surface.mjs",
	"schemas/v1.2.0/operate-executive-board-display-surface.schema.json",
	"schemas/v1.2.0/operate-experience-display-surface.d.mts",
	"schemas/v1.2.0/operate-experience-display-surface.mjs",
	"schemas/v1.2.0/operate-experience-display-surface.schema.json",
	"schemas/v1.2.0/operate-recovery-display-surface.d.mts",
	"schemas/v1.2.0/operate-recovery-display-surface.mjs",
	"schemas/v1.2.0/operate-recovery-display-surface.schema.json",
]);

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
	assert.equal(
		result.status,
		0,
		`${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	return result;
}

function displayFixture() {
	const view = JSON.parse(
		readFileSync(
			join(
				root,
				"conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json",
			),
			"utf8",
		),
	)["operate-experience-view"];
	const binding = {
		actorId: view.actorId,
		scopeId: view.scopeId,
		domainId: view.domainId,
		domainVersion: view.domainVersion,
		generatedAt: view.generatedAt,
		eventHead: view.eventHead,
		viewHash: view.viewHash,
		surface: "today",
	};
	return {
		binding,
		display: selectOperateExperienceDisplaySurface(view, {
			surface: "today",
			binding,
		}),
	};
}

function packInstalledConsumer(temporaryRoot) {
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
	const consumer = join(temporaryRoot, "consumer");
	const installedPackage = join(consumer, "node_modules", "planr-pipeline");
	mkdirSync(installedPackage, { recursive: true });
	run("tar", [
		"-xzf",
		join(temporaryRoot, filename),
		"-C",
		installedPackage,
		"--strip-components=1",
	]);
	cpSync(
		resolveWorkspaceDependencyRoot("@noble/hashes"),
		join(consumer, "node_modules", "@noble", "hashes"),
		{ recursive: true },
	);
	writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
	return { consumer, installedPackage };
}

test("display verifier source, packed runtime, and declarations have exact public parity", {
	timeout: 120_000,
	skip: typescript ? false : "paired OpenPlanr TypeScript is required for declaration parity",
}, async () => {
	assert.deepEqual(Object.keys(surfaceDisplay).sort(), SURFACE_EXPORTS);
	assert.deepEqual(Object.keys(cycleDisplay).sort(), WORKSPACE_EXPORTS);
	assert.deepEqual(Object.keys(actionDisplay).sort(), ACTION_EXPORTS);
	assert.deepEqual(Object.keys(boardDisplay).sort(), BOARD_EXPORTS);
	assert.deepEqual(Object.keys(recoveryDisplay).sort(), RECOVERY_EXPORTS);
	assert.deepEqual(Object.keys(displayContract).sort(), CONTRACT_EXPORTS);
	assert.equal(
		JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies[
			"@noble/hashes"
		],
		"1.8.0",
	);
	const temporaryRoot = mkdtempSync(join(tmpdir(), "planr-display-pack-"));
	try {
		const { consumer, installedPackage } = packInstalledConsumer(temporaryRoot);
		for (const relativePath of CUSTODY) {
			assert.deepEqual(
				readFileSync(join(installedPackage, relativePath)),
				readFileSync(join(root, relativePath)),
				relativePath,
			);
		}
		const installedSurface = await import(
			pathToFileURL(
				join(
					installedPackage,
					"schemas/v1.2.0/operate-experience-display-surface.mjs",
				),
			).href
		);
		const installedWorkspace = await import(
			pathToFileURL(
				join(
					installedPackage,
					"schemas/v1.2.0/operate-cycle-display-workspace.mjs",
				),
			).href
		);
		const installedBoard = await import(
			pathToFileURL(
				join(
					installedPackage,
					"schemas/v1.2.0/operate-executive-board-display-surface.mjs",
				),
			).href
		);
		const installedContract = await import(
			pathToFileURL(
				join(installedPackage, "lib/dashboard/operate-experience-display-contract.mjs"),
			).href
		);
		assert.deepEqual(Object.keys(installedSurface).sort(), SURFACE_EXPORTS);
		assert.deepEqual(Object.keys(installedWorkspace).sort(), WORKSPACE_EXPORTS);
		assert.deepEqual(Object.keys(installedBoard).sort(), BOARD_EXPORTS);
		assert.deepEqual(Object.keys(installedContract).sort(), CONTRACT_EXPORTS);
		const { display, binding } = displayFixture();
		assert.equal(
			installedSurface.assertOperateExperienceDisplaySurfaceV1(
				display,
				binding,
			).integrity.contentHash,
			display.integrity.contentHash,
		);
		run(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				"Promise.all([import('planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs'), import('planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs'), import('planr-pipeline/schemas/v1.2.0/operate-executive-board-display-surface.mjs')]);",
			],
			{ cwd: consumer },
		);

		writeFileSync(
			join(consumer, "index.mts"),
			[
				"import * as surface from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';",
				"import * as workspace from 'planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs';",
				"import * as board from 'planr-pipeline/schemas/v1.2.0/operate-executive-board-display-surface.mjs';",
				"import * as contract from './node_modules/planr-pipeline/lib/dashboard/operate-experience-display-contract.mjs';",
				`const surfaceNames = ${JSON.stringify(SURFACE_EXPORTS)} as const;`,
				`const workspaceNames = ${JSON.stringify(WORKSPACE_EXPORTS)} as const;`,
				`const boardNames = ${JSON.stringify(BOARD_EXPORTS)} as const;`,
				`const contractNames = ${JSON.stringify(CONTRACT_EXPORTS)} as const;`,
				"type SurfaceMissing = Exclude<(typeof surfaceNames)[number], keyof typeof surface>;",
				"type SurfaceExtra = Exclude<keyof typeof surface, (typeof surfaceNames)[number]>;",
				"type WorkspaceMissing = Exclude<(typeof workspaceNames)[number], keyof typeof workspace>;",
				"type WorkspaceExtra = Exclude<keyof typeof workspace, (typeof workspaceNames)[number]>;",
				"type BoardMissing = Exclude<(typeof boardNames)[number], keyof typeof board>;",
				"type BoardExtra = Exclude<keyof typeof board, (typeof boardNames)[number]>;",
				"type ContractMissing = Exclude<(typeof contractNames)[number], keyof typeof contract>;",
				"type ContractExtra = Exclude<keyof typeof contract, (typeof contractNames)[number]>;",
				"const exact: [SurfaceMissing, SurfaceExtra, WorkspaceMissing, WorkspaceExtra, BoardMissing, BoardExtra, ContractMissing, ContractExtra] extends [never, never, never, never, never, never, never, never] ? true : never = true;",
				"void exact;",
				"void surface.validateOperateExperienceDisplaySurfaceV1({});",
				"void surface.validateOperateExperiencePreviewV1({});",
				"void workspace.validateOperateCycleDisplayWorkspaceV1({});",
				"void board.validateOperateExecutiveBoardDisplaySurfaceV1({});",
				"",
			].join("\n"),
		);
		run(
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
				join(consumer, "index.mts"),
			],
			{ cwd: consumer },
		);
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
});

test("packed display verification bundles synchronously without Node built-ins", {
	timeout: 120_000,
	skip: vite ? false : "paired OpenPlanr Vite is required for the browser-bundle proof",
}, () => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), "planr-display-vite-"));
	try {
		const { consumer } = packInstalledConsumer(temporaryRoot);
		const { display, binding } = displayFixture();
		const entry = join(consumer, "entry.js");
		const config = join(consumer, "vite.config.mjs");
		const output = join(consumer, "dist");
		writeFileSync(
			entry,
			[
				"import { assertOperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';",
				`const display = ${JSON.stringify(display)};`,
				`const binding = ${JSON.stringify(binding)};`,
				"globalThis.__operateDisplay = assertOperateExperienceDisplaySurfaceV1(display, binding);",
				"",
			].join("\n"),
		);
		writeFileSync(
			config,
			`export default ${JSON.stringify({
				root: consumer,
				build: {
					outDir: output,
					emptyOutDir: true,
					rollupOptions: { input: entry },
				},
			})};\n`,
		);
		run(
			process.execPath,
			[
				vite,
				"build",
				"--config",
				config,
			],
			{ cwd: consumer },
		);
		const bundle = collectFilePaths(output)
			.map((path) => readFileSync(path, "utf8"))
			.join("\n");
		assert.doesNotMatch(bundle, /node:(?:crypto|fs|path|url)/u);
		assert.doesNotMatch(bundle, /protocol\/loader/u);
		assert.match(bundle, /sha-256-jcs/u);
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
});

test("packed display verifier executes under exact Node 20.0.0", {
	timeout: 120_000,
	skip: node20Executable ? false : "PLANR_NODE20_EXECUTABLE is not configured",
}, () => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), "planr-display-node20-"));
	try {
		assert.equal(run(node20Executable, ["--version"]).stdout.trim(), "v20.0.0");
		const { consumer } = packInstalledConsumer(temporaryRoot);
		const { display, binding } = displayFixture();
		writeFileSync(
			join(consumer, "verify.mjs"),
			[
				"import { assertOperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';",
				`const display = ${JSON.stringify(display)};`,
				`const binding = ${JSON.stringify(binding)};`,
				"assertOperateExperienceDisplaySurfaceV1(display, binding);",
				"",
			].join("\n"),
		);
		run(node20Executable, ["verify.mjs"], { cwd: consumer });
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
});
