import {
	adoptMermaidCopy,
	exportMermaidCopy,
	previewMermaidCopy,
	renderAuthoredDiagramSvg,
} from "../diagram/authoring/index.mjs";
import { button, element } from "./diagram-editor-dom.mjs";

const MAX_SOURCE_BYTES = 65_536;
const safeName = (name) =>
	name.replace(/[^a-z0-9_-]/giu, "-").slice(0, 80) || "diagram";
const fidelityName = (value) =>
	value === "lossless"
		? "Preserved"
		: value === "partial"
			? "Partial"
			: "Unsupported";

function download(document, bytes, type, name) {
	const window = document.defaultView;
	const url = window.URL.createObjectURL(new window.Blob([bytes], { type }));
	const link = element(document, "a", { href: url, download: name });
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function sourceOffset(source, byteOffset) {
	const bytes = new TextEncoder().encode(source);
	return new TextDecoder().decode(bytes.subarray(0, byteOffset)).length;
}

function fidelity(document, report) {
	const wrap = element(document, "div", {
		className: "de-source-fidelity",
		"aria-label": "Copy fidelity",
	});
	for (const [name, key] of [
		["Meaning", "semantic"],
		["Authored layout", "presentation"],
		["Original source text", "sourceText"],
	]) {
		const row = element(document, "div", {
			className: "de-source-fidelity-row",
		});
		row.append(
			element(document, "strong", {}, name),
			element(
				document,
				"span",
				{ "data-fidelity": report[key] },
				fidelityName(report[key]),
			),
		);
		wrap.append(row);
	}
	if (report.losses.length) {
		const list = element(document, "ul", {
			className: "de-source-losses",
			"aria-label": "Conversion losses",
		});
		for (const loss of report.losses)
			list.append(
				element(document, "li", {}, `${loss.dimension}: ${loss.message}`),
			);
		wrap.append(list);
	}
	return wrap;
}

/** One inert copy-interchange panel shared by local and company editor hosts. */
export function mountDiagramSourcePanel({
	root,
	session,
	source = "",
	onSourceChange = () => {},
	onAdopt = () => {},
	onClose = () => {},
	onReport = () => {},
}) {
	const document = root.ownerDocument;
	const wrap = element(document, "div", { className: "de-source-panel" });
	root.replaceChildren(wrap);
	let preview = null;
	let acknowledgement = false;
	let disposed = false;
	const heading = element(document, "h3", {}, "Import a Mermaid copy");
	const explanation = element(
		document,
		"p",
		{ className: "de-muted" },
		"Paste or upload a flowchart copy. This does not link, watch, or overwrite a repository file. Review the proposed diagram before adopting it.",
	);
	const label = element(document, "label", { className: "de-field" });
	const textarea = element(document, "textarea", {
		"aria-label": "Mermaid source",
		spellcheck: "false",
		rows: "10",
		className: "de-source-input",
	});
	textarea.value = source;
	const sourceLines = element(document, "pre", {
		className: "de-source-lines",
		"aria-hidden": "true",
	});
	const sourceEditor = element(document, "div", {
		className: "de-source-editor",
	});
	const updateLines = () => {
		sourceLines.textContent = Array.from(
			{ length: Math.min(4096, textarea.value.split(/\r\n|\n|\r/u).length) },
			(_, index) => String(index + 1),
		).join("\n");
	};
	updateLines();
	sourceEditor.append(sourceLines, textarea);
	label.append(element(document, "span", {}, "Mermaid source"), sourceEditor);
	const upload = element(document, "input", {
		type: "file",
		accept: ".mmd,.mermaid,text/plain",
		"aria-label": "Upload Mermaid copy",
	});
	const uploadLabel = element(document, "label", { className: "de-field" });
	uploadLabel.append(
		element(document, "span", {}, "Or choose a local Mermaid copy"),
		upload,
	);
	const status = element(
		document,
		"p",
		{ role: "status", "aria-live": "polite", className: "de-source-status" },
		"No source has been adopted.",
	);
	const actions = element(document, "div", { className: "de-actions" });
	const previewButton = button(document, "Preview copy", "source-preview", {
		className: "de-primary",
	});
	const adoptButton = button(document, "Adopt copy", "source-adopt", {
		disabled: true,
	});
	actions.append(
		previewButton,
		adoptButton,
		button(document, "Close", "source-close"),
	);
	const result = element(document, "div", { className: "de-source-result" });
	const exportHeading = element(document, "h3", {}, "Export a copy");
	const exportDescription = element(
		document,
		"p",
		{ className: "de-muted" },
		"The editable OpenPlanr bundle preserves the complete diagram. Mermaid and SVG are separate copies; neither updates an external source.",
	);
	const exports = element(document, "div", { className: "de-actions" });
	exports.append(
		button(document, "Download editable bundle", "source-export-bundle"),
		button(document, "Preview Mermaid export", "source-export-preview"),
		button(document, "Download SVG snapshot", "source-export-svg"),
	);
	const exportResult = element(document, "div", {
		className: "de-source-result",
	});
	wrap.append(
		heading,
		explanation,
		label,
		uploadLabel,
		status,
		actions,
		result,
		exportHeading,
		exportDescription,
		exports,
		exportResult,
	);

	function invalidate() {
		preview = null;
		acknowledgement = false;
		adoptButton.disabled = true;
		result.replaceChildren();
		status.textContent = "Source changed. Preview again before adoption.";
		onSourceChange(textarea.value);
	}
	textarea.addEventListener("input", () => {
		updateLines();
		invalidate();
	});
	textarea.addEventListener("scroll", () => {
		sourceLines.scrollTop = textarea.scrollTop;
	});
	upload.addEventListener("change", async () => {
		const file = upload.files?.[0];
		if (!file) return;
		if (file.size > MAX_SOURCE_BYTES) {
			status.textContent = "This source exceeds the 64 KiB import limit.";
			onReport(status.textContent);
			upload.value = "";
			return;
		}
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			if (disposed) return;
			textarea.value = content;
			updateLines();
			invalidate();
			status.textContent = `Loaded ${file.name} as an unlinked local copy. Preview before adoption.`;
		} catch {
			status.textContent = "This file is not valid UTF-8.";
			onReport(status.textContent);
		}
		upload.value = "";
	});
	function diagnosticList(items) {
		const list = element(document, "ol", {
			className: "de-source-diagnostics",
			"aria-label": "Source diagnostics",
		});
		items.forEach((item, index) => {
			const row = element(document, "li");
			row.append(
				button(
					document,
					`${item.severity === "error" ? "Error" : "Notice"} at line ${item.line}, column ${item.column}: ${item.message}`,
					"source-diagnostic",
					{ "data-index": index },
				),
			);
			if (item.repair)
				row.append(
					element(document, "span", { className: "de-muted" }, item.repair),
				);
			list.append(row);
		});
		return list;
	}
	function showPreview() {
		acknowledgement = false;
		adoptButton.disabled = true;
		const bundle = session.getState().bundle;
		if (!bundle) {
			status.textContent = "Diagram access has changed.";
			return;
		}
		const options = { diagramId: bundle.diagramId };
		if (bundle.presentation.elements.length) options.previousBundle = bundle;
		preview = previewMermaidCopy(textarea.value, options);
		result.replaceChildren();
		const diagnostics = preview.diagnostics ?? [];
		if (!preview.ok) {
			status.textContent = `Import rejected. ${diagnostics.filter((item) => item.severity === "error").length} error(s); no diagram was changed.`;
			result.append(diagnosticList(diagnostics));
			onReport(status.textContent);
			return;
		}
		const proposed = preview.bundle;
		status.textContent = `Preview ready: ${proposed.document.nodes.length} nodes, ${proposed.document.relations.length} connectors, ${proposed.document.groups.length} containers. No diagram was changed.`;
		result.append(fidelity(document, preview.fidelity));
		if (diagnostics.length) result.append(diagnosticList(diagnostics));
		const objectList = element(document, "ul", {
			className: "de-source-objects",
			"aria-label": "Proposed diagram objects",
		});
		for (const item of [
			...proposed.document.nodes.map((value) => ({ ...value, type: "Node" })),
			...proposed.document.relations.map((value) => ({
				...value,
				type: "Connector",
			})),
			...proposed.document.groups.map((value) => ({
				...value,
				type: "Container",
			})),
		]) {
			objectList.append(
				element(
					document,
					"li",
					{ "data-object-id": item.id },
					`${item.type}: ${item.label || item.id} · ${item.id}`,
				),
			);
		}
		result.append(element(document, "h4", {}, "Proposed objects"), objectList);
		const rendered = renderAuthoredDiagramSvg(proposed);
		if (rendered.ok) {
			const image = element(document, "img", {
				alt: "Proposed diagram preview",
				className: "de-source-image",
				src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`,
			});
			result.append(image);
		} else
			result.append(
				element(
					document,
					"p",
					{ className: "de-muted" },
					"A visual snapshot is unavailable for this source; inspect the proposed objects above.",
				),
			);
		const state = session.getState();
		const canAdopt =
			state.needsInitialization &&
			state.pendingCount === 0 &&
			state.bundle.presentation.elements.length === 0 &&
			state.capabilities.write &&
			state.saveState !== "saving";
		if (!canAdopt)
			result.append(
				element(
					document,
					"p",
					{ role: "note" },
					"Import into a new, empty, unsaved diagram. This existing diagram stays unchanged; export it first if you need a copy.",
				),
			);
		if (preview.requiresAcknowledgement) {
			const confirm = element(document, "label", {
				className: "de-source-ack",
			});
			const checkbox = element(document, "input", {
				type: "checkbox",
				"aria-label": "Acknowledge this preview’s listed losses",
			});
			checkbox.addEventListener("change", () => {
				acknowledgement = checkbox.checked;
				adoptButton.disabled = !canAdopt || !acknowledgement;
			});
			confirm.append(
				checkbox,
				element(
					document,
					"span",
					{},
					"I reviewed the exact conversion losses shown above.",
				),
			);
			result.append(confirm);
		} else adoptButton.disabled = !canAdopt;
	}
	function showExport() {
		const bundle = session.getState().bundle;
		exportResult.replaceChildren();
		if (!bundle) {
			onReport("Diagram access has changed.");
			return;
		}
		const copy = exportMermaidCopy(bundle);
		if (!copy.ok) {
			exportResult.append(diagnosticList(copy.diagnostics));
			return;
		}
		exportResult.append(fidelity(document, copy.fidelity));
		const snippet = element(
			document,
			"pre",
			{ className: "de-source-view", "aria-label": "Mermaid export source" },
			copy.text,
		);
		exportResult.append(
			snippet,
			button(document, "Download Mermaid copy", "source-download-mermaid"),
		);
		exportResult.dataset.mermaidText = copy.text;
	}
	const click = (event) => {
		const target = event.target.closest("[data-action]");
		if (!target || !wrap.contains(target)) return;
		const action = target.dataset.action;
		if (action === "source-preview") showPreview();
		else if (action === "source-adopt") {
			if (!preview?.ok || adoptButton.disabled) return;
			const adopted = adoptMermaidCopy(
				preview,
				acknowledgement ? preview.acknowledgement : null,
			);
			if (!adopted.ok) {
				onReport(
					adopted.diagnostics?.[0]?.message ??
						"Preview acknowledgement failed.",
				);
				return;
			}
			const applied = session.adoptInitialCopy(adopted.bundle);
			if (!applied.ok) {
				onReport(
					applied.diagnostics?.[0]?.detail ??
						"The diagram could not adopt this copy.",
				);
				return;
			}
			onReport("Mermaid copy adopted as an unsaved diagram. Save to keep it.");
			onAdopt(applied.bundle);
		} else if (action === "source-close") onClose();
		else if (action === "source-diagnostic") {
			const item = preview?.diagnostics?.[Number(target.dataset.index)];
			if (!item) return;
			const start = sourceOffset(textarea.value, item.range?.startByte ?? 0);
			const end = sourceOffset(textarea.value, item.range?.endByte ?? 0);
			textarea.focus();
			textarea.setSelectionRange(start, Math.max(start, end));
			for (const row of result.querySelectorAll("[data-object-id]"))
				row.dataset.affected = String(
					item.elementIds.includes(row.dataset.objectId),
				);
		} else if (action === "source-export-preview") showExport();
		else if (action === "source-download-mermaid")
			download(
				document,
				exportResult.dataset.mermaidText ?? "",
				"text/plain;charset=utf-8",
				`${safeName(session.getState().bundle.diagramId)}.mmd`,
			);
		else if (action === "source-export-bundle") {
			const bundle = session.getState().bundle;
			if (bundle)
				download(
					document,
					JSON.stringify(bundle, null, 2),
					"application/json",
					`${safeName(bundle.diagramId)}.planr-diagram-bundle.json`,
				);
		} else if (action === "source-export-svg") {
			const bundle = session.getState().bundle;
			if (!bundle) return;
			const rendered = renderAuthoredDiagramSvg(bundle);
			if (!rendered.ok) {
				const explanation =
					"Visual export needs a valid layout: " +
					(rendered.diagnostics?.[0]?.detail ?? "review the diagram geometry") +
					" Keep the editable bundle.";
				exportResult.append(
					element(document, "p", { role: "alert" }, explanation),
				);
				onReport(explanation);
				return;
			}
			download(
				document,
				rendered.svg,
				"image/svg+xml",
				`${safeName(bundle.diagramId)}.svg`,
			);
		}
	};
	wrap.addEventListener("click", click);
	return {
		focus: () => textarea.focus(),
		dispose() {
			disposed = true;
			wrap.removeEventListener("click", click);
			wrap.remove();
		},
		getSource: () => textarea.value,
	};
}
