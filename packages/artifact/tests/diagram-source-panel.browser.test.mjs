import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	adoptMermaidCopy,
	previewMermaidCopy,
} from "../lib/artifact/diagram/authoring/index.mjs";
import { createDiagramAuthoringStore } from "../lib/artifact/diagram/authoring/store.mjs";
import { startDiagramOwner } from "../lib/artifact/diagram/editor/local-owner.mjs";

const enabled = process.env.PLANR_BROWSER_TESTS === "1";
const requireProtocol = createRequire(
	new URL("../../protocol/package.json", import.meta.url),
);
const playwright = requireProtocol("playwright");
const supported = readFileSync(
	new URL(
		"../fixtures/diagram/interchange/flowchart-supported.mmd",
		import.meta.url,
	),
	"utf8",
);
const partial = readFileSync(
	new URL(
		"../fixtures/diagram/interchange/flowchart-partial.mmd",
		import.meta.url,
	),
	"utf8",
);

async function fixture(
	t,
	{ initial = null, viewport = { width: 1280, height: 800 } } = {},
) {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "planr-source-ui-")),
	);
	const store = createDiagramAuthoringStore({ root, slug: "checkout" });
	if (initial)
		await store.initialize(initial, { transactionId: "source-fixture" });
	const owner = await startDiagramOwner({
		root,
		slug: "checkout",
		grammar: "flowchart",
		noOpen: true,
		env: { ...process.env, PLANR_HOME: join(root, "home") },
	});
	const engine = process.env.PLANR_BROWSER_ENGINE ?? "chromium";
	assert.ok(["chromium", "firefox", "webkit"].includes(engine));
	const browser = await playwright[engine].launch({
		headless: true,
		...(process.env.PLANR_BROWSER_EXECUTABLE
			? { executablePath: process.env.PLANR_BROWSER_EXECUTABLE }
			: {}),
	});
	const page = await browser.newPage({ viewport, acceptDownloads: true });
	const errors = [],
		remote = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		if (
			!request.url().startsWith(new URL(owner.baseUrl).origin) &&
			!request.url().startsWith("data:")
		)
			remote.push(request.url());
	});
	t.after(async () => {
		await browser.close();
		await owner.close();
		await rm(root, { recursive: true, force: true });
		assert.deepEqual(errors, []);
		assert.deepEqual(remote, []);
	});
	await page.goto(owner.baseUrl);
	await page.locator("[data-editor-svg]").waitFor();
	return { page, store, owner };
}
const dialog = (page) =>
	page.getByRole("dialog", { name: "Mermaid copy and exports" });
async function open(page) {
	await page.getByRole("button", { name: "Source", exact: true }).click();
	return dialog(page);
}

test("a new local diagram previews and adopts an exact Mermaid copy only after loss acknowledgement", {
	skip: !enabled,
	timeout: 90_000,
}, async (t) => {
	const { page, store } = await fixture(t);
	let panel = await open(page);
	await panel.getByRole("tab", { name: "Import a copy" }).focus();
	await page.keyboard.press("ArrowRight");
	assert.equal(
		await panel
			.getByRole("tab", { name: "Export a copy" })
			.getAttribute("aria-selected"),
		"true",
	);
	await page.keyboard.press("ArrowLeft");
	assert.equal(
		await panel
			.getByRole("tab", { name: "Import a copy" })
			.getAttribute("aria-selected"),
		"true",
	);
	await panel.getByLabel("Mermaid source").fill(supported);
	await panel.getByRole("button", { name: "Preview copy" }).click();
	assert.match(
		await panel.getByRole("status").innerText(),
		/Preview ready: 3 nodes, 2 connectors, 2 containers/u,
		await panel.innerText(),
	);
	assert.equal(
		await panel.getByText("Container: Platform", { exact: false }).count(),
		1,
	);
	assert.ok(await panel.locator(".de-source-lines").innerText());
	assert.equal(await panel.getByText("Authored layout").count(), 1);
	assert.equal(await panel.getByText("Original source text").count(), 1);
	assert.equal(
		await panel.getByRole("button", { name: "Adopt copy" }).isDisabled(),
		true,
	);
	await panel.getByLabel("Acknowledge this preview’s listed losses").check();
	await panel.getByRole("button", { name: "Adopt copy" }).click();
	assert.equal(await dialog(page).count(), 0);
	assert.equal(
		(await store.read()).status,
		"absent",
		"adoption is still unsaved",
	);
	await page.getByRole("button", { name: "Save diagram" }).click();
	await page.getByText("Saved", { exact: true }).waitFor();
	const saved = await store.read();
	assert.equal(saved.status, "ready");
	assert.equal(saved.bundle.originalSource.text, supported);
	assert.equal(saved.bundle.sourceMap.entries.length > 0, true);
	await page.reload();
	await page.locator("[data-editor-svg]").waitFor();
	assert.equal(
		await page.locator('[data-editor-svg] [data-element-id="a"]').count(),
		1,
	);
	panel = await open(page);
	assert.equal(
		await panel.getByLabel("Mermaid source").inputValue(),
		supported,
		"closing/reopening keeps pending input in the tab",
	);
	await panel.getByRole("button", { name: "Preview copy" }).click();
	assert.equal(
		await panel.getByRole("button", { name: "Adopt copy" }).isDisabled(),
		true,
		"published document cannot be overwritten by an import",
	);
});

test("unsafe and changed source leave the diagram untouched and diagnostics navigate original bytes", {
	skip: !enabled,
	timeout: 90_000,
}, async (t) => {
	const { page, store } = await fixture(t);
	const panel = await open(page);
	const source = "flowchart TB\r\nA[Été]\r\ninvalid???\r\n";
	await panel.getByLabel("Mermaid source").fill(source);
	await panel.getByRole("button", { name: "Preview copy" }).click();
	assert.match(await panel.getByRole("status").innerText(), /Import rejected/u);
	await panel.getByRole("button", { name: /Error at line 3/u }).click();
	const selected = await panel
		.getByLabel("Mermaid source")
		.evaluate((input) =>
			input.value.slice(input.selectionStart, input.selectionEnd),
		);
	assert.equal(selected, "invalid???");
	assert.equal((await store.read()).status, "absent");
	await panel.getByLabel("Mermaid source").fill(partial);
	await panel.getByRole("button", { name: "Preview copy" }).click();
	await panel.getByLabel("Acknowledge this preview’s listed losses").check();
	assert.equal(
		await panel.getByRole("button", { name: "Adopt copy" }).isEnabled(),
		true,
	);
	await panel
		.getByLabel("Mermaid source")
		.fill(partial.replace("Start", "Begin"));
	assert.equal(
		await panel.getByRole("button", { name: "Adopt copy" }).isDisabled(),
		true,
	);
	await panel.getByRole("button", { name: "Close", exact: true }).click();
	assert.equal(
		await page
			.getByRole("button", { name: "Source", exact: true })
			.evaluate((button) => document.activeElement === button),
		true,
	);
	assert.equal((await store.read()).status, "absent");
	await open(page);
	assert.equal(
		await dialog(page).getByLabel("Mermaid source").inputValue(),
		partial.replace("Start", "Begin"),
	);
});

test("export discloses losses and offers the complete bundle, Mermaid copy and SVG separately", {
	skip: !enabled,
	timeout: 90_000,
}, async (t) => {
	const converted = previewMermaidCopy("flowchart LR\nA[Start]\n", {
		diagramId: "checkout",
	});
	const initial = adoptMermaidCopy(converted, converted.acknowledgement).bundle;
	const { page } = await fixture(t, {
		initial,
		viewport: { width: 390, height: 844 },
	});
	const panel = await open(page);
	await panel.getByRole("tab", { name: "Export a copy" }).click();
	await panel.getByRole("button", { name: "Preview Mermaid export" }).click();
	assert.match(
		await panel.getByLabel("Conversion losses").innerText(),
		/coordinates|routes|attachment|placement/iu,
	);
	assert.equal((await panel.getByText("Authored layout").count()) > 0, true);
	const bundleDownload = page.waitForEvent("download");
	await panel.getByRole("button", { name: "Download editable bundle" }).click();
	assert.match(
		(await bundleDownload).suggestedFilename(),
		/planr-diagram-bundle\.json$/u,
	);
	const mermaidDownload = page.waitForEvent("download");
	await panel.getByRole("button", { name: "Download Mermaid copy" }).click();
	assert.match((await mermaidDownload).suggestedFilename(), /\.mmd$/u);
	const svgDownload = page.waitForEvent("download");
	await panel.getByRole("button", { name: "Download SVG snapshot" }).click();
	assert.match((await svgDownload).suggestedFilename(), /\.svg$/u);
	assert.equal(
		await panel.getByRole("button", { name: /link|watch|overwrite/iu }).count(),
		0,
	);
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
		true,
	);
});

test("uploaded copies stay unlinked and produce an inspectable visual snapshot", {
	skip: !enabled,
	timeout: 90_000,
}, async (t) => {
	const { page, store } = await fixture(t);
	const panel = await open(page);
	await panel.getByLabel("Upload Mermaid copy").setInputFiles({
		name: "checkout.mmd",
		mimeType: "text/plain",
		buffer: Buffer.from(supported),
	});
	assert.equal(
		await panel.getByLabel("Mermaid source").inputValue(),
		supported,
	);
	assert.match(
		await panel.getByRole("status").innerText(),
		/unlinked local copy/u,
	);
	await panel.getByRole("button", { name: "Preview copy" }).click();
	assert.match(await panel.getByRole("status").innerText(), /Preview ready/u);
	await panel.getByLabel("Acknowledge this preview’s listed losses").check();
	await panel.getByRole("button", { name: "Adopt copy" }).click();
	assert.equal((await store.read()).status, "absent");
	await page.getByRole("button", { name: "Source", exact: true }).click();
	const reopened = dialog(page);
	await reopened.getByRole("tab", { name: "Export a copy" }).click();
	const visualDownload = page.waitForEvent("download");
	await reopened.getByRole("button", { name: "Download SVG snapshot" }).click();
	assert.match((await visualDownload).suggestedFilename(), /\.svg$/u);
	const bundleDownload = page.waitForEvent("download");
	await reopened
		.getByRole("button", { name: "Download editable bundle" })
		.click();
	assert.match(
		(await bundleDownload).suggestedFilename(),
		/planr-diagram-bundle\.json$/u,
	);
});

test("visual export explains invalid geometry while the complete bundle remains available", {
	skip: !enabled,
	timeout: 90_000,
}, async (t) => {
	const longSource = `flowchart LR\nA[${"long ".repeat(40)}]\n`;
	const converted = previewMermaidCopy(longSource, { diagramId: "checkout" });
	const initial = adoptMermaidCopy(converted, converted.acknowledgement).bundle;
	const { page } = await fixture(t, { initial });
	const panel = await open(page);
	await panel.getByRole("tab", { name: "Export a copy" }).click();
	await panel.getByRole("button", { name: "Download SVG snapshot" }).click();
	assert.match(
		await panel.getByRole("alert").innerText(),
		/valid layout.*Label/u,
	);
	const bundleDownload = page.waitForEvent("download");
	await panel.getByRole("button", { name: "Download editable bundle" }).click();
	assert.match(
		(await bundleDownload).suggestedFilename(),
		/planr-diagram-bundle\.json$/u,
	);
});
