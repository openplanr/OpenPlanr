/* Design presentation composes the artifact stage. Pins remain artifact-owned. */
(() => {
	// biome-ignore lint/suspicious/noRedundantUseStrict: shipped as an inline classic script rather than an ES module
	"use strict";
	// Removing a pending classic script does not cancel its download. A canceled
	// hosted opening must not attach its runtime to a replacement review shell.
	if (document.currentScript && !document.currentScript.isConnected) return;
	const payloadNode = document.getElementById("planr-design-studio-payload");
	if (!payloadNode) return;
	const payload = JSON.parse(payloadNode.textContent);
	const design = payload.document;
	const entries = payload.entries;
	let options = globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ ?? {};
	const storageKey = `openplanr.design-studio.${design.id}`;
	const q = (selector) => document.querySelector(selector);
	const qa = (selector) => [...document.querySelectorAll(selector)];
	const clone = (value) => JSON.parse(JSON.stringify(value));
	const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
	const readyVariants = design.variants.filter(
		({ status }) => status === "ready",
	);
	const views = ["canvas", "prototype", "walkthrough"];
	const validId = (items, id, fallback) =>
		items.some((item) => (typeof item === "string" ? item : item.id) === id)
			? id
			: fallback;
	const normalizedViewport = (value) => {
		if (
			!Number.isFinite(value?.x) ||
			!Number.isFinite(value?.y) ||
			!Number.isFinite(value?.zoom)
		)
			return null;
		return {
			x: clamp(value.x, -1e7, 1e7),
			y: clamp(value.y, -1e7, 1e7),
			zoom: clamp(value.zoom, 0.05, 2),
		};
	};

	function normalizeState(input = {}) {
		const view = views.includes(input.view) ? input.view : design.defaultView;
		const viewports = {};
		for (const name of views) {
			const viewport = normalizedViewport(input.viewports?.[name]);
			if (viewport) viewports[name] = viewport;
		}
		const legacyViewport = Number.isFinite(input.zoom)
			? normalizedViewport({
					x: Number.isFinite(input.camera?.x) ? input.camera.x : 40,
					y: Number.isFinite(input.camera?.y) ? input.camera.y : 40,
					zoom: input.zoom,
				})
			: null;
		const activeViewport = viewports[view] ??
			legacyViewport ?? { x: 40, y: 40, zoom: 0.5 };
		const state = {
			schemaVersion: "1.1.0",
			view,
			screenId: validId(
				design.screenOrder,
				input.screenId,
				design.screenOrder[0],
			),
			frameId: validId(design.frames, input.frameId, design.frames[0].id),
			variantId: validId(
				readyVariants,
				input.variantId,
				design.selectedVariant,
			),
			selectedVariant: validId(
				readyVariants,
				input.selectedVariant,
				design.selectedVariant,
			),
			compare: Boolean(input.compare),
			navOpen: input.navOpen === undefined ? true : Boolean(input.navOpen),
			reviewOpen:
				input.reviewOpen === undefined ? true : Boolean(input.reviewOpen),
			zoom: activeViewport.zoom,
			camera: { x: activeViewport.x, y: activeViewport.y },
			viewports,
			positions: {},
			ratings: {},
			remix: {},
			preferences: { selected: [], rejected: [] },
		};
		for (const entry of entries) {
			const point = input.positions?.[entry.artifactId];
			if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
				state.positions[entry.artifactId] = {
					x: clamp(point.x, -1e7, 1e7),
					y: clamp(point.y, -1e7, 1e7),
				};
			}
		}
		for (const variant of readyVariants) {
			const rating = input.ratings?.[variant.id];
			if (Number.isInteger(rating) && rating >= 1 && rating <= 5)
				state.ratings[variant.id] = rating;
			if (typeof input.remix?.[variant.id] === "string")
				state.remix[variant.id] = input.remix[variant.id].slice(0, 8192);
		}
		for (const kind of ["selected", "rejected"]) {
			state.preferences[kind] = [
				...new Set(
					(Array.isArray(input.preferences?.[kind])
						? input.preferences[kind]
						: []
					).filter((id) => readyVariants.some((variant) => variant.id === id)),
				),
			];
		}
		return state;
	}

	let savedDraft = null;
	try {
		savedDraft = JSON.parse(localStorage.getItem(storageKey) ?? "null");
	} catch {
		/* Embedded exports may disallow storage. */
	}
	// Portable views supply only their initial view. Keep the rest of the saved
	// browser state; a live server replaces it with its authoritative GET below.
	let state = normalizeState({
		...(savedDraft?.state ?? {}),
		...(payload.state ?? {}),
	});
	let revision = payload.revision;
	let stateVersion = null;
	let stage = null;
	let root = null;
	let scroll = null;
	let surface = null;
	let grid = null;
	let canvasBackground = null;
	let cameraFrame = null;
	let selectionOutline = null;
	let dirty = false;
	let contentDirty = false;
	let contentSerial = 0;
	let reviewDirty = false;
	let reviewSerial = 0;
	let reviewSaving = Promise.resolve();
	let reviewTimer = null;
	let latestReview = null;
	let serial = 0;
	let saveTimer = null;
	let saving = Promise.resolve();
	let pollTimer = null;
	let noticeTimer = null;
	let readyReported = false;
	let destroyed = false;
	let panEnabled = false;
	let spacePan = false;
	let spaceReturnTool = null;
	let activeTool = "interact";
	let changingTool = false;
	let previousReviewMode = "interact";
	let gesture = null;
	let rendering = false;
	let previousStageZoom = 100;
	let compactViewport = false;
	let activeArtifactId = "";
	let walkthroughTransition = null;
	let pendingScreen = null, screenRequest = 0, frameDemandTimer = null;
	let frameDemandKey = "";
	let queuedSelection = null;
	let noteScreenId = null;
	let notesReturnFocus = null;
	const panels = new Map();
	const cleanup = [];

	function listen(target, event, handler, settings) {
		target?.addEventListener(event, handler, settings);
		cleanup.push(() => target?.removeEventListener(event, handler, settings));
	}

	function status(message, phase = "saved") {
		if (destroyed) return;
		const node = q("[data-design-save-state]");
		node.textContent = message;
		node.dataset.status = phase;
	}

	function notice(message, persistent = false) {
		if (destroyed) return;
		const node = q(".design-notice");
		clearTimeout(noticeTimer);
		node.textContent = message;
		node.hidden = false;
		if (!persistent)
			noticeTimer = setTimeout(() => {
				node.hidden = true;
			}, 6000);
	}

	function storeDraft() {
		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify({ revision, stateVersion, state, unsaved: contentDirty, personalPending: dirty && !contentDirty }),
			);
		} catch {
			/* Server persistence remains available when local storage is full. */
		}
	}

	async function jsonRequest(url, init = {}) {
		const response = await fetch(url, { credentials: "same-origin", ...init });
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error(
				result.error?.message ??
					result.error ??
					result.message ??
					`Save failed (${response.status}).`,
			);
			error.conflict = response.status === 409;
			throw error;
		}
		return result;
	}

	function persist({ content = false } = {}) {
		dirty = true;
		serial += 1;
		if (content) {
			contentDirty = true;
			contentSerial += 1;
			status("Saving changes", "saving");
		}
		storeDraft();
		root.dispatchEvent(
			new CustomEvent("planr:design-state-change", {
				bubbles: true,
				detail: clone(state),
			}),
		);
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 180);
	}

	function flushState() {
		clearTimeout(saveTimer);
		if (!dirty) return saving;
		const captured = clone(state);
		const capturedSerial = serial;
		const capturedContent = contentDirty;
		const capturedContentSerial = contentSerial;
		saving = saving
			.catch(() => {})
			.then(async () => {
				if (destroyed) return;
				try {
					let result;
					if (!capturedContent && typeof options.savePersonalState === "function") {
						result = await options.savePersonalState(captured, { revision, stateVersion });
					} else if (typeof options.saveState === "function") {
						result = await options.saveState(captured, {
							revision,
							stateVersion,
							personal: !capturedContent,
						});
					} else if (options.stateUrl) {
						result = await jsonRequest(options.stateUrl, {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ state: captured, revision, stateVersion }),
						});
					}
					if (result?.stateVersion !== undefined)
						stateVersion = result.stateVersion;
					if (result?.revision !== undefined) revision = result.revision;
					if (capturedSerial === serial) {
						dirty = false;
					}
					if (capturedContent && capturedContentSerial === contentSerial) {
						contentDirty = false;
						if (!reviewDirty)
							status(
								options.stateUrl || options.saveState
									? "All changes saved"
									: "Saved in this browser",
							);
					}
					storeDraft();
				} catch (error) {
					if (capturedContent) status(
						error.conflict ? "Save conflict" : "Disconnected · unsaved",
						error.conflict ? "failed" : "disconnected",
					);
					notice(
						!capturedContent
							? "Canvas preferences could not be synchronized. Your arrangement remains saved in this browser."
							: error.conflict
							? "This review changed in another window. Your unsaved edits remain in this browser. Reload to read the saved review before applying them again."
							: "Changes could not be saved. Your draft remains in this browser; reconnect to retry.",
						true,
					);
					storeDraft();
				}
			});
		return saving;
	}

	function reviewUrl() {
		return (
			options.reviewUrl ??
			(options.stateUrl
				? options.stateUrl.replace(/design-state$/, "review")
				: null)
		);
	}

	function storeReviewDraft() {
		if (!latestReview) return;
		try {
			localStorage.setItem(
				`${storageKey}.review`,
				JSON.stringify({ review: latestReview, unsaved: reviewDirty }),
			);
		} catch {
			/* Server remains authoritative. */
		}
	}

	function flushReview() {
		clearTimeout(reviewTimer);
		if (!reviewDirty || !latestReview) return reviewSaving;
		const captured = clone(latestReview);
		const capturedSerial = reviewSerial;
		reviewSaving = reviewSaving
			.catch(() => {})
			.then(async () => {
				try {
					if (reviewUrl())
						await jsonRequest(reviewUrl(), {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ review: captured }),
						});
					if (capturedSerial === reviewSerial) {
						reviewDirty = false;
						if (!contentDirty)
							status(
								reviewUrl() ? "All changes saved" : "Saved in this browser",
							);
					}
					storeReviewDraft();
				} catch (error) {
					status("Comments unsaved", "disconnected");
					notice(
						`Comments could not be saved: ${error.message} Your draft remains in this browser.`,
						true,
					);
					storeReviewDraft();
				}
			});
		return reviewSaving;
	}

	function flush() {
		return Promise.all([flushState(), flushReview()]);
	}

	function entryFor(
		screenId = state.screenId,
		variantId = state.variantId,
		frameId = state.frameId,
	) {
		return entries.find(
			(entry) =>
				entry.screenId === screenId &&
				entry.variantId === variantId &&
				entry.frameId === frameId,
		);
	}

	function visibleEntries() {
		return entries.filter(
			(entry) =>
				((state.view === "canvas" && state.compare) || entry.variantId === state.variantId) &&
				(state.view === "canvas" ||
					(entry.screenId === state.screenId &&
						entry.frameId === state.frameId)),
		);
	}

	function updatePan() {
		root.dataset.designPanActive = String(state.view === "canvas" && (panEnabled || spacePan));
		root.dataset.designTool = activeTool;
		root.dataset.designDragging = String(gesture?.mode === "pan");
		q("[data-design-pan]").setAttribute("aria-pressed", String(activeTool === "pan"));
		q('[data-planr-mode="interact"]').setAttribute("aria-pressed", String(activeTool === "interact"));
		q('[data-planr-mode="comment"]').setAttribute("aria-pressed", String(activeTool === "annotate"));
		q("[data-design-inspect-mode]")?.setAttribute("aria-pressed", String(activeTool === "inspect"));
		for (const [id, panel] of panels) {
			const frame = stage.getFrame(id);
			if (frame) {
				const tabIndex = activeTool === "interact" && !panel.hidden && stage.getState().status === "ready" ? 0 : -1;
				if (frame.tabIndex !== tabIndex) frame.tabIndex = tabIndex;
				frame.__openPlanrBridge?.setViewportGestures?.(state.view === "canvas" && !panel.hidden);
			}
		}
	}

	function finishGesture() {
		if (!gesture) return;
		const pointerId = gesture.pointerId;
		gesture = null;
		// Clear our state first: releasing capture can synchronously notify listeners.
		try { if (scroll.hasPointerCapture?.(pointerId)) scroll.releasePointerCapture(pointerId); } catch { /* Already canceled by the browser. */ }
		updatePan();
		persist();
	}

	function setTool(tool) {
		if (!["interact", "annotate", "pan", "inspect"].includes(tool)) return;
		if (tool === "pan" && state.view !== "canvas") return;
		if (tool === "annotate" && root.hasAttribute("data-planr-room-comments-paused")) return;
		finishWalkthroughTransition();
		finishGesture();
		spacePan = false;
		spaceReturnTool = null;
		activeTool = tool;
		panEnabled = tool === "pan";
		previousReviewMode = tool === "annotate" ? "comment" : "interact";
		changingTool = true;
		try { stage.dispatch({ type: "set-review-mode", reviewMode: previousReviewMode }); }
		finally { changingTool = false; }
		root.dispatchEvent(new CustomEvent("planr:design-tool-change", { detail: { tool } }));
		updatePan();
	}

	function releaseTemporaryPan() {
		const previous = spaceReturnTool;
		finishGesture();
		if (spacePan) setTool(previous || "interact");
	}

	function saveViewport() {
		state.viewports[state.view] = {
			x: state.camera.x,
			y: state.camera.y,
			zoom: state.zoom,
		};
	}

	function restoreViewport(view) {
		const viewport = state.viewports[view];
		if (!viewport) return false;
		state.camera = { x: viewport.x, y: viewport.y };
		state.zoom = viewport.zoom;
		return true;
	}

	function switchView(view, { save = true } = {}) {
		if (!views.includes(view))
			throw new TypeError(`Unknown design view: ${view}`);
		if (view === state.view) return;
		++screenRequest; pendingScreen = null; delete root.dataset.designScreenLoading;
		finishWalkthroughTransition();
		closeDesignNotes();
		saveViewport();
		state.view = view;
		setTool(view === "canvas" && activeTool === "annotate" ? "annotate" : "interact");
		// Enter a focused viewer with product interaction, not a carried-over pin
		// or inspector cursor. Drafts stay in the review controller untouched.
		root.dispatchEvent(new CustomEvent("planr:design-view-change", { detail: { view } }));
		const restored = view === "canvas" && restoreViewport(view);
		render();
		if (!restored) fit({ save: false });
		if (save) persist();
	}

	function defaultPosition(entry, variant) {
		const gap = 96;
		const top = 72;
		const frame = design.frames.find(({ id }) => id === entry.frameId);
		const variants = state.compare ? readyVariants : [variant];
		const variantIndex = variants.findIndex(({ id }) => id === entry.variantId);
		const groupWidth =
			design.frames.reduce((sum, item) => sum + item.width, 0) +
			gap * Math.max(0, design.frames.length - 1) +
			160;
		return {
			x:
				variantIndex * groupWidth +
				design.frames
					.slice(0, design.frames.indexOf(frame))
					.reduce((sum, item) => sum + item.width + gap, 0),
			y:
				top +
				design.screenOrder.indexOf(entry.screenId) *
					(Math.max(...design.frames.map(({ height }) => height)) + 176),
		};
	}

	function contentBounds(selection = null) {
		const visible = selection ? [selection] : visibleEntries();
		if (!visible.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
		return visible.reduce(
			(bounds, entry) => {
				const panel = panels.get(entry.artifactId);
				const frame = design.frames.find(({ id }) => id === entry.frameId);
				const x = Number.parseFloat(panel.style.left) || 0;
				const y = Number.parseFloat(panel.style.top) || 0;
				bounds.minX = Math.min(bounds.minX, x);
				bounds.minY = Math.min(bounds.minY, y - 64);
				bounds.maxX = Math.max(bounds.maxX, x + frame.width);
				bounds.maxY = Math.max(bounds.maxY, y + frame.height);
				return bounds;
			},
			{ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
		);
	}

	function centerEntry(entry) {
		const panel = panels.get(entry.artifactId);
		const frame = design.frames.find(({ id }) => id === entry.frameId);
		const x = Number.parseFloat(panel.style.left) || 0;
		const y = Number.parseFloat(panel.style.top) || 0;
		state.camera = {
			x: scroll.clientWidth / 2 - (x + frame.width / 2) * state.zoom,
			y: scroll.clientHeight / 2 - (y + frame.height / 2) * state.zoom,
		};
		saveViewport();
		render();
	}

	function updateDesignNotes() {
		const notes = q("[data-design-notes]");
		if (!notes) return;
		notes.querySelector(":scope > summary").setAttribute("aria-expanded", String(notes.open));
		for (const button of qa("[data-design-note]"))
			button.setAttribute("aria-expanded", String(notes.open && button.dataset.designNote === noteScreenId));
		if (!notes.open) return;
		const panel = q(".design-guidance-panel");
		const anchor = notes.querySelector(":scope > summary").getBoundingClientRect();
		const width = panel.getBoundingClientRect().width || Math.min(340, window.innerWidth - 24);
		const top = clamp(anchor.bottom + 7, 12, Math.max(12, window.innerHeight - 100));
		panel.style.left = `${clamp(anchor.right - width, 12, Math.max(12, window.innerWidth - width - 12))}px`;
		panel.style.top = `${top}px`;
		panel.style.maxHeight = `${Math.min(520, Math.max(60, window.innerHeight - top - 12))}px`;
	}

	function closeDesignNotes({ restoreFocus = false } = {}) {
		const notes = q("[data-design-notes]");
		if (!notes?.open) return;
		notes.open = false;
		noteScreenId = null;
		updateDesignNotes();
		if (restoreFocus) {
			const target = notesReturnFocus?.isConnected ? notesReturnFocus : notes.querySelector(":scope > summary");
			target?.focus({ preventScroll: true });
		}
		notesReturnFocus = null;
	}

	function openDesignNote(screenId, trigger) {
		const notes = q("[data-design-notes]");
		if (!notes) return;
		if (notes.open && noteScreenId === screenId) {
			closeDesignNotes();
			return;
		}
		notesReturnFocus = trigger;
		noteScreenId = screenId;
		notes.open = true;
		let target = null;
		for (const item of qa("[data-design-note-screen]")) {
			const selected = item.dataset.designNoteScreen === screenId;
			item.open = selected;
			item.dataset.active = String(selected);
			if (selected) target = item;
		}
		updateDesignNotes();
		const panel = q(".design-guidance-panel");
		if (target) panel.scrollTop = Math.max(0, target.offsetTop - panel.querySelector("header").offsetHeight);
	}

	function render() {
		if (!stage || rendering || destroyed) return;
		rendering = true;
		try {
			if (window.innerWidth <= 680)
				root.style.setProperty("--planr-toolbar-height", `${q(".design-toolbar").getBoundingClientRect().height}px`);
			else root.style.removeProperty("--planr-toolbar-height");
			const screen = design.screens.find(({ id }) => id === state.screenId);
			const variant = design.variants.find(({ id }) => id === state.variantId);
			const stageState = stage.getState();
			root.dataset.designView = state.view;
			root.dataset.designNavOpen = String(state.navOpen);
			const navigator = q(".design-navigator");
			navigator.inert = !state.navOpen;
			navigator.setAttribute("aria-hidden", String(!state.navOpen));
			for (const toggle of qa("[data-design-toggle-nav]"))
        toggle.setAttribute("aria-expanded", String(state.navOpen));
			for (const button of qa("[data-design-view]")) {
				if (button.tagName === "BUTTON")
					button.setAttribute(
						"aria-pressed",
						String(button.dataset.designView === state.view),
					);
			}
			for (const button of qa("[data-design-screen]"))
				button.setAttribute(
					"aria-current",
					button.dataset.designScreen === state.screenId ? "page" : "false",
				);
			q("[data-design-variant]").value = state.variantId;
			q("[data-design-frame]").value = state.frameId;
			if (q("[data-design-compare]"))
				q("[data-design-compare]").checked = state.compare;
			q("[data-design-screen-title]").textContent =
				state.view === "canvas" ? design.title : screen.title;
			q("[data-design-stage-description]").textContent =
				state.view === "canvas"
					? `${design.screenOrder.length} screens · ${design.frames.length} responsive ${design.frames.length === 1 ? "frame" : "frames"}${state.compare ? ` · ${readyVariants.length} directions` : ""}`
					: state.view === "prototype"
						? "Explore the working journey"
						: "A guided journey through the design";
			q("[data-design-direction-label]").textContent = variant.label;
			const chosen =
				state.selectedVariant === state.variantId &&
				state.preferences.selected.includes(state.variantId);
			q("[data-design-selected-direction]").textContent = chosen
				? "Selected"
				: "";
			q("[data-design-select-direction]").disabled = chosen;
			q("[data-design-select-direction]").textContent = chosen
				? "Selected direction"
				: "Use this direction";
			for (const button of qa("[data-design-rating]")) {
				const selected =
					Number(button.dataset.designRating) <=
					(state.ratings[state.variantId] ?? 0);
				button.setAttribute("aria-pressed", String(selected));
				button.textContent = selected ? "★" : "☆";
			}
			if (document.activeElement !== q("[data-design-remix]"))
				q("[data-design-remix]").value = state.remix[state.variantId] ?? "";
			q("[data-design-pan]").hidden = state.view !== "canvas";
			for (const control of qa("[data-design-zoom]")) control.hidden = state.view !== "canvas";
			q(".design-canvas-tools").setAttribute("aria-label", state.view === "canvas" ? "Canvas controls" : "Screen controls");
			const fitControl = q("[data-design-fit]");
			fitControl.textContent = state.view === "canvas" ? "Fit" : "Fit screen";
			fitControl.setAttribute("aria-label", state.view === "canvas" ? "Fit all visible artboards" : "Fit screen");
			const comparison = q("[data-design-compare]");
			if (comparison) comparison.closest("label").hidden = state.view !== "canvas";
			const caption = q(".design-walkthrough-caption");
			caption.hidden = state.view !== "walkthrough";
			q("[data-design-step]").textContent =
				`Step ${design.screenOrder.indexOf(state.screenId) + 1} of ${design.screenOrder.length}`;
			q("[data-design-narrative-title]").textContent = screen.title;
			q("[data-design-narrative]").textContent =
				screen.description ??
				design.flows?.find((flow) => flow.screens.includes(screen.id))?.title ??
				design.brief.text;
			q('[data-design-step-change="-1"]').disabled =
				requestedScreen() === design.screenOrder[0];
			q('[data-design-step-change="1"]').disabled =
				requestedScreen() === design.screenOrder.at(-1);
			for (const item of qa("[data-design-note-screen]"))
				item.dataset.active = String(
					item.dataset.designNoteScreen === state.screenId,
				);

			const visible = visibleEntries();
			const visibleIds = new Set(visible.map(({ artifactId }) => artifactId));
			for (const entry of entries) {
				const panel = panels.get(entry.artifactId);
				const isVisible = visibleIds.has(entry.artifactId);
				const outgoing = walkthroughTransition?.from === entry.artifactId;
				panel.hidden = !isVisible && !outgoing;
				panel.dataset.designActive = String(
					entry.artifactId === activeArtifactId,
				);
				const frameElement = stage.getFrame(entry.artifactId);
				const layer = panel.querySelector("[data-planr-annotation-layer]");
				const ready = stageState.status === "ready" && (!stage.frameBudget || frameElement.dataset.planrFrameState === "ready");
				frameElement.tabIndex =
					isVisible && ready && stageState.reviewMode === "interact" ? 0 : -1;
				layer.tabIndex =
					isVisible && ready && stageState.reviewMode === "comment" ? 0 : -1;
				layer.setAttribute("aria-disabled", String(layer.tabIndex < 0));
				if (!isVisible && !outgoing) continue;
				let { x, y } = defaultPosition(entry, variant);
				if (state.view === "canvas")
					({ x, y } = state.positions[entry.artifactId] ?? { x, y });
				else {
					x = 0;
					y = 0;
				}
				panel.style.left = `${x}px`;
				panel.style.top = `${y}px`;
			}
			grid.style.width = "1px";
			grid.style.height = "1px";
			surface.style.width = "100%";
			surface.style.height = "100%";
			updatePan();
			renderCamera();
			root.dispatchEvent(new CustomEvent("planr:design-render", { detail: clone(state) }));
		} finally {
			rendering = false;
		}
	}

	// Moving the viewport must not rewrite artboard visibility, geometry or frame
	// focus state. Those belong to structural renders; the compositor owns motion.
	function scheduleCamera() {
		if (cameraFrame !== null || destroyed) return;
		cameraFrame = requestAnimationFrame(() => { cameraFrame = null; renderCamera(); });
	}
	function renderCamera() {
		if (!stage || destroyed) return;
		if (cameraFrame !== null) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
		if (state.view !== "canvas") {
			// A focused view has no navigable world: fit the authored frame inside
			// its viewport. Scrolling and gestures within the iframe remain native.
			const frame = design.frames.find(item => item.id === state.frameId);
			const inset = window.innerWidth <= 680 ? 12 : 24;
			state.zoom = Math.max(0.001, Math.min(1,
				Math.max(1, scroll.clientWidth - inset * 2) / frame.width,
				Math.max(1, scroll.clientHeight - inset * 2) / frame.height));
			state.camera = { x: (scroll.clientWidth - frame.width * state.zoom) / 2,
				y: (scroll.clientHeight - frame.height * state.zoom) / 2 };
			saveViewport();
		}
		const zoom = String(state.zoom);
		if (grid.style.getPropertyValue("--design-zoom") !== zoom)
			grid.style.setProperty("--design-zoom", zoom);
		grid.style.transform = `translate3d(${state.camera.x}px, ${state.camera.y}px, 0) scale(${state.zoom})`;
		// Translate a bounded background layer rather than invalidating inherited
		// properties on the entire shell or repainting its full stage background.
		const pixelRatio = window.devicePixelRatio || 1;
		const backgroundOffset = value => Math.round((value % 24) * pixelRatio) / pixelRatio;
		canvasBackground.style.transform = `translate3d(${backgroundOffset(state.camera.x)}px, ${backgroundOffset(state.camera.y)}px, 0)`;
		const active = entries.find(entry => entry.artifactId === activeArtifactId);
		const panel = panels.get(activeArtifactId);
		if (selectionOutline) {
			selectionOutline.hidden = state.view !== "canvas" || !active || !panel || panel.hidden;
			if (!selectionOutline.hidden) {
				const frame = design.frames.find(item => item.id === active.frameId);
				const ratio = window.devicePixelRatio || 1;
				const pixel = value => Math.round(value * ratio) / ratio;
				const x = pixel(state.camera.x + Number.parseFloat(panel.style.left) * state.zoom);
				const y = pixel(state.camera.y + Number.parseFloat(panel.style.top) * state.zoom);
				selectionOutline.style.transform = `translate3d(${x - 3}px, ${y - 3}px, 0)`;
				selectionOutline.style.width = `${pixel(frame.width * state.zoom) + 6}px`;
				selectionOutline.style.height = `${pixel(frame.height * state.zoom) + 6}px`;
			}
		}
		const label = `${Math.round(state.zoom * 100)}%`;
		const reset = q('[data-design-zoom="reset"]');
		if (reset.textContent !== label) reset.textContent = label;
		scheduleFrameDemand();
		root.dispatchEvent(new CustomEvent("planr:design-camera", { detail: { view: state.view, zoom: state.zoom, camera: { ...state.camera } } }));
	}

	function updateFramePlaceholders() {
		if (!stage?.frameBudget || destroyed) return;
		for (const [id, panel] of panels) {
			const frame = stage.getFrame(id), placeholder = panel.querySelector('[data-design-load-frame]');
			if (!placeholder) continue;
			const status = frame.dataset.planrFrameState || 'unloaded';
			placeholder.hidden = status === 'ready';
			placeholder.disabled = status === 'loading';
			const copy = status === 'loading' ? 'Loading screen…' : status === 'error' ? 'Retry screen' : 'Open screen';
			if (placeholder.textContent !== copy) placeholder.textContent = copy;
			frame.style.visibility = status === 'ready' ? '' : 'hidden';
		}
	}
	function scheduleFrameDemand() {
		if (!stage?.frameBudget || destroyed) return;
		clearTimeout(frameDemandTimer);
		frameDemandTimer = setTimeout(() => {
			if (destroyed || !readyReported || pendingScreen || walkthroughTransition || state.view !== 'canvas'
				|| root.dataset.sharedOpening || document.querySelector('.design-welcome[open]')) return;
			const box = scroll.getBoundingClientRect();
			const nearby = visibleEntries().map(entry => {
				const rect = panels.get(entry.artifactId).getBoundingClientRect();
				return { id:entry.artifactId, visible:rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom,
					distance:Math.hypot((rect.left+rect.right-box.left-box.right)/2,(rect.top+rect.bottom-box.top-box.bottom)/2) };
			}).filter(item=>item.visible).sort((a,b)=>a.distance-b.distance);
			const ids = [...new Set([activeArtifactId,...nearby.map(item=>item.id)].filter(Boolean))].slice(0,stage.frameBudget);
			const key = ids.join('|'); if(key === frameDemandKey) return; frameDemandKey = key;
			void stage.ensureFrames(ids).then(updateFramePlaceholders).catch(error=>{
				if (!destroyed && error.name !== 'AbortError') { frameDemandKey=''; updateFramePlaceholders(); }
			});
		}, 120);
	}

	// A display:none iframe has no painted layer. Keep the previous screen in
	// place while the next one's existing frame lays out, then reveal it above
	// that fully opaque backing. Never clone/reload authored DOM or fade both
	// screens out together: that exposes the stage as a flash between steps.
	function finishWalkthroughTransition({ continueQueued = false } = {}) {
		const transition = walkthroughTransition;
		const queued = continueQueued ? queuedSelection : null;
		queuedSelection = null;
		if (!transition) return;
		walkthroughTransition = null;
		cancelAnimationFrame(transition.frame);
		clearTimeout(transition.timeout);
		for (const animation of transition.animations ?? []) animation.cancel();
		for (const visual of transition.visuals ?? []) delete visual.dataset.designTransitionVisual;
		for (const id of [transition.from, transition.to]) {
			const panel = panels.get(id);
			panel.inert = false;
			panel.removeAttribute("aria-hidden");
			delete panel.dataset.designTransitionOutgoing;
			delete panel.dataset.designTransitionIncoming;
		}
		delete root.dataset.designTransition;
		render();
		if (queued && !destroyed) selectEntry(queued.entry, queued.settings);
	}

	function prepareWalkthroughTransition(entry) {
		const from = activeArtifactId;
		const outgoing = panels.get(from);
		const incoming = panels.get(entry.artifactId);
		const direction = design.screenOrder.indexOf(entry.screenId) < design.screenOrder.indexOf(state.screenId) ? -1 : 1;
		const transition = { from, to: entry.artifactId, direction, frame: null, timeout: null, animations: [], visuals: [] };
		walkthroughTransition = transition;
		root.dataset.designTransition = "preparing";
		outgoing.dataset.designTransitionOutgoing = "";
		incoming.dataset.designTransitionIncoming = "";
		if (outgoing.contains(document.activeElement))
			q(`[data-design-step-change="${direction}"]`).focus({ preventScroll: true });
		outgoing.inert = incoming.inert = true;
		outgoing.setAttribute("aria-hidden", "true");
		const finish = () => {
			if (walkthroughTransition === transition) finishWalkthroughTransition({ continueQueued: true });
		};
		// Background tabs and interrupted animations must never leave an inert
		// screen behind. The deadline only settles; it never starts late motion.
		transition.timeout = setTimeout(finish, 1000);
		transition.frame = requestAnimationFrame(() => {
			transition.frame = requestAnimationFrame(() => {
				if (walkthroughTransition !== transition || destroyed) return;
				if (document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || typeof incoming.animate !== "function") {
					finish();
					return;
				}
				root.dataset.designTransition = "running";
				const frameVisual = incoming.querySelector(".planr-frame iframe");
				const annotationVisual = incoming.querySelector("[data-planr-annotation-layer]");
				transition.visuals = [frameVisual, annotationVisual].filter(Boolean);
				for (const visual of transition.visuals) visual.dataset.designTransitionVisual = "";
				const options = { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" };
				transition.animations = [frameVisual.animate([
					{ opacity: 0, transform: `translate3d(${direction * 12 / state.zoom}px, 0, 0)` },
					{ opacity: 1, transform: "translate3d(0, 0, 0)" },
				], options)];
				if (annotationVisual) transition.animations.push(annotationVisual.animate([
					{ opacity: 0 },
					{ opacity: 1 },
				], options));
				Promise.all(transition.animations.map(animation => animation.finished)).then(finish, () => {});
			});
		});
	}

	function requestedScreen() {
		return pendingScreen?.entry.screenId ?? queuedSelection?.entry.screenId ?? state.screenId;
	}

	function selectEntry(entry, { save = true, reveal = false, loaded = false } = {}) {
		if (!entry) return false;
		if (stage.frameBudget && !loaded && (pendingScreen || !stage.getLoadedArtifactIds().includes(entry.artifactId))) {
			if (pendingScreen?.entry.artifactId === entry.artifactId) return true;
			const request = ++screenRequest;
			pendingScreen = { entry }; root.dataset.designScreenLoading = 'true';
			const ids = [...new Set([activeArtifactId,entry.artifactId].filter(Boolean))];
			void stage.ensureFrames(ids).then(() => {
				if (destroyed || request !== screenRequest) return;
				pendingScreen = null; delete root.dataset.designScreenLoading;
				selectEntry(entry, { save, reveal, loaded:true }); updateFramePlaceholders();
			}).catch(error => {
				if (destroyed || request !== screenRequest || error.name === 'AbortError') return;
				pendingScreen = null; delete root.dataset.designScreenLoading;
				notice('This screen could not load. Select it again to retry; your review is preserved.',true);
				updateFramePlaceholders();
			});
			return true;
		}
		const sameFrame = entry.frameId === state.frameId && entry.variantId === state.variantId;
		if (walkthroughTransition && state.view === "walkthrough" && sameFrame) {
			// Coalesce rapid requests instead of cutting an animation halfway or
			// ignoring clicks. Subsequent step buttons advance from this target.
			queuedSelection = entry.artifactId === activeArtifactId ? null : { entry, settings: { save, reveal } };
			q('[data-design-step-change="-1"]').disabled = requestedScreen() === design.screenOrder[0];
			q('[data-design-step-change="1"]').disabled = requestedScreen() === design.screenOrder.at(-1);
			return true;
		}
		finishWalkthroughTransition();
		if (state.view === "walkthrough" && sameFrame && readyReported && entry.artifactId !== activeArtifactId && !document.hidden)
			prepareWalkthroughTransition(entry);
		state.screenId = entry.screenId;
		state.frameId = entry.frameId;
		state.variantId = entry.variantId;
		activeArtifactId = entry.artifactId;
		stage.dispatch({ type: "set-active", artifactId: entry.artifactId });
		render();
		if (reveal) centerEntry(entry);
		if (save) persist();
		return true;
	}

	function fit({ save = true, selection = null } = {}) {
		render();
		if (state.view !== "canvas") { if (save) persist(); return; }
		const bounds = contentBounds(selection);
		const width = Math.max(1, bounds.maxX - bounds.minX);
		const height = Math.max(1, bounds.maxY - bounds.minY);
		const availableWidth = Math.max(100, scroll.clientWidth - 96);
		const availableHeight = Math.max(100, scroll.clientHeight - 96);
		state.zoom = clamp(
			Math.min(
				availableWidth / Math.max(1, width),
				availableHeight / Math.max(1, height),
			),
			0.05,
			1,
		);
		state.camera = {
			x:
				(scroll.clientWidth - width * state.zoom) / 2 -
				bounds.minX * state.zoom,
			y:
				(scroll.clientHeight - height * state.zoom) / 2 -
				bounds.minY * state.zoom,
		};
		saveViewport();
		renderCamera();
		if (save) persist();
	}

	function zoomTo(value, point = null, { scheduled = false } = {}) {
		if (state.view !== "canvas") return;
		const previous = state.zoom;
		const next = clamp(value, 0.05, 2);
		const rect = scroll.getBoundingClientRect();
		const x = point ? point.x - rect.left : scroll.clientWidth / 2;
		const y = point ? point.y - rect.top : scroll.clientHeight / 2;
		state.camera = {
			x: x - ((x - state.camera.x) * next) / previous,
			y: y - ((y - state.camera.y) * next) / previous,
		};
		state.zoom = next;
		saveViewport();
		if (scheduled) scheduleCamera(); else renderCamera();
		persist();
	}

	async function exportArtifact(kind) {
		const artifactId = activeArtifactId;
		try {
			let blob;
			if (kind === "png") {
				const result =
					typeof options.exportPng === "function"
						? await options.exportPng({ artifactId })
						: await stage
								.getFrame(artifactId)
								?.__openPlanrBridge?.exportPng("screen");
				const dataUrl = typeof result === "string" ? result : result?.dataUrl;
				if (!dataUrl?.startsWith("data:image/png;base64,"))
					throw new Error(
						"PNG capture is unavailable. Open the local review with the artifact bridge and retry.",
					);
				const bytes = Uint8Array.from(
					atob(dataUrl.split(",")[1]),
					(character) => character.charCodeAt(0),
				);
				blob = new Blob([bytes], { type: "image/png" });
			} else {
				const result =
					typeof options.exportHtml === "function"
						? await options.exportHtml({ artifactId })
						: null;
				if (result instanceof Blob) blob = result;
				else if (typeof result === "string")
					blob = new Blob([result], { type: "text/html;charset=utf-8" });
				else
					throw new Error(
						"Portable export is unavailable in this viewer. Use the design export utility from the project.",
					);
			}
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${design.id}-${state.screenId}.${kind === "png" ? "png" : "html"}`;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			q(".design-export").open = false;
			notice(
				kind === "png" ? "Screen PNG exported." : "Portable HTML exported.",
			);
		} catch (error) {
			notice(error.message, true);
		}
	}

	function editable(target) {
		return Boolean(
			target?.closest?.('input,textarea,select,[contenteditable="true"]'),
		);
	}

	function installEvents() {
		listen(root, "planr:artifact-viewport-zoom", event => {
			if (state.view !== "canvas") return;
			const entry = entries.find(item => stage.getFrame(item.artifactId) === event.target);
			if (!entry || panels.get(entry.artifactId)?.hidden) return;
			const { x, y, deltaY } = event.detail;
			const frame = design.frames.find(item => item.id === entry.frameId);
			const rect = event.target.getBoundingClientRect();
			zoomTo(state.zoom * Math.exp(-deltaY * 0.004), {
				x: rect.left + x * rect.width / frame.width,
				y: rect.top + y * rect.height / frame.height,
			}, { scheduled: true });
		});
		listen(root, "planr:artifact-viewport-pan", event => {
			if (state.view !== "canvas") return;
			const entry = entries.find(item => stage.getFrame(item.artifactId) === event.target);
			if (!entry || panels.get(entry.artifactId)?.hidden) return;
			state.camera = {
				x: clamp(state.camera.x - event.detail.deltaX, -1e7, 1e7),
				y: clamp(state.camera.y - event.detail.deltaY, -1e7, 1e7),
			};
			saveViewport();
			scheduleCamera();
			persist();
		});
		// Handle explicit choices even when the generic stage's reviewMode has not
		// changed (Pan and Inspect both suspend the stage in interact mode).
		listen(root, "click", event => {
			const button = event.target.closest('[data-planr-mode],[data-planr-action="add-comment"]');
			if (!button || button.disabled) return;
			setTool(button.dataset.planrMode === "interact" ? "interact" : "annotate");
		}, true);
		listen(document, "keydown", event => {
			if (editable(event.target) || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
			const key = event.key.toLowerCase();
			if (["i", "c", "h"].includes(key)) {
				if (key === "h" && state.view !== "canvas") return;
				event.preventDefault();
				setTool({ i: "interact", c: "annotate", h: "pan" }[key]);
			} else if (event.key === "Escape" && (panEnabled || spacePan || gesture || activeTool === "inspect")
				&& !q('[data-design-notes][open]') && !q('[data-planr-annotation-composer]')) {
				event.preventDefault();
				setTool("interact");
				q('[data-planr-mode="interact"]').focus();
			}
		}, true);
    // Sidebar transitions resize the stage without a window resize. Refit only
    // the focused views; the free canvas retains its personal camera position.
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        if (state.view !== "canvas" && root.dataset.designRestoring !== "true") fit({ save: false });
        updateDesignNotes();
      });
      observer.observe(scroll);
      cleanup.push(() => observer.disconnect());
    }
		const notes = q("[data-design-notes]");
		listen(notes?.querySelector(":scope > summary"), "click", (event) => {
			event.preventDefault();
			if (notes.open) closeDesignNotes();
			else {
				notesReturnFocus = event.currentTarget;
				notes.open = true;
				updateDesignNotes();
			}
		});
		listen(notes, "toggle", updateDesignNotes);
		listen(document, "pointerdown", (event) => {
			if (notes?.open && !notes.contains(event.target) && !event.target.closest?.("[data-design-note]")) closeDesignNotes();
		}, true);
		listen(document, "keydown", (event) => {
			if (event.key === "Escape" && notes?.open) {
				event.preventDefault();
				event.stopPropagation();
				closeDesignNotes({ restoreFocus: true });
			}
		}, true);
		listen(root, "click", (event) => {
			const button = event.target.closest("button");
			if (!button) return;
			if (button.dataset.designLoadFrame) {
				selectEntry(entries.find(item=>item.artifactId===button.dataset.designLoadFrame),{reveal:true});
			} else if (button.dataset.designView) {
				switchView(button.dataset.designView);
			} else if (button.hasAttribute("data-design-toggle-nav")) {
				state.navOpen = !state.navOpen;
        if (!state.navOpen && button.closest(".design-navigator"))
          q(".design-toolbar [data-design-toggle-nav]").focus();
				render();
				persist();
			} else if (button.dataset.designScreen) {
				selectEntry(entryFor(button.dataset.designScreen), {
					reveal: state.view === "canvas",
				});
			} else if (button.dataset.designNote) {
				openDesignNote(button.dataset.designNote, button);
			} else if (button.hasAttribute("data-design-close-notes")) {
				closeDesignNotes({ restoreFocus: true });
			} else if (button.hasAttribute("data-design-fit")) fit();
			else if (button.dataset.designZoom)
				zoomTo(
					button.dataset.designZoom === "reset"
						? 1
						: state.zoom * (button.dataset.designZoom === "in" ? 1.2 : 1 / 1.2),
				);
			else if (button.hasAttribute("data-design-pan")) {
				if (state.view !== "canvas") return;
				setTool(activeTool === "pan" ? "interact" : "pan");
			} else if (button.dataset.designStepChange) {
				const index = clamp(
					design.screenOrder.indexOf(requestedScreen()) +
						Number(button.dataset.designStepChange),
					0,
					design.screenOrder.length - 1,
				);
				selectEntry(entryFor(design.screenOrder[index]));
			} else if (button.dataset.designRating) {
				const rating = Number(button.dataset.designRating);
				state.ratings[state.variantId] = rating;
				if (rating <= 2)
					state.preferences.rejected = [
						...new Set([...state.preferences.rejected, state.variantId]),
					];
				else
					state.preferences.rejected = state.preferences.rejected.filter(
						(id) => id !== state.variantId,
					);
				render();
				persist({ content: true });
			} else if (button.hasAttribute("data-design-select-direction")) {
				state.selectedVariant = state.variantId;
				state.preferences.selected = [
					...new Set([...state.preferences.selected, state.variantId]),
				];
				state.preferences.rejected = state.preferences.rejected.filter(
					(id) => id !== state.variantId,
				);
				render();
				persist({ content: true });
			} else if (button.hasAttribute("data-design-save-remix")) {
				state.remix[state.variantId] = q("[data-design-remix]").value.trim();
				persist({ content: true });
				notice("Refinement note saved for the next design iteration.");
			} else if (button.dataset.designExport)
				void exportArtifact(button.dataset.designExport);
		});
		listen(q("[data-design-variant]"), "change", (event) =>
			selectEntry(entryFor(state.screenId, event.target.value)),
		);
		listen(q("[data-design-frame]"), "change", (event) => {
			selectEntry(
				entryFor(state.screenId, state.variantId, event.target.value),
				{ reveal: state.view === "canvas" },
			);
		});
		listen(q("[data-design-compare]"), "change", (event) => {
			state.compare = event.target.checked;
			render();
			persist();
		});
		listen(root, "planr:stage-change", (event) => {
			const next = event.detail;
			if (!changingTool && next.reviewMode !== previousReviewMode) setTool(next.reviewMode === "comment" ? "annotate" : "interact");
			const reviewChanged =
				typeof next.railOpen === "boolean" &&
				next.railOpen !== state.reviewOpen;
			if (reviewChanged) state.reviewOpen = next.railOpen;
			const entry = entries.find(
				({ artifactId }) => artifactId === next.activeArtifactId,
			);
			if (entry && entry.artifactId !== activeArtifactId) {
				if (stage.frameBudget && !stage.getLoadedArtifactIds().includes(entry.artifactId)) {
					selectEntry(entry, {save:false});
				} else {
					finishWalkthroughTransition();
					activeArtifactId = entry.artifactId;
					state.screenId = entry.screenId;
					state.frameId = entry.frameId;
					state.variantId = entry.variantId;
				}
			}
			if (next.zoom !== previousStageZoom) {
				state.zoom = clamp(next.zoom / 100, 0.05, 2);
				previousStageZoom = next.zoom;
				saveViewport();
			}
			render();
			if (reviewChanged) persist();
		});
		listen(root, "planr:artifact-review-change", (event) => {
			latestReview = clone(event.detail);
			reviewDirty = true;
			reviewSerial += 1;
			status("Saving comments", "saving");
			storeReviewDraft();
			clearTimeout(reviewTimer);
			reviewTimer = setTimeout(flushReview, 180);
		});
		// Capturing activation lets the artifact-owned pin controller annotate any
		// artboard in the canvas while preserving its active-artifact invariant.
		listen(
			root,
			"pointerdown",
			(event) => {
				const panel = event.target.closest(".planr-artifact-panel");
				if (event.button === 0 && panel && !panEnabled && !spacePan) {
					selectEntry(
						entries.find(
							({ artifactId }) => artifactId === panel.dataset.artifactId,
						),
						{ save: false },
					);
				}
			},
			true,
		);
		listen(
			scroll,
			"wheel",
			(event) => {
				if (state.view !== "canvas") return;
				event.preventDefault();
				if (event.ctrlKey || event.metaKey) {
					zoomTo(state.zoom * Math.exp(-event.deltaY * 0.004), {
						x: event.clientX,
						y: event.clientY,
					}, { scheduled: true });
					return;
				}
				state.camera = {
					x: state.camera.x - (event.shiftKey ? event.deltaY : event.deltaX),
					y: state.camera.y - (event.shiftKey ? 0 : event.deltaY),
				};
				saveViewport();
				scheduleCamera();
				persist();
			},
			{ passive: false },
		);
		listen(scroll, "pointerdown", (event) => {
			if (state.view !== "canvas") return;
			if (root.dataset.designInspect === "true") return;
			if (event.button !== 0 && event.button !== 1) return;
			const label = event.target.closest("[data-design-drag]");
			const dragging =
				event.button === 0 &&
				state.view === "canvas" &&
				label &&
				!panEnabled &&
				!spacePan;
			const panning =
				event.button === 1 ||
				panEnabled ||
				spacePan ||
				event.target === scroll ||
				event.target === grid ||
				event.target === surface;
			if (!dragging && !panning) return;
			event.preventDefault();
			const panel = label?.closest(".planr-artifact-panel");
			gesture = {
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				mode: dragging ? "artboard" : "pan",
				artifactId: dragging ? panel.dataset.artifactId : null,
				left: dragging ? parseFloat(panel.style.left) : state.camera.x,
				top: dragging ? parseFloat(panel.style.top) : state.camera.y,
			};
			scroll.setPointerCapture?.(event.pointerId);
			updatePan();
		});
		listen(scroll, "pointermove", (event) => {
			if (!gesture || gesture.pointerId !== event.pointerId) return;
			const dx = event.clientX - gesture.x;
			const dy = event.clientY - gesture.y;
			if (gesture.mode === "pan") {
				state.camera = {
					x: clamp(gesture.left + dx, -1e7, 1e7),
					y: clamp(gesture.top + dy, -1e7, 1e7),
				};
				saveViewport();
				scheduleCamera();
			} else {
				state.positions[gesture.artifactId] = {
					x: clamp(gesture.left + dx / state.zoom, -1e7, 1e7),
					y: clamp(gesture.top + dy / state.zoom, -1e7, 1e7),
				};
				const panel = panels.get(gesture.artifactId);
				panel.style.left = `${state.positions[gesture.artifactId].x}px`;
				panel.style.top = `${state.positions[gesture.artifactId].y}px`;
				scheduleCamera();
			}
		});
		for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"])
			listen(scroll, eventName, (event) => {
				if (!gesture || gesture.pointerId !== event.pointerId) return;
				if (eventName === "pointerup") finishGesture();
				else releaseTemporaryPan();
			});
		listen(document, "keydown", (event) => {
			if (editable(event.target)) return;
			if (
				state.view === "canvas" &&
				event.code === "Space" &&
				!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey &&
				!document.querySelector("dialog[open]") &&
				!event.target.closest("button,[data-planr-annotation-layer]")
			) {
				event.preventDefault();
				if (event.repeat) return;
				const previous = activeTool;
				setTool("pan");
				panEnabled = false;
				spacePan = true;
				spaceReturnTool = previous;
				updatePan();
			}
			const label = event.target.closest("[data-design-drag]");
			if (
				label &&
				state.view === "canvas" &&
				["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
			) {
				event.preventDefault();
				const panel = label.closest(".planr-artifact-panel");
				const distance = event.shiftKey ? 40 : 8;
				state.positions[panel.dataset.artifactId] = {
					x: clamp(
						parseFloat(panel.style.left) +
							(event.key === "ArrowRight"
								? distance
								: event.key === "ArrowLeft"
									? -distance
									: 0),
						-1e7,
						1e7,
					),
					y: clamp(
						parseFloat(panel.style.top) +
							(event.key === "ArrowDown"
								? distance
								: event.key === "ArrowUp"
									? -distance
									: 0),
						-1e7,
						1e7,
					),
				};
				render();
				persist();
			} else if (
				state.view === "walkthrough" &&
				["ArrowLeft", "ArrowRight"].includes(event.key) &&
				!event.target.closest('button,[role="radio"]')
			) {
				event.preventDefault();
				const index = clamp(
					design.screenOrder.indexOf(requestedScreen()) +
						(event.key === "ArrowRight" ? 1 : -1),
					0,
					design.screenOrder.length - 1,
				);
				selectEntry(entryFor(design.screenOrder[index]));
			}
		});
		listen(document, "keyup", (event) => {
			if (event.code === "Space") {
				releaseTemporaryPan();
			}
		});
		listen(window, "blur", () => {
			releaseTemporaryPan();
			// Pointer events inside sandboxed product frames do not bubble to the studio.
			if (document.activeElement?.tagName === "IFRAME") closeDesignNotes();
		});
		listen(document, "visibilitychange", () => { if (document.hidden) { releaseTemporaryPan(); finishWalkthroughTransition(); } });
		listen(window.matchMedia?.("(prefers-reduced-motion: reduce)"), "change", () => finishWalkthroughTransition());
		listen(window, "resize", () => {
			const compact = window.innerWidth <= 960;
			if (compact && !compactViewport) {
				state.navOpen = false;
				state.reviewOpen = false;
				stage.dispatch({ type: "set-rail-open", railOpen: false });
				persist();
			}
			compactViewport = compact;
			render();
			if (state.view !== "canvas" && root.dataset.designRestoring !== "true") fit({ save: false });
			updateDesignNotes();
		});
		listen(window, "online", () => {
			if (dirty || reviewDirty) void flush();
		});
		listen(window, "beforeunload", (event) => {
			storeDraft();
			storeReviewDraft();
			if (
				(contentDirty || reviewDirty) &&
				(options.stateUrl || options.saveState || reviewUrl())
			) {
				event.preventDefault();
				event.returnValue = "";
			}
		});
		listen(window, "message", (event) => {
			// Authored navigation is accepted only from one of this studio's exact
			// sandbox windows, then resolved against the declared screen identities.
			if (
				event.data?.type !== "openplanr:design-navigate" ||
				typeof event.data.screenId !== "string"
			)
				return;
			const source = entries.find(
				({ artifactId }) =>
					stage.getFrame(artifactId)?.contentWindow === event.source,
			);
			if (!source || !design.screenOrder.includes(event.data.screenId)) return;
			if (state.view !== "canvas" && (source.artifactId !== activeArtifactId || walkthroughTransition)) return;
			selectEntry(
				entryFor(event.data.screenId, source.variantId, source.frameId),
			);
		});
	}

	async function refreshSavedState() {
		if (!options.stateUrl) return;
		try {
			const result = await jsonRequest(options.stateUrl);
			if (destroyed) return;
			if (result.revision !== undefined) revision = result.revision;
			if (result.stateVersion !== undefined) stateVersion = result.stateVersion;
			if (result.state && !dirty) {
				state = normalizeState(result.state);
				if (compactViewport) {
					state.navOpen = false;
					state.reviewOpen = false;
				}
				stage.dispatch({ type: "set-rail-open", railOpen: state.reviewOpen });
			}
			if (savedDraft?.unsaved)
				notice(
					"A previous unsaved draft is available in this browser. The saved review is shown; your draft has not overwritten it.",
					true,
				);
			selectEntry(entryFor(), { save: false });
			status("All changes saved");
		} catch {
			status("Disconnected · local draft", "disconnected");
		}
	}

	async function pollRevision() {
		if (!options.statusUrl || destroyed) return;
		try {
			const result = await jsonRequest(options.statusUrl);
			if (destroyed) return;
			if (typeof result.verification === "string")
				q("[data-design-verification]").textContent =
					result.verification === "verified"
						? "Browser inspection complete"
						: "Browser inspection pending";
			if (
				result.revision !== undefined &&
				revision !== null &&
				result.revision !== revision
			) {
				if (contentDirty || reviewDirty)
					notice(
						"A new design revision is ready. Save or recover this browser’s unsaved changes before reloading.",
						true,
					);
				else {
					storeDraft();
					window.location.reload();
					return;
				}
			}
			if (result.status === "failed")
				notice(
					result.message ??
						"The new revision failed. This working design remains available.",
					true,
				);
		} catch {
			if (!dirty) status("Disconnected", "disconnected");
		}
		pollTimer = setTimeout(pollRevision, 4000);
	}

	async function reportReady() {
		if (readyReported || destroyed) return;
		const result = await Promise.race([
			stage.ready,
			new Promise((resolve) =>
				setTimeout(() => resolve({ status: "timeout" }), 15000),
			),
		]);
		if (destroyed) return;
		const requiredEntries = stage.frameBudget ? [entryFor()] : entries;
		if (stage.frameBudget) {
			try { await stage.ensureFrames(requiredEntries.map(entry=>entry.artifactId)); }
			catch { if (!destroyed) notice('The first screen could not load. Reload to retry; saved feedback remains available.',true); return; }
		}
		const authenticated = Promise.all(
			requiredEntries.map(({ artifactId }) => {
				const frame = stage.getFrame(artifactId);
				if (
					!frame?.__openPlanrBridge ||
					frame.dataset.planrBridgeTrusted === "true"
				)
					return true;
				return new Promise((resolve) =>
					frame.addEventListener(
						"planr:artifact-bridge-ready",
						() => resolve(true),
						{ once: true },
					),
				);
			}),
		);
		const bridgeReady = await Promise.race([
			authenticated.then(() => true),
			new Promise((resolve) => setTimeout(() => resolve(false), 15000)),
		]);
		if (destroyed) return;
		const loaded = requiredEntries.filter(({ artifactId }) => {
			const frame = stage.getFrame(artifactId);
			return (
				(frame?.src?.startsWith("blob:") || Boolean(frame?.srcdoc)) &&
				frame.dataset.planrArtifactDigest &&
				(!frame.__openPlanrBridge ||
					frame.dataset.planrBridgeTrusted === "true")
			);
		});
		if (
			result?.status !== "ready" ||
			!bridgeReady ||
			loaded.length !== requiredEntries.length
		) {
			status("Preview failed to load", "failed");
			notice(
				"Some design previews did not finish loading. Reload the local review to retry; saved feedback remains available.",
				true,
			);
			return;
		}
		readyReported = true;
		render();
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		if (destroyed) return;
		root.dataset.designReady = "true";
		if (!root.dataset.sharedOpening) delete document.documentElement.dataset.designOpening;
		if (!contentDirty && !reviewDirty && (!options.stateUrl || stateVersion !== null))
			status(options.stateUrl ? "All changes saved" : "Ready · local preview");
		const detail = {
			revision,
			status: "ready",
			artifacts: loaded.map(({ artifactId }) => artifactId),
		};
		root.dispatchEvent(
			new CustomEvent("planr:design-ready", { bubbles: true, detail }),
		);
		if (typeof options.onReady === "function") await options.onReady(detail);
		if (options.readyUrl) {
			try {
				await jsonRequest(options.readyUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(detail),
				});
			} catch {
				status("Preview ready · server disconnected", "disconnected");
			}
		}
	}

	function mount() {
		options = globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ ?? options;
		stage = window.__openPlanrArtifactStage;
		if (!stage) {
			status("Review runtime unavailable", "failed");
			return null;
		}
		root = q(".planr-shell");
		previousReviewMode = stage.getState().reviewMode;
		activeTool = previousReviewMode === "comment" ? "annotate" : "interact";
		scroll = q(".planr-stage-scroll");
		surface = q(".planr-stage-surface");
		grid = q(".planr-frame-grid");
		canvasBackground = document.createElement("div");
		canvasBackground.className = "design-canvas-background";
		canvasBackground.setAttribute("aria-hidden", "true");
		scroll.prepend(canvasBackground);
		selectionOutline = document.createElement("div");
		selectionOutline.className = "design-selection-outline";
		selectionOutline.setAttribute("aria-hidden", "true");
		selectionOutline.hidden = true;
		scroll.append(selectionOutline);
		for (const entry of entries) {
			const panel = stage.getPanel(entry.artifactId);
			if (!panel) {
				status("Missing design preview", "failed");
				return null;
			}
			panels.set(entry.artifactId, panel);
			const screen = design.screens.find(({ id }) => id === entry.screenId);
			const variant = design.variants.find(({ id }) => id === entry.variantId);
			const frame = design.frames.find(({ id }) => id === entry.frameId);
			const label = document.createElement("div");
			label.className = "design-artboard-label";
			label.setAttribute("role", "group");
			const drag = document.createElement("button");
			drag.type = "button";
			drag.className = "design-artboard-drag";
			drag.dataset.designDrag = entry.artifactId;
			drag.setAttribute(
				"aria-label",
				`Move ${screen.title}, ${variant.label}, ${frame.label}. Use arrow keys to arrange.`,
			);
			const title = document.createElement("strong");
			title.textContent = `${screen.title}${readyVariants.length > 1 ? ` / ${variant.label}` : ""}`;
			const size = document.createElement("span");
			size.textContent = `${frame.label} · ${frame.width} × ${frame.height}`;
			drag.append(title, size);
			label.append(drag);
			if (screen.description) {
				const note = document.createElement("button");
				note.type = "button";
				note.className = "design-artboard-note";
				note.dataset.designNote = screen.id;
				note.setAttribute("aria-controls", "design-guidance-panel");
				note.setAttribute("aria-expanded", "false");
				note.title = screen.description;
				note.setAttribute(
					"aria-label",
					`Open design notes for ${screen.title}`,
				);
				note.textContent = "i";
				label.append(note);
			}
			panel.prepend(label);
			if (stage.frameBudget) {
				const load = document.createElement('button'); load.type='button';
				load.className='design-frame-placeholder'; load.dataset.designLoadFrame=entry.artifactId;
				load.setAttribute('aria-label',`Open screen: ${screen.title}, ${frame.label}`);
				load.textContent='Open screen'; panel.querySelector('.planr-frame').append(load);
			}
		}
		const verified = payload.verification?.status === "verified";
		q("[data-design-verification]").textContent = verified
			? "Browser inspection complete"
			: "Browser inspection pending";
		installEvents();
		if (stage.frameBudget) {
			listen(root, 'planr:artifact-frame-state', updateFramePlaceholders);
			updateFramePlaceholders();
		}
		compactViewport = window.innerWidth <= 960;
		if (compactViewport) {
			state.navOpen = false;
			state.reviewOpen = false;
			stage.dispatch({ type: "set-rail-open", railOpen: false });
		} else
			stage.dispatch({ type: "set-rail-open", railOpen: state.reviewOpen });
		selectEntry(entryFor(), { save: false });
		if (!reviewUrl() && !stage.review.getState().review) {
			try {
				const storedReview = JSON.parse(
					localStorage.getItem(`${storageKey}.review`) ?? "null",
				);
				if (storedReview?.review)
					stage.review.replaceReview(storedReview.review);
			} catch {
				/* A different render digest must not inherit coordinate pins. */
			}
		}
		const controller = Object.freeze({
			setTool,
			getTool: () => activeTool,
			getState: () => clone(state),
			getRevision: () => revision,
			getSaveState: () => ({
				dirty: contentDirty || reviewDirty,
				personalPending: dirty && !contentDirty,
				revision,
				stateVersion,
			}),
			selectScreen: (screenId) => selectEntry(entryFor(screenId)),
			selectEntry: (entry) => selectEntry(entry),
			fitSelection: ({ save = true } = {}) => fit({ selection: entryFor(), save }),
			setCamera(camera) {
				if (state.view !== "canvas") return;
				if (!Number.isFinite(camera?.x) || !Number.isFinite(camera?.y)) return;
				state.camera = { x: clamp(camera.x, -1e7, 1e7), y: clamp(camera.y, -1e7, 1e7) };
				if (Number.isFinite(camera.zoom)) state.zoom = clamp(camera.zoom, 0.05, 2);
				saveViewport(); renderCamera(); persist();
			},
			setPanels({ navOpen = state.navOpen, reviewOpen = state.reviewOpen }, { save = true } = {}) {
				state.navOpen = Boolean(navOpen); state.reviewOpen = Boolean(reviewOpen);
				stage.dispatch({ type: "set-rail-open", railOpen: state.reviewOpen });
				render(); if (save) persist();
			},
			restorePresentation(snapshot) {
				finishWalkthroughTransition();
				const personal = {};
				for (const key of ["view", "screenId", "frameId", "variantId", "compare", "navOpen", "reviewOpen", "zoom", "camera", "viewports", "positions"])
					if (snapshot[key] !== undefined) personal[key] = clone(snapshot[key]);
				state = normalizeState({ ...state, ...personal });
				stage.dispatch({ type: "set-rail-open", railOpen: state.reviewOpen });
				selectEntry(entryFor(), { save: false }); render(); persist();
			},
			setView(view) {
				switchView(view);
			},
			fit,
			flush,
			exportArtifact,
			destroy() {
				finishWalkthroughTransition();
				root.dispatchEvent(new CustomEvent("planr:design-destroy"));
				for (const { artifactId } of entries) stage.getFrame(artifactId)?.__openPlanrBridge?.setViewportGestures?.(false);
				destroyed = true; ++screenRequest; pendingScreen=null; clearTimeout(frameDemandTimer);
				clearTimeout(saveTimer);
				clearTimeout(reviewTimer);
				clearTimeout(pollTimer);
				clearTimeout(noticeTimer);
				if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
				canvasBackground?.remove();
				selectionOutline?.remove();
				for (const remove of cleanup.splice(0)) remove();
			},
		});
		window.__openPlanrDesignStudio = controller;
		void refreshSavedState().then(reportReady);
		pollTimer = setTimeout(pollRevision, 4000);
		return controller;
	}

	// The artifact server loads its trusted bridge and adapter before the stage.
	// Those scripts may arrive after DOMContentLoaded; do not confuse that normal
	// startup sequence with a missing runtime.
	const bootStarted = Date.now();
	function boot() {
		if (document.getElementById("planr-design-studio-payload") !== payloadNode) return;
		if (window.__openPlanrArtifactStage) {
			mount();
			return;
		}
		if (Date.now() - bootStarted >= 15000) {
			status("Review runtime unavailable", "failed");
			return;
		}
		setTimeout(boot, 30);
	}
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	else boot();
})();
