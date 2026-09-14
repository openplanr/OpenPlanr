import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { createArtifactReview } from "../../packages/artifact/lib/artifact/review.mjs";
import { digestArtifactEnvelope } from "../../packages/artifact/lib/artifact/envelope.mjs";
import {
	buildDesignSkillResources,
	DESIGN_SKILL_IDS,
} from "../../scripts/skills/design-resources.mjs";
import { projectedSkillName } from "../../scripts/skills/host-invocations.mjs";
import { resourceBytes } from "../../scripts/skills/resource-bytes.mjs";
import {
	createDeterministicZip,
	readDeterministicZip,
} from "../../packages/skill-runtime/src/packaging/index.mjs";

const root = resolve(import.meta.dirname, "../..");
const pixel = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6F8sAAAAASUVORK5CYII=",
	"base64",
);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value);
};

function fixture(
	directory,
	{ screens = 2, variants = 1, image = false, mode = "standalone" } = {},
) {
	const design =
		mode === "default"
			? join(directory, "output/feats/feat-fieldwork/design")
			: join(directory, "design");
	const document = {
		kind: "openplanr-design-document",
		schemaVersion: "1.0.0",
		id: "fieldwork",
		title: "Fieldwork dispatch",
		brief: {
			text: "Coordinate field crews and confirm delivery.",
			source: image ? "png" : "describe",
			provenance: "inferred",
			references: ["Product brief and local source"],
		},
		frames: [
			{ id: "desktop", label: "Desktop", width: 1280, height: 800 },
			{ id: "mobile", label: "Mobile", width: 390, height: 844 },
		],
		screens: Array.from({ length: screens }, (_, index) => ({
			id: `screen-${index + 1}`,
			title: `Dispatch step ${index + 1}`,
			description: `Implementation guidance for dispatch step ${index + 1}.`,
			source: { html: `source/screen-${index + 1}.html` },
			anchors: ["primary"],
		})),
		screenOrder: Array.from(
			{ length: screens },
			(_, index) => `screen-${index + 1}`,
		),
		variants: Array.from({ length: variants }, (_, index) => ({
			id: `direction-${index + 1}`,
			label: `Direction ${index + 1}`,
			status: "ready",
			sources: index
				? Object.fromEntries(
						Array.from({ length: screens }, (_, screenIndex) => [
							`screen-${screenIndex + 1}`,
							{
								html: `source/direction-${index + 1}-screen-${screenIndex + 1}.html`,
							},
						]),
					)
				: {},
		})),
		selectedVariant: "direction-1",
		defaultView: "canvas",
		designSystem: {
			tokens: "source/tokens.css",
			spacing: [0, 6, 12, 18, 24, 36],
		},
	};
	write(join(directory, ".planr/config.json"), "{}\n");
	write(
		join(design, "source/tokens.css"),
		":root{--ink:#152637;--surface:#ffffff}body{margin:0;padding:18px;color:var(--ink);background:var(--surface);font-family:system-ui}button{padding:12px;cursor:pointer}button:focus-visible{outline:2px solid currentColor}",
	);
	if (image) write(join(design, "source/reference.png"), pixel);
	for (const [index, screen] of document.screens.entries()) {
		for (const variant of document.variants) {
			const source = variant.sources[screen.id] ?? screen.source;
			write(
				join(design, source.html),
				`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${screen.title}</title></head><body><main><h1>${screen.title}</h1><p>${variant.label}: ${index + 1} crews ready</p>${image ? '<img src="reference.png" alt="Supplied reference; static image">' : ""}<button type="button" data-planr-id="primary" onclick="this.textContent='Confirmed'">Confirm dispatch</button></main></body></html>`,
			);
		}
	}
	const specification = Array.from(
		{ length: 10 },
		(_, index) =>
			`## ${index + 1}. ${["Color Palette", "Typography", "Spacing & Layout", "Components Inventory", "Navigation & Layout Patterns", "Iconography", "Motion & Interaction Hints", "Component Overrides", "Screen Inventory", "Open Questions"][index]}\n\n${index === 8 ? document.screens.map((item) => item.title).join("\n") : "Project-specific design decisions."}`,
	).join("\n\n");
	const specPath =
		mode === "default"
			? join(dirname(design), "design-spec.md")
			: join(design, "design-spec.md");
	write(specPath, specification);
	const path = join(design, "design-document.json");
	write(path, JSON.stringify(document));
	return { path, design, document, specPath };
}

function install(directory, skillId, host = "openai", { suite = false } = {}) {
	const hostSkillName = projectedSkillName(skillId);
	if (suite) {
		const destination = join(directory, "installed", "openplanr");
		cpSync(join(root, `dist/plugins/${host}/openplanr`), destination, {
			recursive: true,
		});
		return join(destination, "skills", hostSkillName, "scripts/design.mjs");
	}
	const destination = join(directory, "installed", skillId);
	cpSync(
		join(root, `dist/plugins/${host}/openplanr/skills`, hostSkillName),
		destination,
		{ recursive: true },
	);
	return join(destination, "scripts/design.mjs");
}

function environment(directory) {
	// Child utilities cannot resolve the source checkout or a global planr CLI.
	return {
		HOME: directory,
		PLANR_HOME: join(directory, ".runtime-home"),
		PATH: "/usr/bin:/bin",
		NO_COLOR: "1",
	};
}

function run(script, directory, args, { success = true } = {}) {
	const result = spawnSync(process.execPath, [script, ...args, "--json"], {
		cwd: directory,
		env: environment(directory),
		encoding: "utf8",
		timeout: 20_000,
	});
	if (success) {
		assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
		return JSON.parse(result.stdout);
	}
	assert.notEqual(result.status, 0);
	return result;
}

async function open(script, directory, file) {
	const child = spawn(
		process.execPath,
		[script, "open", file, "--no-open", "--json"],
		{
			cwd: directory,
			env: environment(directory),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let errors = "";
	child.stderr.on("data", (chunk) => {
		errors += chunk;
	});
	const result = await new Promise((resolveValue, reject) => {
		let data = "";
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error(`Design startup timed out: ${errors}`));
		}, 15_000);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`Design exited ${code}: ${errors}`));
		});
		child.stdout.on("data", (chunk) => {
			data += chunk;
			if (data.includes("\n")) {
				clearTimeout(timeout);
				try {
					resolveValue(JSON.parse(data.split("\n")[0]));
				} catch (error) {
					reject(error);
				}
			}
		});
	});
	return {
		...result,
		async close() {
			if (child.exitCode === null) {
				const closed = once(child, "exit");
				child.kill("SIGTERM");
				await closed;
			}
		},
	};
}

test("standalone and suite design skills render authored journeys with complete local resources", async () => {
	const temporary = realpathSync(
		mkdtempSync(join(tmpdir(), "openplanr-design-install-")),
	);
	try {
		for (const [index, skillId] of DESIGN_SKILL_IDS.entries()) {
			const directory = join(temporary, skillId);
			mkdirSync(directory);
			const script = install(
				directory,
				skillId,
				index === 1 ? "claude" : "openai",
				{ suite: index === 1 },
			);
			const skillRoot = resolve(dirname(script), "..");
			assert.match(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), /review-context\.json/u, "installed entrypoint makes welcome authoring explicit");
			const reviewGuidance = readFileSync(join(skillRoot, "references/team-review.md"), "utf8");
			assert.equal(reviewGuidance, readFileSync(join(root, "packages/design/references/team-review.md"), "utf8"), "installed company-review guidance matches its canonical source");
			assert.match(reviewGuidance, /Before every requested share or publish/u);
			const source = fixture(directory, {
				screens: index === 1 ? 9 : 2,
				variants: index === 1 ? 3 : 1,
				image: index === 2,
				mode: index === 0 ? "default" : "standalone",
			});
			// The active agent authors the brief; installation must preserve its
			// design-specific content through rendering, without a provider call.
			const brief = [
				{ purpose: "Review crew assignment before scoping the dispatch flow.", requests: ["Is the assigned crew clear before confirming delivery?"] },
				{ purpose: "Compare the three authored dispatch directions.", requests: ["Which direction makes crew assignment easiest to follow?", "Where does confirming delivery need more context?"] },
				{ purpose: "Review the revised dispatch action beside its supplied reference.", requests: ["Does the revised action explain what will be confirmed?"] },
			][index];
			const context = { kind: "openplanr-design-review-context", schemaVersion: "1.0.0", designId: source.document.id, brief,
				implementation: { tokens: [{ name: "--ink", value: "#152637" }], components: [], responsive: [], accessibility: [] } };
			write(join(source.design, "review-context.json"), JSON.stringify(context));
			const inspected = run(script, directory, ["inspect", source.path]);
			assert.equal(inspected.specPath, source.specPath);
			assert.equal(inspected.missing.length, 0);
			const validation = run(script, directory, ["validate", source.path]);
			assert.equal(validation.verification, "unverified");
			const rendered = run(script, directory, ["render", source.path]);
			assert.equal(rendered.verification, "unverified");
			assert.deepEqual(Object.keys(rendered.views).sort(), [
				"canvas",
				"prototype",
				"walkthrough",
			]);
			const record = json(join(dirname(rendered.artifact), "render.json"));
			assert.deepEqual(record.reviewContext, context, "the installed renderer retains this design's authored welcome and implementation guidance");
			assert.equal(
				record.envelope.artifacts.length,
				source.document.screens.length *
					source.document.frames.length *
					source.document.variants.length,
			);
			assert.equal(
				record.document.screens.at(-1).id,
				source.document.screens.at(-1).id,
			);
			if (index === 2)
				assert.ok(
					record.envelope.artifacts.every(({ html }) =>
						html.includes(pixel.toString("base64")),
					),
					"image-reference bytes remain exact",
				);
			for (const view of ["canvas", "prototype", "walkthrough"]) {
				const exported = run(script, directory, [
					"export",
					source.path,
					"--view",
					view,
					"--output",
					join(directory, `${view}.html`),
				]);
				const html = readFileSync(exported.output, "utf8");
				const payload = JSON.parse(/<script type="application\/json" id="planr-design-studio-payload">([\s\S]*?)<\/script>/u.exec(html)[1]);
				assert.deepEqual(payload.reviewContext.brief, brief, "every view uses the same authored welcome");
				assert.ok(
					html.includes('data-design-view="canvas"') &&
						html.includes('data-design-view="prototype"') &&
						html.includes('data-design-view="walkthrough"'),
				);
				assert.ok(
					html.includes("data-design-notes") &&
						html.includes(
							"Implementation context stays outside the product UI.",
						),
				);
				assert.ok(
					html.includes("data:text/javascript;base64,"),
					"portable runtime is embedded",
				);
			}
			assert.ok(existsSync(rendered.manifest));
			assert.equal(
				(readFileSync(source.specPath, "utf8").match(/^## \d+\./gm) ?? [])
					.length,
				10,
			);
		}
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("installed Artifact skill requires design-specific welcome preparation before sharing", () => {
	for (const host of ["openai", "claude"]) {
		const installed = join(root, "dist/plugins", host, "openplanr/skills/artifact");
		const entrypoint = readFileSync(join(installed, "SKILL.md"), "utf8");
		assert.match(entrypoint, /\[design-sharing\.md\]\(references\/design-sharing\.md\)/u);
		assert.match(entrypoint, /review-context\.json/u);
		assert.equal(readFileSync(join(installed, "references/design-sharing.md"), "utf8"), readFileSync(join(root, "skills/planr-artifact/references/design-sharing.md"), "utf8"));
	}
});

test("installed review retains pins, selection and arrangement across restart, scoped revision and failed rendering", async () => {
	const directory = realpathSync(
		mkdtempSync(join(tmpdir(), "openplanr-design-review-install-")),
	);
	let session;
	try {
		const script = install(directory, "planr-design-review");
		const source = fixture(directory, { variants: 3 });
		const rendered = run(script, directory, ["render", source.path]);
		const record = json(join(dirname(rendered.artifact), "render.json"));
		session = await open(script, directory, source.path);
		assert.equal(
			session.status,
			"loading",
			"HTTP health must not claim browser inspection",
		);
		assert.equal((await fetch(session.url)).status, 200);
		assert.equal((await fetch(`${session.url}stage.js`)).status, 200);
		const origin = new URL(session.url).origin;
		const update = async (route, value) =>
			fetch(`${session.url}api/${route}`, {
				method: "PUT",
				headers: { origin, "content-type": "application/json" },
				body: JSON.stringify(value),
			});
		const state = {
			stateVersion: 0,
			revision: rendered.revision,
			state: {
				view: "walkthrough",
				camera: { x: -280, y: 144 },
				viewports: {
					canvas: { x: -280, y: 144, zoom: 0.64 },
					walkthrough: { x: 72, y: 54, zoom: 0.8 },
				},
				positions: { [record.entries[0].artifactId]: { x: -148, y: -72 } },
				ratings: { "direction-2": 5 },
				selectedVariant: "direction-2",
			},
		};
		assert.equal((await update("design-state", state)).status, 200);
		assert.equal(
			(await update("design-state", state)).status,
			409,
			"stale writer cannot overwrite current feedback",
		);
		const now = new Date().toISOString();
		const review = createArtifactReview({
			reviewId: "review-one",
			reviewOf: digestArtifactEnvelope(record.envelope),
			decision: "changes_requested",
			overall: "Clarify the primary action.",
			createdAt: now,
			updatedAt: now,
			pins: [
				{
					id: "pin-one",
					author: { name: "Reviewer" },
					replies: [],
					artifactId: record.entries[0].artifactId,
					region: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
					viewport: { width: 1280, height: 800 },
					anchor: { planrId: "primary", screen: "screen-1" },
					intent: "fix",
					status: "open",
					comment: "Use clearer dispatch copy.",
					createdAt: now,
					updatedAt: now,
				},
			],
		});
		assert.equal((await update("review", review)).status, 200);
		const selection = run(script, directory, [
			"feedback",
			source.path,
			"--action",
			"select",
			"--variant",
			"direction-2",
		]);
		assert.equal(
			json(selection.tastePath).designs.fieldwork.selected[0],
			"direction-2",
		);
		const selectedExport = run(script, directory, [
			"export",
			source.path,
			"--view",
			"prototype",
			"--output",
			join(directory, "selected.html"),
		]);
		const selectedPayload = JSON.parse(
			/<script type="application\/json" id="planr-design-studio-payload">([\s\S]*?)<\/script>/u.exec(
				readFileSync(selectedExport.output, "utf8"),
			)[1],
		);
		assert.equal(selectedPayload.state.selectedVariant, "direction-2");
		assert.equal(selectedPayload.state.variantId, "direction-2");
		assert.deepEqual(selectedPayload.state.positions, state.state.positions);
		assert.deepEqual(selectedPayload.state.camera, state.state.camera);
		assert.deepEqual(selectedPayload.state.viewports, state.state.viewports);
		await session.close();
		session = await open(script, directory, source.path);
		const before = run(script, directory, ["feedback", source.path]);
		assert.equal(before.pins[0].comment, "Use clearer dispatch copy.");
		assert.deepEqual(before.state.positions, state.state.positions);
		assert.deepEqual(before.state.viewports, state.state.viewports);
		assert.equal(before.state.ratings["direction-2"], 5);
		const untouched = readFileSync(join(source.design, "source/screen-2.html"));
		const target = join(source.design, "source/screen-1.html");
		writeFileSync(
			target,
			readFileSync(target, "utf8").replace(
				"Confirm dispatch",
				"Assign crew now",
			),
		);
		const revised = run(script, directory, ["render", source.path]);
		assert.notEqual(revised.revision, rendered.revision);
		assert.deepEqual(
			readFileSync(join(source.design, "source/screen-2.html")),
			untouched,
		);
		const after = run(script, directory, ["feedback", source.path]);
		assert.equal(after.pins[0].id, "pin-one");
		assert.equal(after.pins[0].stale, true);
		assert.deepEqual(after.state.positions, state.state.positions);
		run(
			script,
			directory,
			[
				"feedback",
				source.path,
				"--action",
				"resolve",
				"--pins",
				"pin-one",
				"--summary",
				"Updated copy",
			],
			{ success: false },
		);
		const workingPointer = readFileSync(
			join(source.design, ".design/current.json"),
		);
		writeFileSync(target, '<img src="missing.png" alt="missing">');
		run(script, directory, ["render", source.path], { success: false });
		assert.deepEqual(
			readFileSync(join(source.design, ".design/current.json")),
			workingPointer,
		);
		assert.ok(
			existsSync(rendered.artifact),
			"previous completed revision remains recoverable",
		);
	} finally {
		await session?.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("design runtime bundling and release archives preserve binary assets without executable dependencies", async () => {
	const resources = await buildDesignSkillResources({ repoRoot: root });
	const binary = Buffer.from([0, 255, 128, 13, 10, 193, 240, 159, 255, 0]);
	const entries = [
		...resources.map(({ path, bytes }) => ({
			path,
			bytes: resourceBytes(bytes),
		})),
		{ path: "assets/opaque-font.woff2", bytes: resourceBytes(binary) },
	];
	const archive = createDeterministicZip(entries);
	const extracted = readDeterministicZip(archive);
	assert.deepEqual(
		extracted.find(({ path }) => path === "assets/opaque-font.woff2").bytes,
		binary,
	);
	for (const entry of resources)
		assert.deepEqual(
			extracted.find(({ path }) => path === entry.path).bytes,
			entry.bytes,
		);
	assert.ok(
		resources.length < 200,
		"portable closure fits the frozen skill-package resource limit",
	);
});

test("isolated Design and Plan installations preserve explicit review handoff approval and freshness", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openplanr-team-review-install-")));
  try {
    const designScript = install(directory, "planr-design-review", "claude", { suite: true });
    const planScript = install(directory, "planr-plan");
    const source = fixture(directory);
    write(join(source.design, "review-context.json"), JSON.stringify({
      kind: "openplanr-design-review-context", schemaVersion: "1.0.0", designId: source.document.id,
      brief: { purpose: "Review the dispatch journey before planning changes.", requests: ["Is the primary action clear?"] },
      implementation: { tokens: [{ name: "--ink", value: "#152637" }], components: [], responsive: ["Reflow on mobile."], accessibility: ["Keep keyboard focus visible."] },
    }));
    run(designScript, directory, ["render", source.path]);
    const prepared = run(designScript, directory, ["handoff", source.path, "--action", "draft"]);
    assert.equal(prepared.draft.status, "draft");
    assert.equal(prepared.current, true);
    const refinement = join(directory, "refinement.json");
    write(refinement, JSON.stringify({ content: { ...prepared.draft.content, summary: "Review the authored dispatch journey and its verification gaps before scoping implementation." } }));
    const refined = run(designScript, directory, ["handoff", source.path, "--action", "update", "--input", refinement]);
    const approval = join(directory, "approval.json");
    write(approval, JSON.stringify({ contentHash: refined.draft.contentHash }));
    const approved = run(designScript, directory, ["handoff", source.path, "--action", "approve", "--input", approval]);
    assert.equal(approved.draft.status, "approved");
    const consumed = run(planScript, directory, ["handoff", source.path, "--action", "inspect"]);
    assert.equal(consumed.current, true);
    assert.equal(consumed.draft.contentHash, approved.draft.contentHash);
    assert.ok(readFileSync(join(dirname(planScript), "../SKILL.md"), "utf8").includes("approved"));
    const previous = readFileSync(approved.path);
    const context = json(join(source.design, "review-context.json"));
    context.brief.requests.push("Is mobile navigation clear?");
    write(join(source.design, "review-context.json"), JSON.stringify(context));
    run(designScript, directory, ["render", source.path]);
    const outdated = run(planScript, directory, ["handoff", source.path, "--action", "inspect"]);
    assert.equal(outdated.current, false);
    assert.deepEqual(readFileSync(approved.path), previous, "freshness never silently rewrites owner approval");
    assert.equal(existsSync(join(directory, ".planr/tasks")), false, "inspecting a handoff never executes Plan or Ship");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
