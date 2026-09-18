import { renderPlanrMark } from "../artifact/ui/renderers.mjs";
import { embedJson, escapeHtml } from "./escape.mjs";

export const DESIGN_STUDIO_VERSION = "1.8.5";
export const DESIGN_STUDIO_ASSETS = Object.freeze({
	style: "templates/studio/studio.css",
	runtime: "templates/studio/studio.js",
	enhancementsStyle: "templates/studio/enhancements.css",
	enhancementsRuntime: "templates/studio/enhancements.js",
});

/** Self-contained so the same preference is applied before local/hosted paint. */
export function applyDesignStudioTheme(preference) {
	if (!preference) {
		try { preference = localStorage.getItem("openplanr.design.theme"); } catch {}
	}
	if (!["dark", "light", "system"].includes(preference)) preference = "dark";
	const resolved = preference === "system"
		? (globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark")
		: preference;
	Object.assign(document.documentElement.dataset, { planrTheme: resolved, designTheme: resolved, designThemePreference: preference });
	// The generic stage reads its initial theme from this model. Keep that first
	// render consistent with the preference already applied to the page head.
	const modelNode = document.getElementById("planr-artifact-shell-model");
	if (modelNode) {
		try { const model = JSON.parse(modelNode.textContent); model.theme = resolved; modelNode.textContent = JSON.stringify(model); } catch {}
	}
	return { preference, resolved };
}

/** Personal device policy, never part of authored screen content or contracts. */
export function applyDesignStudioResourcePolicy() {
  const root = document.querySelector('.planr-shell');
  if (!root || !document.documentElement.hasAttribute('data-design-studio')) return;
  if (globalThis.matchMedia?.('(pointer: coarse)').matches) {
    root.dataset.planrFrameBudget = '3';
    root.dataset.designResourceMode = 'bounded';
  }
}
export function designStudioThemeBootstrapSource() {
	return `(${applyDesignStudioTheme.toString()})();(${applyDesignStudioResourcePolicy.toString()})();`;
}


function button(label, attributes = "", className = "") {
	return `<button type="button"${className ? ` class="${className}"` : ""} ${attributes}>${escapeHtml(label)}</button>`;
}

const icons = {
  left: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  right: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  canvas: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  prototype: '<path d="m8 4 12 8-12 8Z"/>',
  walkthrough: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m9 22 3-4 3 4M9 9h6M9 13h3"/>',
  share: '<path d="M12 16V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  pointer: '<path d="m5 3 15 9-7 1-3 7Z"/>',
  comment: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 9h8M8 13h5"/>',
};
function icon(name) {
  return `<svg class="design-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function iconButton(label, name, attributes = "", className = "") {
  return `<button type="button" class="${className}" ${attributes} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon(name)}<span class="design-button-label">${escapeHtml(label)}</span></button>`;
}
function toolbar(document) {
  return `<header class="planr-toolbar design-toolbar">
  <div class="design-toolbar-leading">
    ${iconButton("Screens", "left", 'data-design-toggle-nav aria-controls="design-navigator" aria-expanded="true"', "planr-toolbar-action design-panel-toggle")}
    <div class="planr-brand">${renderPlanrMark()}<span class="design-wordmark" aria-label="OpenPlanr">Open<span>Planr</span></span><span class="planr-title-block"><strong title="${escapeHtml(document.title)}">${escapeHtml(document.title)}</strong></span></div>
  </div>
  <div class="planr-segment design-view-picker" role="group" aria-label="Design view">${["canvas", "prototype", "walkthrough"].map((view) => iconButton(view[0].toUpperCase() + view.slice(1), view, `data-design-view="${view}" aria-pressed="${document.defaultView === view}"`)).join("")}</div>
  <div class="design-toolbar-trailing">
    <span class="design-save-state" role="status" aria-live="polite" data-design-save-state>Loading studio</span>
    ${iconButton("Review", "right", 'data-planr-action="feedback" data-planr-review-label="Review" aria-controls="planr-review-rail" aria-expanded="true"', "planr-toolbar-action design-review-toggle")}
    ${iconButton("Share design", "share", 'data-planr-action="share" aria-haspopup="dialog"', "planr-toolbar-action design-share")}
    <details class="design-export"><summary aria-label="Export" title="Export">${icon("export")}</summary><div>${button("Portable HTML", 'data-design-export="html"')}${button("Screen PNG", 'data-design-export="png"')}</div></details>
  </div>
</header>`;
}

function navigator(document) {
	const failed = document.variants.filter(({ status }) => status === "failed");
	return `<nav class="design-navigator" id="design-navigator" aria-label="Design screens">
  <div class="design-nav-title"><strong>Screens <span>${document.screenOrder.length}</span></strong>${iconButton("Close screens", "left", 'data-design-toggle-nav aria-controls="design-navigator" aria-expanded="true"', "design-nav-close")}</div>
  <label class="design-field" for="design-variant">Direction<select id="design-variant" data-design-variant>${document.variants.map((variant) => `<option value="${escapeHtml(variant.id)}"${variant.status !== "ready" ? " disabled" : ""}>${escapeHtml(variant.label)}${variant.status === "failed" ? " — unavailable" : ""}</option>`).join("")}</select></label>
  ${document.variants.filter(({ status }) => status === "ready").length > 1 ? `<label class="design-compare"><input type="checkbox" data-design-compare> Compare directions</label>` : ""}
  <div class="design-screen-list">${document.screenOrder
		.map((screenId, index) => {
			const screen = document.screens.find(({ id }) => id === screenId);
			return `<button type="button" class="design-screen" data-design-screen="${escapeHtml(screen.id)}" aria-current="${index === 0 ? "page" : "false"}" title="${escapeHtml(screen.title)}"><span class="design-screen-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(screen.title)}</span></button>`;
		})
		.join("")}</div>
  <div class="design-nav-footer"><span data-design-verification>Browser inspection pending</span><span class="design-local">Local workspace</span></div>
  ${failed.length ? `<details class="design-failed-variants"><summary>${failed.length} unavailable ${failed.length === 1 ? "direction" : "directions"}</summary>${failed.map((variant) => `<p><strong>${escapeHtml(variant.label)}</strong><br>${escapeHtml(variant.issue ?? "Generation did not complete. The previous design remains available.")}</p>`).join("")}</details>` : ""}
</nav>`;
}

function designNotes(document) {
	const screens = document.screens.filter(({ description }) => description);
	if (!screens.length) return "";
	return `<details class="design-guidance" data-design-notes><summary aria-controls="design-guidance-panel" aria-expanded="false">Notes <span>${screens.length}</span></summary><div class="design-guidance-panel" id="design-guidance-panel" role="region" aria-labelledby="design-guidance-title"><header><div><strong id="design-guidance-title">Design notes</strong><p>Implementation context stays outside the product UI.</p></div><button type="button" data-design-close-notes aria-label="Close design notes" title="Close design notes">×</button></header>${screens
		.map(
			(screen, index) =>
				`<details data-design-note-screen="${escapeHtml(screen.id)}"${index === 0 ? " open" : ""}><summary>${escapeHtml(screen.title)}</summary><p>${escapeHtml(screen.description)}</p></details>`,
		)
		.join("")}</div></details>`;
}

function stageDetails(document) {
	return `<div class="design-stage-context"><div><strong data-design-screen-title>${escapeHtml(document.screens.find(({ id }) => id === document.screenOrder[0]).title)}</strong><span data-design-stage-description>Every screen, one connected design</span></div><div class="design-stage-actions">${designNotes(document)}<label class="design-frame-picker">Frame<select aria-label="Responsive frame" data-design-frame>${document.frames.map((frame) => `<option value="${escapeHtml(frame.id)}">${escapeHtml(frame.label)} · ${frame.width} × ${frame.height}</option>`).join("")}</select></label></div></div>
	  <div class="design-canvas-tools" role="group" aria-label="Canvas controls"><div class="planr-segment design-interaction-picker" role="group" aria-label="Review mode">${iconButton("Interact", "pointer", 'data-planr-mode="interact" aria-pressed="true" aria-keyshortcuts="I"')}${iconButton("Annotate", "comment", 'data-planr-mode="comment" aria-pressed="false" aria-keyshortcuts="C"')}</div><span></span>${button("−", 'data-design-zoom="out" aria-label="Zoom out"')}${button("100%", 'data-design-zoom="reset" aria-label="Reset zoom"')}${button("+", 'data-design-zoom="in" aria-label="Zoom in"')}<span></span>${button("Fit", 'data-design-fit aria-label="Fit all visible artboards"')}${button("Pan", 'data-design-pan aria-pressed="false" aria-label="Pan canvas" aria-keyshortcuts="H Space" title="Pan canvas (H). Hold Space to pan temporarily; Escape returns to Interact."')}</div>
  <div class="design-walkthrough-caption" hidden><div><span data-design-step></span><h2 data-design-narrative-title></h2><p data-design-narrative></p></div><div>${button("Previous", 'data-design-step-change="-1"')}${button("Next", 'data-design-step-change="1"')}</div></div>
  <div class="design-notice" role="status" aria-live="polite" hidden></div>`;
}

function directionDetails() {
	return `<section class="planr-domain-rail design-direction-review" data-planr-slot="domain-rail" aria-label="Direction review"><div><strong data-design-direction-label>Direction</strong><span data-design-selected-direction></span></div><div class="design-rating" role="group" aria-label="Rate this direction">${[1, 2, 3, 4, 5].map((rating) => button("☆", `data-design-rating="${rating}" aria-label="Rate ${rating} out of 5" aria-pressed="false"`)).join("")}</div>${button("Use this direction", "data-design-select-direction")}<details class="design-refinement"><summary>Refine this direction</summary><div><label for="design-remix">Refinement note<textarea id="design-remix" maxlength="8192" data-design-remix placeholder="What should change in the next iteration?"></textarea></label>${button("Save refinement note", "data-design-save-remix")}<p data-design-review-hint>Saved with your review for the next iteration.</p></div></details></section>`;
}

function earlierFeedback(pins) {
	if (!pins.length) return "";
	return `<section class="design-stale-feedback" aria-label="Earlier feedback"><details open><summary>Earlier feedback <span>${pins.length}</span></summary><p>These comments refer to an earlier revision or a missing anchor. Review them before resolving.</p>${pins.map((pin) => `<article data-design-stale-pin="${escapeHtml(pin.id)}"><div><strong>${escapeHtml(pin.screenId ?? pin.anchor?.screen ?? "Earlier screen")}</strong><span>Stale</span></div><p>${escapeHtml(pin.comment)}</p>${pin.anchor?.planrId ? `<small>Anchor: ${escapeHtml(pin.anchor.planrId)}</small>` : ""}</article>`).join("")}</details></section>`;
}

/**
 * Compose the design experience around the artifact-owned shell, source loader,
 * annotation controller and review rail. Rendering never serves or persists.
 *
 * Runtime adapter hooks: __OPENPLANR_DESIGN_STUDIO_OPTIONS__.saveState(state),
 * exportHtml({artifactId}), exportPng({artifactId}), and onReady(state).
 * saveState must reject on a conflict; UI retains the unsaved draft and surfaces
 * the failure instead of reporting it saved. The ordinary artifact review
 * controller remains the sole owner of pin, reply and overall-note mutations.
 */
export function renderDesignStudioMarkup(
	{
		document,
		envelope,
		entries,
		state = null,
		revision = null,
		verification = null,
		stalePins = [],
		reviewContext = null,
		contextDigest = null,
		fingerprints = [],
	} = {},
	{ stageRuntimeUrl = "./artifact-review-stage.js", renderShell, style = "", runtime = "" } = {},
) {
	if (!document || !envelope)
		throw new TypeError(
			"Design studio requires a design document and artifact envelope.",
		);
	const artifactIds = new Set(envelope.artifacts.map(({ id }) => id));
	for (const entry of entries) {
		if (
			!artifactIds.has(entry.artifactId) ||
			!document.screens.some(({ id }) => id === entry.screenId) ||
			!document.variants.some(
				({ id, status }) => id === entry.variantId && status === "ready",
			) ||
			!document.frames.some(({ id }) => id === entry.frameId)
		) {
			throw new TypeError(`Invalid design studio entry: ${entry.artifactId}.`);
		}
	}
	const activeEntry = entries.find(
		({ variantId, screenId, frameId }) =>
			variantId === document.selectedVariant &&
			screenId === document.screenOrder[0] &&
			frameId === document.frames[0].id,
	);
	if (!activeEntry)
		throw new TypeError(
			"Design studio requires the selected direction and first screen/frame.",
		);
	const payload = {
		schemaVersion: DESIGN_STUDIO_VERSION,
		document,
		entries,
		state,
		revision,
		verification,
		reviewContext,
		contextDigest,
		fingerprints,
		artifactKinds: Object.fromEntries(envelope.artifacts.map(artifact => [artifact.id, artifact.kind])),
		staticArtifacts: envelope.artifacts.filter(artifact => artifact.kind !== "html" || /\bdata-(?:design|planr)-static(?:\s|=|>)/u.test(artifact.html || "")).map(artifact => artifact.id),
	};
	let html = renderShell(
		{
			envelope,
			viewer: {
				mode: "single",
				presentation: "canvas",
				activeArtifactId: activeEntry.artifactId,
			},
			shell: {
				title: document.title,
				theme: "dark",
				railOpen: true,
				zoom: 100,
			},
		},
		{ stageRuntimeUrl },
	);
	// Design prototypes need native constraint validation and submit events for
	// local forms. Navigation still stays blocked by the artifact-owned
	// form-action 'none' CSP and rejection of action/formaction/target attributes;
	// generic artifact viewers retain their stricter allow-scripts sandbox.
	html = html.replace(
		/(<iframe\b[^>]*\bsandbox=")allow-scripts(")/g,
		"$1allow-scripts allow-forms$2",
	);
	html = html.replace(
		/<header class="planr-toolbar">[\s\S]*?<\/header>/,
		toolbar(document),
	);
	html = html.replace(
		'<div class="planr-workspace">',
		`<div class="planr-workspace">${navigator(document)}`,
	);
	html = html.replace(
		'<main class="planr-stage" aria-label="Artifact review stage">',
		`<main class="planr-stage" aria-label="Design canvas">${stageDetails(document)}`,
	);
	html = html.replace(
		/<section class="planr-domain-rail"[^>]*><\/section>/,
		directionDetails(),
	);
	html = html.replace("<h2>Review comments</h2>", "<h2>Review</h2>");
  html = html.replace('aria-label="Close comments">×', `aria-label="Close review" title="Close review">${icon("right")}`);
  html = html.replace('Overall note for the coding agent…', 'Summarize your review…');
	// The artifact runtime replaces the feedback slot when it mounts current
	// threads. Earlier-revision feedback must remain outside that owned region.
	html = html.replace(
		'<div class="planr-feedback-slot"',
		`${earlierFeedback(stalePins)}<div class="design-comment-action">${iconButton("Add comment", "comment", 'data-planr-action="add-comment" aria-pressed="false"')}</div><div class="planr-feedback-slot"`,
	);
	html = html.replace(
		'<html lang="en"',
		`<html lang="en" data-design-studio="${DESIGN_STUDIO_VERSION}" data-design-opening="true"`,
	);
	html = html.replace(
		"</head>",
		`<style>${style}</style><script>${designStudioThemeBootstrapSource()}</script></head>`,
	);
	html = html.replace(
		"</body>",
		`<script type="application/json" id="planr-design-studio-payload">${embedJson(payload)}</script><script>${designStudioThemeBootstrapSource()}</script><script>${runtime}</script></body>`,
	);
	return html;
}
