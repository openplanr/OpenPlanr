var OpenPlanrArtifactStage = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/artifact/ui/stage.mjs
  var stage_exports = {};
  __export(stage_exports, {
    ARTIFACT_STAGE_EVENTS: () => ARTIFACT_STAGE_EVENTS,
    ARTIFACT_STAGE_LIMITS: () => ARTIFACT_STAGE_LIMITS,
    bootstrapArtifactStage: () => bootstrapArtifactStage,
    clientPointToNormalized: () => clientPointToNormalized,
    createArtifactStagePayload: () => createArtifactStagePayload,
    createArtifactStageState: () => createArtifactStageState,
    mountArtifactStage: () => mountArtifactStage,
    normalizedPointToClient: () => normalizedPointToClient,
    reduceArtifactStageState: () => reduceArtifactStageState,
    resolveArtifactPresentation: () => resolveArtifactPresentation,
    visibleArtifactIds: () => visibleArtifactIds
  });

  // lib/artifact/ui/annotations.mjs
  var ARTIFACT_ANNOTATION_EVENTS = Object.freeze({
    draft: "planr:artifact-annotation-draft",
    focus: "planr:artifact-annotation-focus"
  });
  var ARTIFACT_ANNOTATION_LIMITS = Object.freeze({
    dragThreshold: 4,
    maxCommentLength: 65536,
    maxIdentityLength: 256
  });
  var INTENTS = Object.freeze(["fix", "improve", "question"]);
  function finite(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, finite(value)));
  }
  function normalized(value) {
    return Math.round(clamp(value) * 1e6) / 1e6;
  }
  function assertRect(rect) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      throw new RangeError("Artifact bounds must have positive finite dimensions.");
    }
  }
  function clientSelectionToNormalized(rect, start, end = start, { dragThreshold = ARTIFACT_ANNOTATION_LIMITS.dragThreshold } = {}) {
    assertRect(rect);
    const startX = clamp(finite(start?.x ?? start?.clientX, rect.left), rect.left, rect.left + rect.width);
    const startY = clamp(finite(start?.y ?? start?.clientY, rect.top), rect.top, rect.top + rect.height);
    const endX = clamp(finite(end?.x ?? end?.clientX, startX), rect.left, rect.left + rect.width);
    const endY = clamp(finite(end?.y ?? end?.clientY, startY), rect.top, rect.top + rect.height);
    const dragged = Math.hypot(endX - startX, endY - startY) >= Math.max(0, finite(dragThreshold, 4));
    const left = dragged ? Math.min(startX, endX) : startX;
    const top = dragged ? Math.min(startY, endY) : startY;
    const right = dragged ? Math.max(startX, endX) : startX;
    const bottom = dragged ? Math.max(startY, endY) : startY;
    return Object.freeze({
      x: normalized((left - rect.left) / rect.width),
      y: normalized((top - rect.top) / rect.height),
      w: normalized((right - left) / rect.width),
      h: normalized((bottom - top) / rect.height)
    });
  }
  function artifactAnchorPoint(region, viewport) {
    const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
    const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
    return Object.freeze({
      x: Math.round(clamp(region?.x + finite(region?.w) / 2) * width),
      y: Math.round(clamp(region?.y + finite(region?.h) / 2) * height)
    });
  }
  function annotationStyle(region) {
    return Object.freeze({
      left: `${normalized(region?.x) * 100}%`,
      top: `${normalized(region?.y) * 100}%`,
      width: `${normalized(region?.w) * 100}%`,
      height: `${normalized(region?.h) * 100}%`
    });
  }
  function viewportRegionToAnchorRegion(region, viewport, anchorRect) {
    const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
    const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
    const anchorWidth = Math.max(1, finite(anchorRect?.width, 1));
    const anchorHeight = Math.max(1, finite(anchorRect?.height, 1));
    const left = clamp(region?.x) * width;
    const top = clamp(region?.y) * height;
    const right = left + clamp(region?.w) * width;
    const bottom = top + clamp(region?.h) * height;
    const x = clamp((left - finite(anchorRect?.x)) / anchorWidth);
    const y = clamp((top - finite(anchorRect?.y)) / anchorHeight);
    return Object.freeze({
      x: normalized(x),
      y: normalized(y),
      w: normalized(Math.max(0, Math.min(1 - x, (right - left) / anchorWidth))),
      h: normalized(Math.max(0, Math.min(1 - y, (bottom - top) / anchorHeight)))
    });
  }
  function anchorRegionToViewportRegion(region, viewport, anchorRect) {
    const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
    const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
    const anchorWidth = Math.max(0, finite(anchorRect?.width));
    const anchorHeight = Math.max(0, finite(anchorRect?.height));
    return Object.freeze({
      x: normalized((finite(anchorRect?.x) + clamp(region?.x) * anchorWidth) / width),
      y: normalized((finite(anchorRect?.y) + clamp(region?.y) * anchorHeight) / height),
      w: normalized(clamp(region?.w) * anchorWidth / width),
      h: normalized(clamp(region?.h) * anchorHeight / height)
    });
  }
  function domToken(value) {
    const source = String(value);
    let token = "";
    for (let index = 0; index < source.length; index += 1) {
      token += source.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return token;
  }
  function annotationDomIds(pinId) {
    const suffix = domToken(pinId);
    return Object.freeze({
      pin: `planr-pin-${suffix}`,
      thread: `planr-thread-${suffix}`
    });
  }
  function text(value, max = ARTIFACT_ANNOTATION_LIMITS.maxCommentLength) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }
  function make(document2, tag, { className, textContent, attributes = {} } = {}) {
    const node = document2.createElement(tag);
    if (className) node.className = className;
    if (textContent !== void 0) node.textContent = textContent;
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== void 0 && value !== null) node.setAttribute(name, String(value));
    }
    return node;
  }
  function setRegionStyle(node, region) {
    const style = annotationStyle(region);
    node.style.left = style.left;
    node.style.top = style.top;
    if (region.w > 0 || region.h > 0) {
      node.style.width = style.width;
      node.style.height = style.height;
    }
  }
  function announce(document2, value) {
    const node = document2.querySelector('[data-planr-slot="review-announcer"]');
    if (node) node.textContent = value;
  }
  function identityName(reviewController) {
    return text(reviewController?.getIdentity?.()?.name, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
  }
  function createIntentPicker(document2) {
    const group = make(document2, "div", {
      className: "planr-intent-picker",
      attributes: { role: "radiogroup", "aria-label": "Feedback intent" }
    });
    for (const [index, intent] of INTENTS.entries()) {
      const button = make(document2, "button", {
        textContent: intent[0].toUpperCase() + intent.slice(1),
        attributes: {
          type: "button",
          role: "radio",
          "aria-checked": String(index === 0),
          tabindex: index === 0 ? 0 : -1,
          "data-planr-intent": intent
        }
      });
      group.append(button);
    }
    return group;
  }
  function mountArtifactAnnotations({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    root = document2?.querySelector?.(".planr-shell"),
    stageController,
    reviewController
  } = {}) {
    if (!document2 || !window || !root || !stageController || !reviewController) return null;
    const cleanup = [];
    let draft = null;
    let draftToken = 0;
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function review() {
      return reviewController.getReview?.() ?? reviewController.getState?.()?.review ?? reviewController.getState?.();
    }
    function layerFor(artifactId) {
      return [...document2.querySelectorAll("[data-planr-annotation-layer]")].find((node) => node.dataset.planrAnnotationLayer === artifactId) ?? null;
    }
    function frameFor(artifactId) {
      return [...document2.querySelectorAll("[data-planr-artifact-frame]")].find((node) => node.dataset.planrArtifactFrame === artifactId) ?? null;
    }
    function focusThread(pinId) {
      const pin = review()?.pins?.find((item) => item.id === pinId);
      if (!pin) return;
      reviewController.selectPin?.(pinId);
      const state = stageController.getState();
      if (state.activeArtifactId !== pin.artifactId) {
        stageController.dispatch({ type: "set-active", artifactId: pin.artifactId });
      }
      stageController.dispatch({ type: "set-rail-open", railOpen: true });
      queueMicrotask(() => document2.getElementById(annotationDomIds(pinId).thread)?.focus());
    }
    function focusPin(pinId) {
      const pin = review()?.pins?.find((item) => item.id === pinId);
      if (!pin) return;
      reviewController.selectPin?.(pinId);
      const state = stageController.getState();
      if (state.activeArtifactId !== pin.artifactId) {
        stageController.dispatch({ type: "set-active", artifactId: pin.artifactId });
      }
      queueMicrotask(() => {
        const marker = document2.getElementById(annotationDomIds(pinId).pin);
        marker?.scrollIntoView?.({ block: "center", inline: "center", behavior: "smooth" });
        marker?.focus?.({ preventScroll: true });
        marker?.classList.add("planr-pin-highlight");
        window.setTimeout(() => marker?.classList.remove("planr-pin-highlight"), 1200);
      });
    }
    function renderPins() {
      const pins = Array.isArray(review()?.pins) ? review().pins : [];
      for (const layer of document2.querySelectorAll("[data-planr-annotation-layer]")) {
        for (const existing of layer.querySelectorAll("[data-planr-pin-id]")) existing.remove();
        for (const existing of layer.querySelectorAll("[data-planr-pin-region-id]")) existing.remove();
        const artifactPins = pins.filter((pin) => pin.artifactId === layer.dataset.planrAnnotationLayer);
        for (const pin of artifactPins) {
          const ids = annotationDomIds(pin.id);
          const ordinal = pins.indexOf(pin) + 1;
          const hasRegion = pin.region.w > 0 || pin.region.h > 0;
          if (hasRegion) {
            const region = make(document2, "span", {
              className: `planr-pin-region planr-pin-region-${pin.intent} planr-pin-region-${pin.status}`,
              attributes: {
                "data-planr-pin-region-id": pin.id,
                "aria-hidden": "true"
              }
            });
            setRegionStyle(region, pin.region);
            layer.append(region);
          }
          const button = make(document2, "button", {
            className: `planr-pin planr-pin-${pin.intent} planr-pin-${pin.status}${hasRegion ? " planr-pin-region-handle" : ""}`,
            textContent: String(ordinal),
            attributes: {
              type: "button",
              id: ids.pin,
              "data-planr-pin-id": pin.id,
              "data-planr-intent": pin.intent,
              "data-planr-status": pin.status,
              "aria-controls": ids.thread,
              "aria-label": `${pin.intent} feedback ${ordinal}: ${pin.comment}`
            }
          });
          setRegionStyle(button, {
            x: pin.region.x + pin.region.w / 2,
            y: pin.region.y + pin.region.h / 2,
            w: 0,
            h: 0
          });
          button.addEventListener("click", () => focusThread(pin.id));
          layer.append(button);
          if (pin.anchor?.planrId) {
            const frame = frameFor(pin.artifactId);
            Promise.resolve(frame?.__openPlanrBridge?.resolve?.(pin.anchor.planrId, pin.anchor.screen)).then((anchor) => {
              if (!anchor) return;
              const projected = anchorRegionToViewportRegion(pin.region, pin.viewport, anchor.rect);
              const currentButton = document2.getElementById(ids.pin);
              const currentRegion = [...layer.querySelectorAll("[data-planr-pin-region-id]")].find((node) => node.dataset.planrPinRegionId === pin.id);
              if (currentButton) setRegionStyle(currentButton, {
                x: projected.x + projected.w / 2,
                y: projected.y + projected.h / 2,
                w: 0,
                h: 0
              });
              if (currentRegion) setRegionStyle(currentRegion, projected);
            }).catch(() => {
            });
          }
        }
      }
    }
    function closeComposer({ restoreFocus = false } = {}) {
      const activeLayer = draft ? layerFor(draft.artifactId) : null;
      document2.querySelector("[data-planr-annotation-composer]")?.remove();
      draft = null;
      draftToken += 1;
      if (restoreFocus) activeLayer?.focus();
    }
    async function resolveAnchor(token, candidate) {
      const frame = frameFor(candidate.artifactId);
      const point = artifactAnchorPoint(candidate.region, candidate.viewport);
      let result = null;
      try {
        const anchor = frame?.__openPlanrBridge?.hitTest?.(point.x, point.y);
        if (anchor) {
          result = await Promise.race([
            anchor,
            new Promise((resolve) => window.setTimeout(() => resolve(null), 800))
          ]);
        }
      } catch {
        result = null;
      }
      if (token !== draftToken || !draft || draft.artifactId !== candidate.artifactId) return;
      if (result?.planrId) {
        draft.anchor = Object.freeze({
          planrId: String(result.planrId).slice(0, 512),
          ...result.screen ? { screen: String(result.screen).slice(0, 128) } : {}
        });
        draft.region = viewportRegionToAnchorRegion(draft.region, draft.viewport, result.rect);
      }
    }
    function openComposer(detail) {
      closeComposer();
      const layer = layerFor(detail.artifactId);
      if (!layer) return;
      draftToken += 1;
      const token = draftToken;
      draft = {
        artifactId: detail.artifactId,
        region: Object.freeze({ ...detail.region }),
        viewport: Object.freeze({ ...detail.viewport }),
        variant: typeof detail.variant === "string" && detail.variant.length > 0 ? detail.variant : detail.artifactId,
        anchor: null
      };
      const composer = make(document2, "form", {
        className: "planr-annotation-composer",
        attributes: {
          "data-planr-annotation-composer": "",
          "aria-label": "Add artifact feedback"
        }
      });
      const heading = make(document2, "strong", { textContent: "New feedback" });
      const identityLabel = make(document2, "label", { textContent: "Your name" });
      const identity = make(document2, "input", {
        attributes: {
          type: "text",
          maxlength: ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength,
          autocomplete: "name",
          value: identityName(reviewController),
          "data-planr-composer-identity": "",
          "aria-describedby": "planr-composer-error"
        }
      });
      identityLabel.append(identity);
      const intentPicker = createIntentPicker(document2);
      const commentLabel = make(document2, "label", { textContent: "Feedback" });
      const comment = make(document2, "textarea", {
        attributes: {
          maxlength: ARTIFACT_ANNOTATION_LIMITS.maxCommentLength,
          required: "",
          placeholder: "Describe what the coding agent should change or consider…",
          "data-planr-composer-comment": "",
          "aria-describedby": "planr-composer-error"
        }
      });
      commentLabel.append(comment);
      const error = make(document2, "p", {
        className: "planr-field-error",
        attributes: { id: "planr-composer-error", role: "alert", "data-planr-composer-error": "" }
      });
      const actions = make(document2, "div", { className: "planr-composer-actions" });
      actions.append(
        make(document2, "button", {
          textContent: "Cancel",
          attributes: { type: "button", "data-planr-composer-cancel": "" }
        }),
        make(document2, "button", {
          textContent: "Add feedback",
          attributes: { type: "submit", "data-planr-composer-submit": "" }
        })
      );
      composer.append(heading, identityLabel, intentPicker, commentLabel, error, actions);
      setRegionStyle(composer, detail.region);
      layer.append(composer);
      let selectedIntent = "fix";
      listen(intentPicker, "click", (event) => {
        const button = event.target.closest?.("[data-planr-intent]");
        if (!button || !INTENTS.includes(button.dataset.planrIntent)) return;
        selectedIntent = button.dataset.planrIntent;
        for (const option of intentPicker.querySelectorAll("[data-planr-intent]")) {
          option.setAttribute("aria-checked", String(option === button));
          option.tabIndex = option === button ? 0 : -1;
        }
      });
      listen(intentPicker, "keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        const options = [...intentPicker.querySelectorAll("[data-planr-intent]")];
        const current = options.findIndex((option) => option.getAttribute("aria-checked") === "true");
        const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (Math.max(0, current) + delta + options.length) % options.length;
        event.preventDefault();
        options[nextIndex].click();
        options[nextIndex].focus();
      });
      listen(composer.querySelector("[data-planr-composer-cancel]"), "click", () => {
        closeComposer({ restoreFocus: true });
      }, { once: true });
      listen(composer, "keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeComposer({ restoreFocus: true });
        } else if (event.key === "Enter" && !event.isComposing && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          composer.requestSubmit();
        }
      });
      listen(composer, "submit", (event) => {
        event.preventDefault();
        if (!draft) return;
        const author = text(identity.value, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
        const body = text(comment.value);
        identity.setAttribute("aria-invalid", String(!author));
        comment.setAttribute("aria-invalid", String(!body));
        if (!author || !body) {
          error.textContent = !author ? "Enter your name before adding feedback." : "Enter feedback before submitting.";
          (!author ? identity : comment).focus();
          return;
        }
        reviewController.setIdentity?.({ name: author });
        const existingIds = new Set(review()?.pins?.map(({ id }) => id) ?? []);
        const action = {
          type: "add-pin",
          pin: {
            artifactId: draft.artifactId,
            region: draft.region,
            viewport: draft.viewport,
            variant: draft.variant,
            ...draft.anchor ? { anchor: draft.anchor } : {},
            intent: selectedIntent,
            comment: body
          }
        };
        const next = reviewController.dispatch(action);
        const nextReview = next?.review ?? next;
        const created = nextReview?.pins?.find?.(({ id }) => !existingIds.has(id));
        closeComposer();
        renderPins();
        announce(document2, `${selectedIntent} feedback added.`);
        if (created?.id) queueMicrotask(() => focusThread(created.id));
      });
      comment.focus();
      root.dispatchEvent(new window.CustomEvent(ARTIFACT_ANNOTATION_EVENTS.draft, {
        bubbles: true,
        detail: Object.freeze({ ...draft })
      }));
      void resolveAnchor(token, draft);
    }
    listen(root, "planr:artifact-region", (event) => openComposer(event.detail));
    listen(root, "planr:stage-change", () => {
      if (!draft) return;
      const state = stageController.getState();
      if (state.reviewMode !== "comment") {
        closeComposer();
        return;
      }
      const visible = state.viewMode === "split" ? [state.activeArtifactId, state.comparisonArtifactId] : [state.activeArtifactId];
      if (!visible.includes(draft.artifactId)) closeComposer();
      else draftToken += 1;
    });
    listen(root, "planr:artifact-review-change", renderPins);
    const anchorRefresh = window.setInterval(() => {
      if (review()?.pins?.some((pin) => pin.anchor?.planrId)) renderPins();
    }, 250);
    cleanup.push(() => window.clearInterval(anchorRefresh));
    listen(root, ARTIFACT_ANNOTATION_EVENTS.focus, (event) => {
      if (event.detail?.target === "pin") focusPin(event.detail.pinId);
      if (event.detail?.target === "thread") focusThread(event.detail.pinId);
    });
    listen(root, "planr:artifact-review-select", (event) => {
      if (event.detail?.source === "thread" && typeof event.detail?.pinId === "string") {
        focusPin(event.detail.pinId);
      }
    });
    renderPins();
    const controller = Object.freeze({
      render: renderPins,
      openComposer,
      closeComposer,
      focusPin,
      focusThread,
      destroy() {
        closeComposer();
        for (const remove of cleanup.splice(0)) remove();
        for (const pin of document2.querySelectorAll("[data-planr-pin-id]")) pin.remove();
        for (const region of document2.querySelectorAll("[data-planr-pin-region-id]")) region.remove();
      }
    });
    window.__openPlanrArtifactAnnotations = controller;
    return controller;
  }

  // lib/artifact/ui/feedback-rail.mjs
  var ARTIFACT_REVIEW_CHANGE_EVENT = "planr:artifact-review-change";
  var ARTIFACT_REVIEW_SELECT_EVENT = "planr:artifact-review-select";
  var ARTIFACT_REVIEW_LIMITS = Object.freeze({
    id: 128,
    authorName: 256,
    artifactId: 128,
    variant: 128,
    anchor: 512,
    screen: 128,
    text: 65536,
    pins: 1e4,
    replies: 1e4,
    viewport: 16384
  });
  var ARTIFACT_REVIEW_DECISIONS = Object.freeze([
    "pending",
    "approved",
    "changes_requested"
  ]);
  var ARTIFACT_REVIEW_INTENTS = Object.freeze(["fix", "improve", "question"]);
  var ARTIFACT_REVIEW_STATUSES = Object.freeze(["open", "addressed", "resolved"]);
  var REVIEW_OF_RE = /^[a-f0-9]{64}$/;
  var ArtifactReviewStateError = class extends Error {
    constructor(code, message) {
      super(message);
      this.name = "ArtifactReviewStateError";
      this.code = code;
    }
  };
  function invalid(message) {
    throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_INVALID", message);
  }
  function identityRequired() {
    throw new ArtifactReviewStateError(
      "E_ARTIFACT_REVIEW_IDENTITY_REQUIRED",
      "Enter your name before adding feedback."
    );
  }
  function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (!value || typeof value !== "object") return value;
    const clone = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = clonePlain(entry);
    return clone;
  }
  function deepFreezeArtifactReview(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const entry of Object.values(value)) deepFreezeArtifactReview(entry);
    return Object.freeze(value);
  }
  function cloneFrozenArtifactReview(review) {
    return deepFreezeArtifactReview(clonePlain(review));
  }
  function boundedString(value, label, { min = 0, max, trim = false, pattern } = {}) {
    if (typeof value !== "string") invalid(`${label} must be a string.`);
    const normalized3 = trim ? value.trim() : value;
    if (normalized3.length < min || max !== void 0 && normalized3.length > max) {
      invalid(`${label} must contain ${min} through ${max ?? "unlimited"} characters.`);
    }
    if (pattern && !pattern.test(normalized3)) invalid(`${label} has an invalid format.`);
    return normalized3;
  }
  function optionalString(value, label, options) {
    if (value === void 0) return void 0;
    return boundedString(value, label, options);
  }
  function enumValue(value, values, label) {
    if (!values.includes(value)) invalid(`${label} must be one of: ${values.join(", ")}.`);
    return value;
  }
  function isoTimestamp(value, label) {
    const timestamp = value instanceof Date ? value.toISOString() : value;
    if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
      invalid(`${label} must be an ISO-8601 date-time.`);
    }
    return timestamp;
  }
  function dependencyTimestamp(now) {
    return isoTimestamp(now(), "now()");
  }
  function defaultNow() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  function createSecureArtifactReviewId(cryptoProvider = globalThis.crypto) {
    const randomUuid = cryptoProvider?.randomUUID?.();
    if (randomUuid) return randomUuid;
    const bytes = new Uint8Array(16);
    if (typeof cryptoProvider?.getRandomValues !== "function") {
      throw new ArtifactReviewStateError(
        "E_ARTIFACT_REVIEW_UUID_UNAVAILABLE",
        "Secure UUID generation is unavailable in this browser."
      );
    }
    cryptoProvider.getRandomValues(bytes);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function defaultCreateId() {
    return createSecureArtifactReviewId();
  }
  function dependencyId(createId, kind) {
    return boundedString(createId(kind), `${kind} id`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
  }
  function uniqueDependencyId(createId, kind, existingIds) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = dependencyId(createId, kind);
      if (!existingIds.has(candidate)) return candidate;
    }
    throw new ArtifactReviewStateError(
      "E_ARTIFACT_REVIEW_ID_COLLISION",
      `Could not create a unique ${kind} id.`
    );
  }
  function normalizeArtifactReviewIdentity(value, { allowEmpty = false } = {}) {
    if (value === null || value === void 0 || value === "") {
      if (allowEmpty) return null;
      identityRequired();
    }
    const source = typeof value === "string" ? { name: value } : value;
    if (!source || typeof source !== "object" || Array.isArray(source)) identityRequired();
    const name = boundedString(source.name, "author.name", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.authorName,
      trim: true
    });
    const id = optionalString(source.id, "author.id", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
    return deepFreezeArtifactReview(id === void 0 ? { name } : { id, name });
  }
  function normalizeRegion(region) {
    if (!region || typeof region !== "object" || Array.isArray(region)) {
      invalid("pin.region must be an object.");
    }
    const unit = (value, label) => {
      if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} must be finite.`);
      return Math.round(Math.min(1, Math.max(0, value)) * 1e6) / 1e6;
    };
    const x = unit(region.x, "pin.region.x");
    const y = unit(region.y, "pin.region.y");
    const w = Math.round(Math.min(unit(region.w, "pin.region.w"), 1 - x) * 1e6) / 1e6;
    const h = Math.round(Math.min(unit(region.h, "pin.region.h"), 1 - y) * 1e6) / 1e6;
    return { x, y, w, h };
  }
  function normalizeViewport(viewport) {
    if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) {
      invalid("pin.viewport must be an object.");
    }
    const dimension = (value, label) => {
      if (!Number.isInteger(value) || value < 1 || value > ARTIFACT_REVIEW_LIMITS.viewport) {
        invalid(`${label} must be an integer from 1 through ${ARTIFACT_REVIEW_LIMITS.viewport}.`);
      }
      return value;
    };
    return {
      width: dimension(viewport.width, "pin.viewport.width"),
      height: dimension(viewport.height, "pin.viewport.height")
    };
  }
  function normalizeAnchor(anchor) {
    if (anchor === void 0 || anchor === null) return void 0;
    if (typeof anchor !== "object" || Array.isArray(anchor)) invalid("pin.anchor must be an object.");
    const planrId = boundedString(anchor.planrId, "pin.anchor.planrId", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.anchor,
      trim: true
    });
    const screen = optionalString(anchor.screen, "pin.anchor.screen", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.screen,
      trim: true
    });
    return screen === void 0 ? { planrId } : { planrId, screen };
  }
  function normalizeReply(reply, label = "reply") {
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) invalid(`${label} must be an object.`);
    return {
      id: boundedString(reply.id, `${label}.id`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.id,
        trim: true
      }),
      author: normalizeArtifactReviewIdentity(reply.author),
      comment: boundedString(reply.comment, `${label}.comment`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.text,
        trim: true
      }),
      createdAt: isoTimestamp(reply.createdAt, `${label}.createdAt`)
    };
  }
  function compareTimestampThenId(left, right) {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  }
  function normalizePin(pin, label = "pin") {
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) invalid(`${label} must be an object.`);
    if (!Array.isArray(pin.replies) || pin.replies.length > ARTIFACT_REVIEW_LIMITS.replies) {
      invalid(`${label}.replies must contain no more than ${ARTIFACT_REVIEW_LIMITS.replies} items.`);
    }
    const replies = pin.replies.map((reply, index) => normalizeReply(reply, `${label}.replies[${index}]`));
    const replyIds = new Set(replies.map(({ id }) => id));
    if (replyIds.size !== replies.length) invalid(`${label}.replies must have unique ids.`);
    const normalized3 = {
      id: boundedString(pin.id, `${label}.id`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.id,
        trim: true
      }),
      author: normalizeArtifactReviewIdentity(pin.author),
      artifactId: boundedString(pin.artifactId, `${label}.artifactId`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.artifactId,
        trim: true
      }),
      region: normalizeRegion(pin.region),
      viewport: normalizeViewport(pin.viewport),
      intent: enumValue(pin.intent, ARTIFACT_REVIEW_INTENTS, `${label}.intent`),
      status: enumValue(pin.status, ARTIFACT_REVIEW_STATUSES, `${label}.status`),
      comment: boundedString(pin.comment, `${label}.comment`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.text,
        trim: true
      }),
      replies: replies.sort(compareTimestampThenId),
      createdAt: isoTimestamp(pin.createdAt, `${label}.createdAt`),
      updatedAt: isoTimestamp(pin.updatedAt, `${label}.updatedAt`)
    };
    const variant = optionalString(pin.variant, `${label}.variant`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.variant,
      trim: true
    });
    const anchor = normalizeAnchor(pin.anchor);
    if (variant !== void 0) normalized3.variant = variant;
    if (anchor !== void 0) normalized3.anchor = anchor;
    return normalized3;
  }
  function normalizeArtifactReview(review) {
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      invalid("Artifact review must be an object.");
    }
    if (!Array.isArray(review.pins) || review.pins.length > ARTIFACT_REVIEW_LIMITS.pins) {
      invalid(`review.pins must contain no more than ${ARTIFACT_REVIEW_LIMITS.pins} items.`);
    }
    const pins = review.pins.map((pin, index) => normalizePin(pin, `review.pins[${index}]`));
    const pinIds = new Set(pins.map(({ id }) => id));
    if (pinIds.size !== pins.length) invalid("review.pins must have unique ids.");
    const normalized3 = {
      schemaVersion: enumValue(review.schemaVersion, ["1.0.0"], "review.schemaVersion"),
      reviewId: boundedString(review.reviewId, "review.reviewId", {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.id,
        trim: true
      }),
      reviewOf: boundedString(review.reviewOf, "review.reviewOf", {
        min: 64,
        max: 64,
        pattern: REVIEW_OF_RE
      }),
      decision: enumValue(review.decision, ARTIFACT_REVIEW_DECISIONS, "review.decision"),
      overall: boundedString(review.overall, "review.overall", {
        max: ARTIFACT_REVIEW_LIMITS.text
      }),
      pins: pins.sort(compareTimestampThenId)
    };
    if (review.createdAt !== void 0) normalized3.createdAt = isoTimestamp(review.createdAt, "review.createdAt");
    if (review.updatedAt !== void 0) normalized3.updatedAt = isoTimestamp(review.updatedAt, "review.updatedAt");
    return deepFreezeArtifactReview(normalized3);
  }
  function createArtifactReview({ reviewId, reviewOf, createId = defaultCreateId } = {}) {
    const normalizedReviewId = reviewId === void 0 ? dependencyId(createId, "review") : boundedString(reviewId, "reviewId", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
    return normalizeArtifactReview({
      schemaVersion: "1.0.0",
      reviewId: normalizedReviewId,
      reviewOf: boundedString(reviewOf, "reviewOf", {
        min: 64,
        max: 64,
        pattern: REVIEW_OF_RE
      }),
      decision: "pending",
      overall: "",
      pins: []
    });
  }
  function replacePin(review, pin) {
    return review.pins.map((candidate) => candidate.id === pin.id ? pin : candidate);
  }
  function findPin(review, pinId) {
    const normalizedId = boundedString(pinId, "pinId", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
    const pin = review.pins.find(({ id }) => id === normalizedId);
    if (!pin) {
      throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_PIN_NOT_FOUND", `Unknown feedback pin: ${normalizedId}`);
    }
    return pin;
  }
  function preserveOptionalReviewTimestamps(review, next, timestamp) {
    if (review.createdAt !== void 0) next.createdAt = review.createdAt;
    if (review.updatedAt !== void 0) next.updatedAt = timestamp;
    return next;
  }
  function reduceArtifactReview(review, action, {
    createId = defaultCreateId,
    now = defaultNow
  } = {}) {
    const current = normalizeArtifactReview(review);
    if (!action || typeof action !== "object" || Array.isArray(action)) invalid("Review action must be an object.");
    const timestamp = dependencyTimestamp(now);
    let next;
    switch (action.type) {
      case "add-pin": {
        if (current.pins.length >= ARTIFACT_REVIEW_LIMITS.pins) {
          invalid(`A review can contain at most ${ARTIFACT_REVIEW_LIMITS.pins} pins.`);
        }
        const author = normalizeArtifactReviewIdentity(action.author);
        const pinInput = action.pin && typeof action.pin === "object" ? action.pin : {};
        const pinId = pinInput.id === void 0 ? uniqueDependencyId(createId, "pin", new Set(current.pins.map(({ id }) => id))) : boundedString(pinInput.id, "pin.id", {
          min: 1,
          max: ARTIFACT_REVIEW_LIMITS.id,
          trim: true
        });
        if (current.pins.some(({ id }) => id === pinId)) {
          throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_ID_COLLISION", `Duplicate pin id: ${pinId}`);
        }
        const pin = normalizePin({
          ...pinInput,
          id: pinId,
          author,
          status: pinInput.status ?? "open",
          replies: [],
          createdAt: pinInput.createdAt ?? timestamp,
          updatedAt: pinInput.updatedAt ?? timestamp
        });
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          pins: [...current.pins, pin]
        }, timestamp);
        break;
      }
      case "add-reply": {
        const pin = findPin(current, action.pinId);
        if (pin.replies.length >= ARTIFACT_REVIEW_LIMITS.replies) {
          invalid(`A feedback thread can contain at most ${ARTIFACT_REVIEW_LIMITS.replies} replies.`);
        }
        const replyId = action.id === void 0 ? uniqueDependencyId(createId, "reply", new Set(pin.replies.map(({ id }) => id))) : boundedString(action.id, "reply.id", {
          min: 1,
          max: ARTIFACT_REVIEW_LIMITS.id,
          trim: true
        });
        if (pin.replies.some(({ id }) => id === replyId)) {
          throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_ID_COLLISION", `Duplicate reply id: ${replyId}`);
        }
        const reply = normalizeReply({
          id: replyId,
          author: normalizeArtifactReviewIdentity(action.author),
          comment: action.comment,
          createdAt: action.createdAt ?? timestamp
        });
        const updatedPin = normalizePin({
          ...pin,
          replies: [...pin.replies, reply],
          updatedAt: timestamp
        });
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          pins: replacePin(current, updatedPin)
        }, timestamp);
        break;
      }
      case "set-status": {
        const pin = findPin(current, action.pinId);
        const updatedPin = normalizePin({
          ...pin,
          status: enumValue(action.status, ARTIFACT_REVIEW_STATUSES, "status"),
          updatedAt: timestamp
        });
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          pins: replacePin(current, updatedPin)
        }, timestamp);
        break;
      }
      case "set-overall":
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          overall: boundedString(action.overall, "overall", { max: ARTIFACT_REVIEW_LIMITS.text })
        }, timestamp);
        break;
      case "set-decision":
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          decision: enumValue(action.decision, ARTIFACT_REVIEW_DECISIONS, "decision")
        }, timestamp);
        break;
      default:
        throw new ArtifactReviewStateError(
          "E_ARTIFACT_REVIEW_ACTION_UNKNOWN",
          `Unknown artifact review action: ${String(action.type)}`
        );
    }
    return normalizeArtifactReview(next);
  }
  function createArtifactReviewController({
    initialReview = null,
    reviewOf,
    reviewId,
    identity = null,
    createId = defaultCreateId,
    now = defaultNow
  } = {}) {
    let review = initialReview === null || initialReview === void 0 ? null : normalizeArtifactReview(initialReview);
    if (review && reviewOf !== void 0 && review.reviewOf !== reviewOf) {
      throw new ArtifactReviewStateError(
        "E_ARTIFACT_REVIEW_DIGEST_MISMATCH",
        "The initial review does not match the artifact envelope digest."
      );
    }
    let localIdentity = normalizeArtifactReviewIdentity(identity, { allowEmpty: true });
    let activePinId = null;
    let destroyed = false;
    const listeners = /* @__PURE__ */ new Set();
    const assertAlive = () => {
      if (destroyed) {
        throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_DESTROYED", "Artifact review controller is destroyed.");
      }
    };
    const ensureReview = () => {
      review ??= createArtifactReview({ reviewId, reviewOf, createId });
      return review;
    };
    const getState = () => deepFreezeArtifactReview({
      review,
      identity: localIdentity,
      activePinId
    });
    const notify = (change) => {
      const state = getState();
      for (const listener of [...listeners]) listener(state, deepFreezeArtifactReview({ ...change }));
    };
    const controller = {
      getReview() {
        return review;
      },
      getState,
      getIdentity() {
        return localIdentity;
      },
      setIdentity(value) {
        assertAlive();
        localIdentity = normalizeArtifactReviewIdentity(value, { allowEmpty: true });
        notify({ type: "identity" });
        return localIdentity;
      },
      dispatch(action) {
        assertAlive();
        const authored = action?.type === "add-pin" || action?.type === "add-reply";
        const nextAction = authored && action.author === void 0 ? { ...action, author: localIdentity ?? identityRequired() } : action;
        const previousPinIds = nextAction?.type === "add-pin" ? new Set(review?.pins.map(({ id }) => id) ?? []) : null;
        review = reduceArtifactReview(ensureReview(), nextAction, { createId, now });
        if (previousPinIds) {
          activePinId = review.pins.find(({ id }) => !previousPinIds.has(id))?.id ?? activePinId;
        }
        notify({ type: "review", action: nextAction.type });
        return review;
      },
      replaceReview(value) {
        assertAlive();
        const next = value === null || value === void 0 ? null : normalizeArtifactReview(value);
        if (next && reviewOf !== void 0 && next.reviewOf !== reviewOf) {
          throw new ArtifactReviewStateError(
            "E_ARTIFACT_REVIEW_DIGEST_MISMATCH",
            "The replacement review does not match the artifact envelope digest."
          );
        }
        review = next;
        if (activePinId && !review?.pins.some(({ id }) => id === activePinId)) activePinId = null;
        notify({ type: "review-replaced" });
        return review;
      },
      selectPin(pinId) {
        assertAlive();
        if (pinId === null || pinId === void 0) {
          activePinId = null;
        } else {
          activePinId = findPin(ensureReview(), pinId).id;
        }
        notify({ type: "selection" });
        return activePinId;
      },
      subscribe(listener) {
        assertAlive();
        if (typeof listener !== "function") invalid("Review subscriber must be a function.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        listeners.clear();
        review = null;
        localIdentity = null;
        activePinId = null;
      }
    };
    return Object.freeze(controller);
  }
  function createElement(document2, tagName, { className, text: text3, attributes = {} } = {}) {
    const element = document2.createElement(tagName);
    if (className) element.className = className;
    if (text3 !== void 0) element.textContent = text3;
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== void 0 && value !== null) element.setAttribute(name, String(value));
    }
    return element;
  }
  function artifactReviewThreadDomId(pinId) {
    return annotationDomIds(pinId).thread;
  }
  function displayTimestamp(timestamp) {
    const canonical = new Date(timestamp).toISOString();
    return `${canonical.slice(0, 10)} ${canonical.slice(11, 16)} UTC`;
  }
  function renderReply(document2, reply) {
    const item = createElement(document2, "li", { className: "planr-reply" });
    const heading = createElement(document2, "header");
    heading.append(createElement(document2, "strong", { text: reply.author.name }));
    const time = createElement(document2, "time", {
      text: displayTimestamp(reply.createdAt),
      attributes: { datetime: reply.createdAt }
    });
    heading.append(time);
    item.append(heading, createElement(document2, "p", { text: reply.comment }));
    return item;
  }
  function renderReplyForm(document2, pin) {
    const form = createElement(document2, "form", {
      className: "planr-reply-form",
      attributes: { "data-planr-reply-form": pin.id }
    });
    const fieldId = `${annotationDomIds(pin.id).thread}-reply`;
    const label = createElement(document2, "label", {
      text: "Reply to thread",
      attributes: { for: fieldId }
    });
    const textarea = createElement(document2, "textarea", {
      attributes: {
        id: fieldId,
        name: "reply",
        maxlength: ARTIFACT_REVIEW_LIMITS.text,
        rows: 2,
        placeholder: "Add a reply…",
        required: "",
        "aria-describedby": "planr-review-error"
      }
    });
    const submit = createElement(document2, "button", {
      text: "Reply",
      attributes: { type: "submit" }
    });
    form.append(label, textarea, submit);
    return form;
  }
  function renderThread(document2, pin, active) {
    const article = createElement(document2, "article", {
      className: `planr-thread${active ? " is-active" : ""}`,
      attributes: {
        id: artifactReviewThreadDomId(pin.id),
        tabindex: "-1",
        "data-planr-pin-id": pin.id,
        "data-planr-intent": pin.intent,
        "data-planr-status": pin.status,
        "aria-controls": annotationDomIds(pin.id).pin,
        "aria-label": `${pin.intent} feedback by ${pin.author.name}`
      }
    });
    const header = createElement(document2, "header");
    const byline = createElement(document2, "div", { className: "planr-review-byline" });
    byline.append(
      createElement(document2, "strong", { text: pin.author.name }),
      createElement(document2, "span", { className: "planr-intent", text: pin.intent })
    );
    const time = createElement(document2, "time", {
      text: displayTimestamp(pin.createdAt),
      attributes: { datetime: pin.createdAt }
    });
    header.append(byline, time);
    const comment = createElement(document2, "p", {
      className: "planr-thread-comment",
      text: pin.comment
    });
    const lifecycle = createElement(document2, "div", { className: "planr-thread-actions" });
    lifecycle.append(
      createElement(document2, "span", { text: pin.status }),
      createElement(document2, "button", {
        text: pin.status === "resolved" ? "Reopen" : "Resolve",
        attributes: {
          type: "button",
          "data-planr-thread-action": pin.status === "resolved" ? "reopen" : "resolve",
          "data-planr-pin-id": pin.id
        }
      }),
      createElement(document2, "button", {
        text: "Show pin",
        attributes: {
          type: "button",
          "data-planr-thread-focus": pin.id,
          "aria-controls": annotationDomIds(pin.id).pin
        }
      })
    );
    const replies = createElement(document2, "ol", {
      className: "planr-replies",
      attributes: { "aria-label": "Replies" }
    });
    for (const reply of pin.replies) replies.append(renderReply(document2, reply));
    article.append(header, comment, lifecycle, replies, renderReplyForm(document2, pin));
    return article;
  }
  function decisionCopy(decision) {
    if (decision === "approved") return "Review approved";
    if (decision === "changes_requested") return "Changes requested";
    return "Decision pending";
  }
  function mountArtifactFeedbackRail({
    root,
    document: document2 = root?.ownerDocument,
    window = document2?.defaultView,
    controller: providedController,
    initialReview = null,
    reviewOf,
    reviewId,
    identity = null,
    createId = defaultCreateId,
    now = defaultNow,
    onSelectPin
  } = {}) {
    if (!root || !document2 || !window) invalid("A browser root, document, and window are required.");
    const slot = root.querySelector('[data-planr-slot="feedback-rail"]');
    const identityInput = root.querySelector("[data-planr-reviewer-name]");
    const identityStatus = root.querySelector("[data-planr-identity-status]");
    const overall = root.querySelector("#planr-overall-note");
    const decisionStatus = root.querySelector('[data-planr-slot="decision-status"]');
    const decisionButtons = [...root.querySelectorAll("[data-planr-decision]")];
    if (!slot || !identityInput || !overall || !decisionStatus || decisionButtons.length === 0) {
      invalid("Artifact feedback renderer slots are missing.");
    }
    const ownsController = !providedController;
    const controller = providedController ?? createArtifactReviewController({
      initialReview,
      reviewOf,
      reviewId,
      identity,
      createId,
      now
    });
    let destroyed = false;
    const showError = (error) => {
      const target = root.querySelector("#planr-review-error");
      if (!target) return;
      target.textContent = error?.message ?? String(error);
      target.hidden = false;
    };
    const clearError = () => {
      const target = root.querySelector("#planr-review-error");
      if (!target) return;
      target.textContent = "";
      target.hidden = true;
    };
    const announce2 = (message) => {
      decisionStatus.textContent = message;
      const live = root.parentElement?.querySelector('[data-planr-slot="review-announcer"]') ?? document2.querySelector('[data-planr-slot="review-announcer"]');
      if (live) live.textContent = message;
    };
    const updateCounts = (pins) => {
      for (const count2 of root.querySelectorAll('.planr-toolbar [data-planr-action="feedback"] .planr-count, .planr-review-rail > header .planr-count')) {
        count2.textContent = String(pins.length);
        count2.setAttribute("aria-label", `${pins.length} feedback items`);
      }
    };
    const render = () => {
      const { review, activePinId } = controller.getState();
      const pins = review?.pins ?? [];
      const fragment = document2.createDocumentFragment();
      const list = createElement(document2, "div", {
        className: "planr-thread-list",
        attributes: { "aria-label": "Feedback threads" }
      });
      if (pins.length === 0) {
        list.append(createElement(document2, "p", {
          className: "planr-review-empty",
          text: "Select Comment mode, then choose a point or region in the artifact."
        }));
      } else {
        for (const pin of pins) list.append(renderThread(document2, pin, pin.id === activePinId));
      }
      fragment.append(list);
      slot.replaceChildren(fragment);
      const identityName2 = controller.getIdentity()?.name ?? "";
      if (document2.activeElement !== identityInput) identityInput.value = identityName2;
      if (identityStatus) {
        identityStatus.dataset.planrIdentityReady = String(Boolean(identityName2));
        identityStatus.textContent = identityName2 ? `Comments will appear as ${identityName2}.` : "Used to sign your comments.";
      }
      overall.maxLength = ARTIFACT_REVIEW_LIMITS.text;
      overall.value = review?.overall ?? "";
      for (const button of decisionButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.planrDecision === (review?.decision ?? "pending")));
      }
      decisionStatus.textContent = decisionCopy(review?.decision ?? "pending");
      updateCounts(pins);
      const openMetric = root.querySelector('[data-planr-metric="open"]');
      if (openMetric) openMetric.textContent = `${pins.filter(({ status }) => status !== "resolved").length} open`;
    };
    const focusThread = (pinId) => {
      const thread = document2.getElementById(artifactReviewThreadDomId(pinId));
      thread?.focus({ preventScroll: true });
      thread?.scrollIntoView?.({ block: "nearest" });
    };
    const emitReview = (review) => {
      const detail = cloneFrozenArtifactReview(review);
      root.dispatchEvent(new window.CustomEvent(ARTIFACT_REVIEW_CHANGE_EVENT, {
        detail,
        bubbles: true
      }));
    };
    const unsubscribe = controller.subscribe((state, change) => {
      if (destroyed) return;
      if (["review", "review-replaced", "selection"].includes(change.type)) render();
      if (["review", "review-replaced"].includes(change.type) && state.review) emitReview(state.review);
    });
    const onInput = (event) => {
      if (event.target !== identityInput) return;
      try {
        controller.setIdentity(event.target.value ? { name: event.target.value } : null);
        const name = controller.getIdentity()?.name ?? "";
        if (identityStatus) {
          identityStatus.dataset.planrIdentityReady = String(Boolean(name));
          identityStatus.textContent = name ? `Comments will appear as ${name}.` : "Used to sign your comments.";
        }
        clearError();
      } catch (error) {
        showError(error);
      }
    };
    const onKeyDown = (event) => {
      if (event.key !== "Enter" || event.isComposing || !event.metaKey && !event.ctrlKey) return;
      const form = event.target?.closest?.("[data-planr-reply-form]");
      if (!form) return;
      event.preventDefault();
      form.requestSubmit();
    };
    const emitSelection = (pinId) => {
      controller.selectPin(pinId);
      root.dispatchEvent(new window.CustomEvent(ARTIFACT_REVIEW_SELECT_EVENT, {
        detail: deepFreezeArtifactReview({ pinId, source: "thread" }),
        bubbles: true
      }));
      onSelectPin?.(pinId);
    };
    const onClick = (event) => {
      const action = event.target?.closest?.("[data-planr-thread-action]");
      const focus = event.target?.closest?.("[data-planr-thread-focus]");
      if (action) {
        try {
          const pinId = action.dataset.planrPinId;
          controller.dispatch({
            type: "set-status",
            pinId,
            status: action.dataset.planrThreadAction === "resolve" ? "resolved" : "open"
          });
          announce2(action.dataset.planrThreadAction === "resolve" ? "Feedback resolved" : "Feedback reopened");
          focusThread(pinId);
          clearError();
        } catch (error) {
          showError(error);
        }
        return;
      }
      if (focus) emitSelection(focus.dataset.planrThreadFocus);
    };
    const onSubmit = (event) => {
      const form = event.target?.closest?.("[data-planr-reply-form]");
      if (!form) return;
      event.preventDefault();
      const textarea = form.elements.namedItem("reply");
      try {
        textarea.setAttribute("aria-invalid", "false");
        controller.dispatch({
          type: "add-reply",
          pinId: form.dataset.planrReplyForm,
          comment: textarea.value
        });
        announce2("Reply added");
        focusThread(form.dataset.planrReplyForm);
        clearError();
      } catch (error) {
        textarea?.setAttribute("aria-invalid", "true");
        showError(error);
        textarea?.focus();
      }
    };
    const onOverallChange = () => {
      try {
        controller.dispatch({ type: "set-overall", overall: overall.value });
        announce2("Overall note updated");
        clearError();
      } catch (error) {
        showError(error);
      }
    };
    const onDecision = (event) => {
      try {
        const selected = event.currentTarget.dataset.planrDecision;
        const decision = controller.getReview()?.decision === selected ? "pending" : selected;
        controller.dispatch({ type: "set-decision", decision });
        announce2(decisionCopy(decision));
        clearError();
      } catch (error) {
        showError(error);
      }
    };
    const onSelect = (event) => {
      if (event.detail?.source === "thread" || typeof event.detail?.pinId !== "string") return;
      try {
        controller.selectPin(event.detail.pinId);
        focusThread(event.detail.pinId);
      } catch (error) {
        showError(error);
      }
    };
    identityInput.addEventListener("input", onInput);
    slot.addEventListener("click", onClick);
    slot.addEventListener("submit", onSubmit);
    slot.addEventListener("keydown", onKeyDown);
    overall.addEventListener("change", onOverallChange);
    for (const button of decisionButtons) button.addEventListener("click", onDecision);
    root.addEventListener(ARTIFACT_REVIEW_SELECT_EVENT, onSelect);
    render();
    return Object.freeze({
      controller,
      getReview: () => controller.getReview(),
      getState: () => controller.getState(),
      getIdentity: () => controller.getIdentity(),
      setIdentity: (value) => controller.setIdentity(value),
      dispatch: (action) => controller.dispatch(action),
      replaceReview: (review) => controller.replaceReview(review),
      selectPin: (pinId) => controller.selectPin(pinId),
      render,
      focusThread,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsubscribe();
        identityInput.removeEventListener("input", onInput);
        slot.removeEventListener("click", onClick);
        slot.removeEventListener("submit", onSubmit);
        slot.removeEventListener("keydown", onKeyDown);
        overall.removeEventListener("change", onOverallChange);
        for (const button of decisionButtons) button.removeEventListener("click", onDecision);
        root.removeEventListener(ARTIFACT_REVIEW_SELECT_EVENT, onSelect);
        if (ownsController) controller.destroy();
      }
    });
  }

  // lib/artifact/ui/share-dialog.mjs
  var ARTIFACT_SHARE_FRAGMENT_LIMIT = 8e3;
  var ARTIFACT_SHARE_TTLS = Object.freeze({
    "1d": Object.freeze({ label: "1 day", milliseconds: 864e5 }),
    "7d": Object.freeze({ label: "7 days", milliseconds: 6048e5 }),
    "30d": Object.freeze({ label: "30 days", milliseconds: 2592e6 })
  });
  var ARTIFACT_SHARE_TRANSPORTS = Object.freeze(["live", "fragment", "short"]);
  var PHASES = Object.freeze(["idle", "previewing", "ready", "creating", "created", "error"]);
  var ArtifactShareUiError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "ArtifactShareUiError";
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  };
  function member(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }
  function count(value, name) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_PREVIEW_INVALID",
        `${name} must be a non-negative integer.`,
        { field: name }
      );
    }
    return value;
  }
  function text2(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }
  function frozenResult(value) {
    if (!value || typeof value !== "object" || typeof value.url !== "string" || value.url.length === 0) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Share creation must return a non-empty review URL."
      );
    }
    if (!ARTIFACT_SHARE_TRANSPORTS.includes(value.transport)) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Share creation must return a known transport.",
        { field: "transport" }
      );
    }
    const deletionToken = text2(value.deletionToken);
    const manageUrl = text2(value.manageUrl);
    if (deletionToken && value.url.includes(deletionToken)) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_DELETION_TOKEN_LEAK",
        "The deletion token must never be included in the review URL."
      );
    }
    return Object.freeze({
      transport: value.transport,
      url: value.url,
      manageUrl,
      deletionToken,
      expiresAt: text2(value.expiresAt)
    });
  }
  function normalizeArtifactSharePreview(value = {}) {
    const preview = value && typeof value === "object" ? value : {};
    const fragmentLength = count(preview.fragmentLength ?? 0, "fragmentLength");
    return Object.freeze({
      fragmentLength,
      compressedBytes: count(preview.compressedBytes ?? 0, "compressedBytes"),
      ciphertextBytes: count(preview.ciphertextBytes ?? 0, "ciphertextBytes"),
      fragmentEligible: fragmentLength <= ARTIFACT_SHARE_FRAGMENT_LIMIT
    });
  }
  function freezeState(value) {
    return Object.freeze({
      open: Boolean(value.open),
      phase: member(value.phase, PHASES, "idle"),
      transport: member(value.transport, ARTIFACT_SHARE_TRANSPORTS, "live"),
      ttl: Object.hasOwn(ARTIFACT_SHARE_TTLS, value.ttl) ? value.ttl : "7d",
      preview: value.preview ? normalizeArtifactSharePreview(value.preview) : null,
      result: value.result ? frozenResult(value.result) : null,
      error: text2(value.error)
    });
  }
  function createArtifactShareDialogState({ preview, ttl = "7d" } = {}) {
    const normalizedPreview = preview ? normalizeArtifactSharePreview(preview) : null;
    return freezeState({
      open: false,
      phase: normalizedPreview ? "ready" : "idle",
      transport: "live",
      ttl,
      preview: normalizedPreview,
      result: null,
      error: ""
    });
  }
  function reduceArtifactShareDialog(state, action = {}) {
    const current = state ?? createArtifactShareDialogState();
    switch (action.type) {
      case "open":
        return freezeState({ ...current, open: true, result: null, error: "" });
      case "close":
        return freezeState({ ...current, open: false, phase: current.preview ? "ready" : "idle", error: "" });
      case "preview-start":
        return freezeState({ ...current, open: true, phase: "previewing", preview: null, result: null, error: "" });
      case "preview-ready": {
        const preview = normalizeArtifactSharePreview(action.preview);
        return freezeState({
          ...current,
          phase: "ready",
          preview,
          transport: current.transport === "fragment" && !preview.fragmentEligible ? "short" : current.transport,
          result: null,
          error: ""
        });
      }
      case "select-transport": {
        const transport = member(action.transport, ARTIFACT_SHARE_TRANSPORTS, current.transport);
        if (transport === "fragment" && current.preview?.fragmentEligible === false) return current;
        return transport === current.transport ? current : freezeState({ ...current, transport, result: null, error: "" });
      }
      case "set-ttl": {
        const ttl = Object.hasOwn(ARTIFACT_SHARE_TTLS, action.ttl) ? action.ttl : current.ttl;
        return ttl === current.ttl ? current : freezeState({ ...current, ttl, result: null, error: "" });
      }
      case "create-start":
        return freezeState({ ...current, phase: "creating", result: null, error: "" });
      case "create-success":
        return freezeState({ ...current, phase: "created", result: action.result, error: "" });
      case "failure":
        return freezeState({ ...current, phase: "error", result: null, error: text2(action.error, "Share creation failed.") });
      default:
        return current;
    }
  }
  function artifactShareExpiry(ttl, now = /* @__PURE__ */ new Date()) {
    const choice = ARTIFACT_SHARE_TTLS[ttl] ?? ARTIFACT_SHARE_TTLS["7d"];
    const base = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(base)) throw new TypeError("Share expiry requires a valid date.");
    return new Date(base + choice.milliseconds).toISOString();
  }
  function formatArtifactShareBytes(value) {
    const bytes = count(value, "bytes");
    if (bytes < 1e3) return `${bytes} B`;
    if (bytes < 1e6) return `${(bytes / 1e3).toFixed(bytes >= 1e4 ? 0 : 1)} KB`;
    return `${(bytes / 1e6).toFixed(1)} MB`;
  }
  function focusableElements(dialog) {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden && !element.closest("[hidden]"));
  }
  function defaultCopy(window, value) {
    if (typeof window?.navigator?.clipboard?.writeText !== "function") {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_CLIPBOARD_UNAVAILABLE",
        "Clipboard access is unavailable. Copy the value manually."
      );
    }
    return window.navigator.clipboard.writeText(value);
  }
  function reviewForShare(stageController) {
    return stageController?.review?.getReview?.() ?? null;
  }
  function mountArtifactShareDialog({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    root = document2?.querySelector?.(".planr-shell"),
    stageController,
    prepareShare,
    createShare,
    copyText,
    existingRoom = false,
    existingShareUrl = null,
    now = () => /* @__PURE__ */ new Date()
  } = {}) {
    if (!document2 || !window || !root) return null;
    const backdrop = document2.querySelector("[data-planr-share-dialog]");
    const dialog = backdrop?.querySelector('[role="dialog"]');
    const trigger = root.querySelector('[data-planr-action="share"]');
    if (!backdrop || !dialog || !trigger) return null;
    let state = createArtifactShareDialogState();
    let returnFocus = null;
    let generation = 0;
    const copyResetTimers = /* @__PURE__ */ new Map();
    const cleanup = [];
    const handlers = {
      prepareShare: typeof prepareShare === "function" ? prepareShare : async () => ({ fragmentLength: 0, compressedBytes: 0, ciphertextBytes: 0 }),
      createShare: typeof createShare === "function" ? createShare : async () => {
        throw new ArtifactShareUiError(
          "E_ARTIFACT_SHARE_HANDLER_REQUIRED",
          "Share creation is unavailable in this host."
        );
      },
      copyText: typeof copyText === "function" ? copyText : (value) => defaultCopy(window, value)
    };
    const stableShareUrl = typeof existingShareUrl === "function" ? existingShareUrl : () => existingShareUrl;
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function announce2(message) {
      const live = dialog.querySelector("[data-planr-share-status]");
      if (live) live.textContent = message;
    }
    function resetCopyButton(button) {
      const timer = copyResetTimers.get(button);
      if (timer) window.clearTimeout(timer);
      copyResetTimers.delete(button);
      button.removeAttribute("data-planr-copy-state");
      button.textContent = button.dataset.planrCopyLabel ?? button.textContent;
    }
    function showCopyState(button, stateValue) {
      if (!button) return;
      if (!button.dataset.planrCopyLabel) button.dataset.planrCopyLabel = button.textContent.trim();
      const prior = copyResetTimers.get(button);
      if (prior) window.clearTimeout(prior);
      button.dataset.planrCopyState = stateValue;
      button.textContent = stateValue === "copied" ? "Copied" : "Try again";
      copyResetTimers.set(button, window.setTimeout(() => resetCopyButton(button), 1800));
    }
    function resetCopyButtons() {
      for (const button of dialog.querySelectorAll("[data-planr-copy-state]")) resetCopyButton(button);
    }
    async function copyExistingRoom() {
      const value = stableShareUrl();
      if (!value) return;
      try {
        await handlers.copyText(value);
        showCopyState(trigger, "copied");
        announce2("Live review URL copied. This remains the same collaboration room.");
      } catch (error) {
        showCopyState(trigger, "error");
        announce2(error?.message ?? "Review URL could not be copied.");
      }
    }
    function render() {
      const preview = state.preview;
      backdrop.hidden = !state.open;
      backdrop.style.pointerEvents = state.open ? "auto" : "";
      root.toggleAttribute("inert", state.open);
      root.setAttribute("aria-hidden", String(state.open));
      if (!state.open) root.removeAttribute("aria-hidden");
      dialog.dataset.planrSharePhase = state.phase;
      dialog.dataset.planrShareSelected = state.transport;
      for (const button of dialog.querySelectorAll("[data-planr-share-transport]")) {
        const transport = button.dataset.planrShareTransport;
        const selected = transport === state.transport;
        button.setAttribute("aria-pressed", String(selected));
        button.classList.toggle("is-selected", selected);
        button.disabled = state.phase === "previewing" || state.phase === "creating" || transport === "fragment" && preview?.fragmentEligible === false;
      }
      const fragmentSize = dialog.querySelector("[data-planr-share-fragment-size]");
      if (fragmentSize) fragmentSize.textContent = preview ? `${preview.fragmentLength.toLocaleString("en-US")} chars · ${formatArtifactShareBytes(preview.compressedBytes)}` : "Calculating…";
      const shortSize = dialog.querySelector("[data-planr-share-short-size]");
      if (shortSize) shortSize.textContent = preview ? formatArtifactShareBytes(preview.ciphertextBytes) : "Calculating…";
      const threshold = dialog.querySelector("[data-planr-share-threshold]");
      if (threshold) {
        threshold.textContent = preview?.fragmentEligible === false ? `Private fragment snapshot unavailable (${preview.fragmentLength.toLocaleString("en-US")} characters; 8,000 limit). Live review and encrypted short link are available.` : "Private fragment snapshot available for links up to 8,000 characters.";
      }
      const ttlRow = dialog.querySelector("[data-planr-share-ttl-row]");
      if (ttlRow) ttlRow.hidden = !["live", "short"].includes(state.transport);
      const ttlSelect2 = dialog.querySelector("[data-planr-share-ttl]");
      if (ttlSelect2) {
        ttlSelect2.value = state.ttl;
        ttlSelect2.disabled = state.phase === "creating";
      }
      const expiry = artifactShareExpiry(state.ttl, now());
      const expiryNode = dialog.querySelector("[data-planr-share-expiry]");
      if (expiryNode) {
        expiryNode.dateTime = expiry;
        expiryNode.textContent = new Intl.DateTimeFormat("en", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC"
        }).format(new Date(expiry));
      }
      const primary = dialog.querySelector("[data-planr-share-confirm]");
      if (primary) {
        primary.disabled = !preview || state.phase === "previewing" || state.phase === "creating";
        primary.textContent = state.phase === "creating" ? "Creating…" : state.transport === "live" ? "Create live review room" : state.transport === "short" ? "Create encrypted link" : "Copy private link";
      }
      const receipt = dialog.querySelector("[data-planr-share-result]");
      if (receipt) receipt.hidden = state.phase !== "created" || !state.result;
      const resultUrl = dialog.querySelector("[data-planr-share-url]");
      if (resultUrl) resultUrl.value = state.result?.url ?? "";
      const manage = dialog.querySelector("[data-planr-share-manage]");
      if (manage) manage.hidden = !state.result?.manageUrl;
      const manageUrl = dialog.querySelector("[data-planr-share-manage-url]");
      if (manageUrl) manageUrl.value = state.result?.manageUrl ?? "";
      const deletion = dialog.querySelector("[data-planr-share-deletion]");
      if (deletion) deletion.hidden = !state.result?.deletionToken;
      const deletionToken = dialog.querySelector("[data-planr-share-deletion-token]");
      if (deletionToken) deletionToken.textContent = state.result?.deletionToken ?? "";
      const error = dialog.querySelector("[data-planr-share-error]");
      if (error) {
        error.hidden = !state.error;
        error.textContent = state.error;
      }
    }
    async function open() {
      resetCopyButtons();
      returnFocus = document2.activeElement instanceof window.HTMLElement ? document2.activeElement : trigger;
      state = reduceArtifactShareDialog(state, { type: "open" });
      state = reduceArtifactShareDialog(state, { type: "preview-start" });
      render();
      dialog.querySelector("[data-planr-share-close]")?.focus();
      const request = ++generation;
      try {
        const preview = await handlers.prepareShare(Object.freeze({
          review: reviewForShare(stageController),
          fragmentLimit: ARTIFACT_SHARE_FRAGMENT_LIMIT
        }));
        if (request !== generation || !state.open) return state;
        state = reduceArtifactShareDialog(state, { type: "preview-ready", preview });
        render();
        announce2(state.preview.fragmentEligible ? "Private fragment is available. Nothing will be uploaded." : "Private fragment snapshot is unavailable at this size. Live review and encrypted short link remain available.");
      } catch (error) {
        if (request !== generation || !state.open) return state;
        state = reduceArtifactShareDialog(state, { type: "failure", error: error?.message });
        render();
        announce2(state.error);
      }
      return state;
    }
    function close() {
      generation += 1;
      state = reduceArtifactShareDialog(state, { type: "close" });
      resetCopyButtons();
      render();
      returnFocus?.focus?.();
      returnFocus = null;
      return state;
    }
    async function confirm() {
      if (!state.preview || state.phase === "creating") return state;
      const transport = state.transport;
      const request = generation;
      state = reduceArtifactShareDialog(state, { type: "create-start" });
      render();
      try {
        const result = await handlers.createShare(Object.freeze({
          review: reviewForShare(stageController),
          preview: state.preview,
          transport,
          ttl: ["live", "short"].includes(transport) ? state.ttl : void 0,
          confirmed: ["live", "short"].includes(transport)
        }));
        if (request !== generation || !state.open) return state;
        state = reduceArtifactShareDialog(state, {
          type: "create-success",
          result: { ...result, transport }
        });
        render();
        await handlers.copyText(state.result.url);
        announce2(transport === "live" ? "Live review URL copied. Save the separate private manage URL." : transport === "short" ? "Encrypted short link copied. Store the one-time deletion token now." : "Private fragment copied. Nothing was uploaded.");
      } catch (error) {
        if (request !== generation || !state.open) return state;
        state = reduceArtifactShareDialog(state, { type: "failure", error: error?.message });
        render();
        announce2(state.error);
      }
      return state;
    }
    async function copy(value, successMessage, button) {
      if (!value) return;
      try {
        await handlers.copyText(value);
        showCopyState(button, "copied");
        announce2(successMessage);
      } catch (error) {
        showCopyState(button, "error");
        state = reduceArtifactShareDialog(state, { type: "failure", error: error?.message });
        render();
        announce2(state.error);
      }
    }
    if (existingRoom) {
      const value = stableShareUrl();
      if (value) {
        trigger.textContent = "Copy link";
        trigger.dataset.planrCopyLabel = "Copy link";
        trigger.removeAttribute("aria-haspopup");
        trigger.setAttribute("aria-label", "Copy this live review room link");
        listen(trigger, "click", () => {
          void copyExistingRoom();
        });
      } else {
        trigger.hidden = true;
      }
    } else {
      listen(trigger, "click", open);
    }
    listen(backdrop, "click", (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      if (button.dataset.planrShareClose !== void 0 || button.dataset.planrShareCancel !== void 0) {
        close();
        return;
      }
      if (button.dataset.planrShareTransport) {
        state = reduceArtifactShareDialog(state, {
          type: "select-transport",
          transport: button.dataset.planrShareTransport
        });
        render();
        announce2(state.transport === "live" ? "Live encrypted review selected. Anyone with this link can comment." : state.transport === "short" ? "Encrypted short link selected. Creation requires confirmation." : "Private fragment selected. Nothing will be uploaded.");
        return;
      }
      if (button.dataset.planrShareConfirm !== void 0) {
        void confirm();
        return;
      }
      if (button.dataset.planrShareCopyUrl !== void 0) {
        void copy(state.result?.url, "Review URL copied.", button);
        return;
      }
      if (button.dataset.planrShareCopyManage !== void 0) {
        void copy(state.result?.manageUrl, "Private manage URL copied. Keep it private.", button);
        return;
      }
      if (button.dataset.planrShareCopyDeletion !== void 0) {
        void copy(state.result?.deletionToken, "One-time deletion token copied.", button);
      }
    });
    const ttlSelect = dialog.querySelector("[data-planr-share-ttl]");
    if (ttlSelect) listen(ttlSelect, "change", () => {
      state = reduceArtifactShareDialog(state, { type: "set-ttl", ttl: ttlSelect.value });
      render();
      announce2(`Expiry set to ${ARTIFACT_SHARE_TTLS[state.ttl].label}.`);
    });
    listen(document2, "keydown", (event) => {
      if (!state.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document2.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document2.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }, true);
    render();
    const controller = Object.freeze({
      getState: () => state,
      open,
      close,
      confirm,
      dispatch(action) {
        state = reduceArtifactShareDialog(state, action);
        render();
        return state;
      },
      destroy() {
        generation += 1;
        for (const timer of copyResetTimers.values()) window.clearTimeout(timer);
        copyResetTimers.clear();
        for (const remove of cleanup.splice(0)) remove();
        if (state.open) {
          state = reduceArtifactShareDialog(state, { type: "close" });
          render();
        }
      }
    });
    window.__openPlanrArtifactShare = controller;
    return controller;
  }

  // lib/artifact/ui/hosted-viewer.mjs
  var HOSTED_ARTIFACT_VIEWER_STATES = Object.freeze([
    "idle",
    "empty-hash",
    "loading",
    "ready",
    "invalid-version",
    "malformed-payload",
    "too-large",
    "paste-missing",
    "expired",
    "decryption-failed",
    "unsupported-browser",
    "network-error",
    "room-closed"
  ]);
  var HOSTED_ARTIFACT_STATE_COPY = Object.freeze({
    "empty-hash": Object.freeze({
      title: "Open a private review link",
      detail: "This page needs a complete OpenPlanr fragment or encrypted short-link URL.",
      action: ""
    }),
    loading: Object.freeze({
      title: "Loading private review",
      detail: "Validating the immutable payload before opening the artifact.",
      action: ""
    }),
    "invalid-version": Object.freeze({
      title: "This review version is not supported",
      detail: "Ask the sender to create a new link with a compatible OpenPlanr release.",
      action: ""
    }),
    "malformed-payload": Object.freeze({
      title: "This review link is incomplete",
      detail: "Copy the complete URL again, including everything after the # character.",
      action: ""
    }),
    "too-large": Object.freeze({
      title: "This private fragment is too large",
      detail: "Ask the sender to create an encrypted expiring short link instead.",
      action: ""
    }),
    "paste-missing": Object.freeze({
      title: "This encrypted review is unavailable",
      detail: "It may have been deleted. Ask the sender for a new immutable review link.",
      action: ""
    }),
    expired: Object.freeze({
      title: "This encrypted review expired",
      detail: "Ask the sender for a new immutable review link.",
      action: ""
    }),
    "decryption-failed": Object.freeze({
      title: "This key cannot decrypt the review",
      detail: "Use the complete link, including its private fragment key. The payload may also have been changed.",
      action: ""
    }),
    "unsupported-browser": Object.freeze({
      title: "Browser support is required",
      detail: "Use a current browser with raw DEFLATE and Web Crypto support.",
      action: ""
    }),
    "network-error": Object.freeze({
      title: "The encrypted review could not be loaded",
      detail: "Your link remains unchanged. Check the connection and try again safely.",
      action: "Try again"
    }),
    "room-closed": Object.freeze({
      title: "Comments are paused",
      detail: "This review remains available to read, but the owner has paused new feedback.",
      action: ""
    })
  });
  var HostedArtifactViewerError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "HostedArtifactViewerError";
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  };
  function freezeState2(value) {
    const status = HOSTED_ARTIFACT_VIEWER_STATES.includes(value.status) ? value.status : "idle";
    return Object.freeze({
      status,
      transport: ["fragment", "short", "room"].includes(value.transport) ? value.transport : null,
      request: value.request ? Object.freeze({ ...value.request }) : null,
      envelope: value.envelope ?? null,
      retryable: status === "network-error"
    });
  }
  function locationParts(location) {
    if (typeof location === "string") {
      const parsed = new URL(location, "https://share.openplanr.dev/");
      return { pathname: parsed.pathname, hash: parsed.hash };
    }
    return {
      pathname: typeof location?.pathname === "string" ? location.pathname : "/",
      hash: typeof location?.hash === "string" ? location.hash : ""
    };
  }
  function malformed(status, details = {}) {
    return Object.freeze({ ok: false, status, details: Object.freeze(details) });
  }
  function parseHostedArtifactLocation(location, {
    fragmentLimit = ARTIFACT_SHARE_FRAGMENT_LIMIT
  } = {}) {
    const { pathname, hash } = locationParts(location);
    const shortMatch = pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/?$/);
    if (shortMatch) {
      if (!hash.startsWith("#k=")) return malformed("malformed-payload", { transport: "short" });
      const key = hash.slice(3);
      if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
        return malformed("malformed-payload", { transport: "short" });
      }
      return Object.freeze({
        ok: true,
        transport: "short",
        id: shortMatch[1],
        key
      });
    }
    const roomMatch = pathname.match(/^\/r\/([A-Za-z0-9_-]{16,128})\/?$/);
    if (roomMatch) {
      const params = new URLSearchParams(hash.slice(1));
      const key = params.get("k");
      const write = params.get("w");
      const manage = params.get("m");
      if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key) || write && manage || write && !/^[A-Za-z0-9_-]{43}$/.test(write) || manage && !/^[A-Za-z0-9_-]{43}$/.test(manage)) {
        return malformed("malformed-payload", { transport: "room" });
      }
      return Object.freeze({ ok: true, transport: "room", id: roomMatch[1], key, ...write ? { write } : {}, ...manage ? { manage } : {} });
    }
    if (!hash || hash === "#") return malformed("empty-hash");
    const fragment = hash.slice(1);
    if (fragment.length > fragmentLimit) {
      return malformed("too-large", { fragmentLength: fragment.length, fragmentLimit });
    }
    if (!fragment.startsWith("v1.")) {
      return malformed(/^v\d+\./.test(fragment) ? "invalid-version" : "malformed-payload");
    }
    const payload = fragment.slice(3);
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return malformed("malformed-payload");
    return Object.freeze({ ok: true, transport: "fragment", version: "v1", payload });
  }
  function hostedArtifactStateForError(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    if (["E_ARTIFACT_BROWSER_UNSUPPORTED", "E_ARTIFACT_CODEC_UNSUPPORTED"].includes(code)) {
      return "unsupported-browser";
    }
    if (["E_ARTIFACT_FRAGMENT_TOO_LARGE", "E_ARTIFACT_PAYLOAD_TOO_LARGE", "E_ARTIFACT_DECOMPRESSION_LIMIT"].includes(code)) {
      return "too-large";
    }
    if (["E_ARTIFACT_PASTE_NOT_FOUND", "E_ARTIFACT_SHARE_NOT_FOUND", "E_ARTIFACT_PASTE_UNAVAILABLE"].includes(code)) {
      return "paste-missing";
    }
    if (["E_ARTIFACT_PASTE_EXPIRED", "E_ARTIFACT_SHARE_EXPIRED"].includes(code)) {
      return "expired";
    }
    if (["E_ARTIFACT_DECRYPTION_FAILED", "E_ARTIFACT_AUTH_FAILED", "E_ARTIFACT_PAYLOAD_TAMPERED", "OperationError"].includes(code)) {
      return "decryption-failed";
    }
    if (["E_ARTIFACT_SHARE_NETWORK", "E_ARTIFACT_NETWORK", "E_ARTIFACT_FETCH_FAILED"].includes(code) || error?.name === "TypeError") {
      return "network-error";
    }
    if (["E_ARTIFACT_VERSION_UNSUPPORTED", "E_ARTIFACT_FRAGMENT_VERSION", "E_ARTIFACT_FRAGMENT_VERSION_UNSUPPORTED"].includes(code)) {
      return "invalid-version";
    }
    if (code === "E_ARTIFACT_PASTE_INVALID") return "malformed-payload";
    return "malformed-payload";
  }
  function setCopy(document2, status) {
    const copy = HOSTED_ARTIFACT_STATE_COPY[status] ?? { title: "", detail: "", action: "" };
    const title = document2.querySelector("[data-planr-hosted-title]");
    const detail = document2.querySelector("[data-planr-hosted-detail]");
    const action = document2.querySelector("[data-planr-hosted-retry]");
    if (title) title.textContent = copy.title;
    if (detail) detail.textContent = copy.detail;
    if (action) {
      action.textContent = copy.action;
      action.hidden = !copy.action;
    }
  }
  function mountHostedArtifactViewer({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    enabled = false,
    location = window?.location,
    decodeFragment,
    loadShort,
    loadRoom,
    onEnvelope,
    supportsTransport = () => true,
    fragmentLimit = ARTIFACT_SHARE_FRAGMENT_LIMIT
  } = {}) {
    if (!enabled || !document2 || !window) return null;
    const slot = document2.querySelector("[data-planr-hosted-viewer]");
    if (!slot) return null;
    let state = freezeState2({ status: "idle" });
    let generation = 0;
    const cleanup = [];
    function render() {
      const visible = !["idle", "ready"].includes(state.status);
      slot.hidden = !visible;
      slot.dataset.planrHostedState = state.status;
      slot.setAttribute("aria-busy", String(state.status === "loading"));
      setCopy(document2, state.status);
    }
    function setState(next) {
      state = freezeState2(next);
      render();
      return state;
    }
    async function load() {
      const parsed = parseHostedArtifactLocation(location, { fragmentLimit });
      if (!parsed.ok) return setState({ status: parsed.status });
      const request = parsed.transport === "fragment" ? { transport: "fragment", version: parsed.version, payload: parsed.payload } : { transport: parsed.transport, id: parsed.id, key: parsed.key, ...parsed.write ? { write: parsed.write } : {}, ...parsed.manage ? { manage: parsed.manage } : {} };
      if (!supportsTransport(parsed.transport)) {
        return setState({ status: "unsupported-browser", transport: parsed.transport, request });
      }
      const sequence = ++generation;
      setState({ status: "loading", transport: parsed.transport, request });
      try {
        const envelope = parsed.transport === "fragment" ? await (typeof decodeFragment === "function" ? decodeFragment(Object.freeze({ version: parsed.version, payload: parsed.payload })) : Promise.reject(new HostedArtifactViewerError(
          "E_ARTIFACT_CODEC_UNSUPPORTED",
          "No private-fragment decoder is installed."
        ))) : parsed.transport === "short" ? await (typeof loadShort === "function" ? loadShort(Object.freeze({ id: parsed.id, key: parsed.key })) : Promise.reject(new HostedArtifactViewerError(
          "E_ARTIFACT_BROWSER_UNSUPPORTED",
          "No encrypted short-link loader is installed."
        ))) : await (typeof loadRoom === "function" ? loadRoom(Object.freeze({ id: parsed.id, key: parsed.key, ...parsed.write ? { write: parsed.write } : {}, ...parsed.manage ? { manage: parsed.manage } : {} })) : Promise.reject(new HostedArtifactViewerError("E_ARTIFACT_BROWSER_UNSUPPORTED", "No live review room loader is installed.")));
        if (sequence !== generation) return state;
        setState({ status: "ready", transport: parsed.transport, request, envelope });
        if (typeof onEnvelope === "function") await onEnvelope(envelope, Object.freeze({ transport: parsed.transport }));
      } catch (error) {
        if (sequence !== generation) return state;
        setState({ status: hostedArtifactStateForError(error), transport: parsed.transport, request });
      }
      return state;
    }
    function onClick(event) {
      if (!event.target.closest?.("[data-planr-hosted-retry]") || !state.retryable) return;
      void load();
    }
    slot.addEventListener("click", onClick);
    cleanup.push(() => slot.removeEventListener("click", onClick));
    render();
    const ready = load();
    const controller = Object.freeze({
      getState: () => state,
      ready,
      retry() {
        return state.retryable ? load() : Promise.resolve(state);
      },
      load,
      destroy() {
        generation += 1;
        for (const remove of cleanup.splice(0)) remove();
      }
    });
    window.__openPlanrHostedArtifactViewer = controller;
    return controller;
  }

  // lib/artifact/ui/stage-payload.mjs
  var PRESENTATIONS = Object.freeze(["document", "canvas"]);
  function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
  function freezeArtifactMetadata(artifact, index) {
    if (!artifact || typeof artifact !== "object") {
      throw new TypeError(`Artifact ${index + 1} must be an object.`);
    }
    if (typeof artifact.id !== "string" || artifact.id.length === 0) {
      throw new TypeError(`Artifact ${index + 1} requires an id.`);
    }
    return Object.freeze({
      id: artifact.id,
      title: typeof artifact.title === "string" && artifact.title.length > 0 ? artifact.title : `Artifact ${index + 1}`,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : "",
      viewport: Object.freeze({
        width: positiveInteger(artifact.viewport?.width, 1440),
        height: positiveInteger(artifact.viewport?.height, 900)
      }),
      colorScheme: ["light", "dark"].includes(artifact.colorScheme) ? artifact.colorScheme : "light"
    });
  }
  function requestedArtifactId(value) {
    if (typeof value === "string") return value;
    return typeof value?.id === "string" ? value.id : "";
  }
  function availableId(artifacts, requested, fallback = "") {
    return artifacts.some(({ id }) => id === requested) ? requested : fallback;
  }
  function normalizeViewMode(value, artifactCount) {
    if (artifactCount < 2) return "single";
    return ["single", "variants", "split"].includes(value) ? value : "variants";
  }
  function createArtifactStagePayload(envelope = {}, { viewer } = {}) {
    const artifacts = Object.freeze(
      (Array.isArray(envelope?.artifacts) ? envelope.artifacts : []).map(freezeArtifactMetadata)
    );
    const sourceViewer = viewer && typeof viewer === "object" ? viewer : envelope?.viewer && typeof envelope.viewer === "object" ? envelope.viewer : {};
    const firstId = artifacts[0]?.id ?? "";
    const activeArtifactId = availableId(
      artifacts,
      requestedArtifactId(sourceViewer.activeArtifactId),
      firstId
    );
    const mode = normalizeViewMode(sourceViewer.mode, artifacts.length);
    return Object.freeze({
      schemaVersion: "1.0.0",
      artifacts,
      viewer: Object.freeze({
        mode,
        activeArtifactId,
        ...PRESENTATIONS.includes(sourceViewer.presentation) ? { presentation: sourceViewer.presentation } : {}
      })
    });
  }

  // lib/artifact/ui/stage.mjs
  var ARTIFACT_STAGE_EVENTS = Object.freeze({
    change: "planr:stage-change",
    point: "planr:artifact-point",
    region: "planr:artifact-region",
    layout: "planr:artifact-layout"
  });
  var ARTIFACT_STAGE_LIMITS = Object.freeze({
    defaultZoom: 72,
    minZoom: 25,
    maxZoom: 200,
    zoomStep: 10,
    maxDocumentWidth: 16384,
    maxDocumentHeight: 262144
  });
  var VIEW_MODES = Object.freeze(["single", "variants", "split"]);
  var REVIEW_MODES = Object.freeze(["interact", "comment"]);
  var THEMES = Object.freeze(["auto", "light", "dark"]);
  var PRESENTATIONS2 = Object.freeze(["document", "canvas"]);
  var STATUSES = Object.freeze([
    "ready",
    "empty",
    "bundling",
    "loading",
    "invalid",
    "expired",
    "decryption-failed",
    "unsupported-browser"
  ]);
  var STATUS_COPY = Object.freeze({
    empty: Object.freeze({
      title: "No artifact content",
      detail: "Choose a bundled HTML artifact to begin this review."
    }),
    bundling: Object.freeze({
      title: "Bundling artifact",
      detail: "Packaging local scripts, styles, fonts, and images without network access."
    }),
    loading: Object.freeze({
      title: "Loading private review",
      detail: "Validating the envelope and frozen artifact viewport."
    }),
    invalid: Object.freeze({
      title: "This review is invalid",
      detail: "The artifact envelope could not be decoded or validated."
    }),
    expired: Object.freeze({
      title: "This encrypted review expired",
      detail: "Ask the sender for a new immutable review link."
    }),
    "decryption-failed": Object.freeze({
      title: "This key cannot decrypt the review",
      detail: "Use the complete link, including its private fragment key."
    }),
    "unsupported-browser": Object.freeze({
      title: "Browser support is required",
      detail: "Use a current browser with Blob URL support to review this artifact."
    })
  });
  function member2(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }
  function finite2(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function clamp2(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function normalized2(value) {
    return Math.round(clamp2(finite2(value), 0, 1) * 1e6) / 1e6;
  }
  function artifactMetadata(artifact) {
    return Object.freeze({
      id: artifact.id,
      title: artifact.title,
      sha256: artifact.sha256,
      viewport: artifact.viewport,
      colorScheme: artifact.colorScheme
    });
  }
  function requestedArtifactId2(value) {
    if (typeof value === "string") return value;
    return typeof value?.id === "string" ? value.id : "";
  }
  function availableId2(artifacts, requested, fallback = "") {
    return artifacts.some(({ id }) => id === requested) ? requested : fallback;
  }
  function comparisonIdFor(artifacts, activeArtifactId, requested = "") {
    if (requested !== activeArtifactId && artifacts.some(({ id }) => id === requested)) return requested;
    return artifacts.find(({ id }) => id !== activeArtifactId)?.id ?? "";
  }
  function normalizeViewMode2(value, artifactCount) {
    if (artifactCount < 2) return "single";
    return member2(value, VIEW_MODES, "variants");
  }
  function resolveArtifactPresentation(value, { viewMode = "single", artifactCount = 1 } = {}) {
    if (PRESENTATIONS2.includes(value)) return value;
    return artifactCount > 1 || viewMode === "variants" || viewMode === "split" ? "canvas" : "document";
  }
  function createArtifactStageState(payload = {}, shellModel = {}) {
    const artifacts = Object.freeze(
      (Array.isArray(payload?.artifacts) ? payload.artifacts : []).map(artifactMetadata)
    );
    const firstId = artifacts[0]?.id ?? "";
    const activeArtifactId = availableId2(
      artifacts,
      requestedArtifactId2(shellModel.activeArtifact ?? shellModel.activeArtifactId) || requestedArtifactId2(payload?.viewer?.activeArtifactId),
      firstId
    );
    const comparisonArtifactId = comparisonIdFor(
      artifacts,
      activeArtifactId,
      requestedArtifactId2(shellModel.comparisonArtifact ?? shellModel.comparisonArtifactId)
    );
    const statusFallback = artifacts.length === 0 ? "empty" : "ready";
    let status = member2(shellModel.status, STATUSES, statusFallback);
    if (artifacts.length === 0 && status === "ready") status = "empty";
    const viewMode = normalizeViewMode2(
      shellModel.viewMode ?? payload?.viewer?.mode,
      artifacts.length
    );
    const presentation = resolveArtifactPresentation(
      shellModel.presentation ?? payload?.viewer?.presentation,
      { viewMode, artifactCount: artifacts.length }
    );
    return Object.freeze({
      schemaVersion: "1.0.0",
      artifacts,
      activeArtifactId,
      comparisonArtifactId,
      viewMode,
      presentation,
      reviewMode: member2(shellModel.reviewMode, REVIEW_MODES, "interact"),
      zoom: clamp2(
        Number.isInteger(shellModel.zoom) ? shellModel.zoom : ARTIFACT_STAGE_LIMITS.defaultZoom,
        ARTIFACT_STAGE_LIMITS.minZoom,
        ARTIFACT_STAGE_LIMITS.maxZoom
      ),
      railOpen: shellModel.railOpen === void 0 ? presentation === "canvas" : Boolean(shellModel.railOpen),
      theme: member2(shellModel.theme, THEMES, "auto"),
      status
    });
  }
  function nextState(state, changes) {
    return Object.freeze({ ...state, ...changes });
  }
  function reduceArtifactStageState(state, action = {}) {
    switch (action.type) {
      case "set-active": {
        const id = availableId2(state.artifacts, action.artifactId);
        if (!id || id === state.activeArtifactId) return state;
        const comparisonArtifactId = id === state.comparisonArtifactId ? state.activeArtifactId : comparisonIdFor(state.artifacts, id, state.comparisonArtifactId);
        return nextState(state, { activeArtifactId: id, comparisonArtifactId });
      }
      case "set-comparison": {
        const id = comparisonIdFor(state.artifacts, state.activeArtifactId, action.artifactId);
        return id === state.comparisonArtifactId ? state : nextState(state, { comparisonArtifactId: id });
      }
      case "set-view-mode": {
        const viewMode = normalizeViewMode2(action.viewMode, state.artifacts.length);
        return viewMode === state.viewMode ? state : nextState(state, { viewMode });
      }
      case "set-review-mode": {
        const reviewMode = member2(action.reviewMode, REVIEW_MODES, state.reviewMode);
        return reviewMode === state.reviewMode ? state : nextState(state, { reviewMode });
      }
      case "set-zoom": {
        const zoom = clamp2(
          Math.round(finite2(action.zoom, state.zoom)),
          ARTIFACT_STAGE_LIMITS.minZoom,
          ARTIFACT_STAGE_LIMITS.maxZoom
        );
        return zoom === state.zoom ? state : nextState(state, { zoom });
      }
      case "zoom-by":
        return reduceArtifactStageState(state, {
          type: "set-zoom",
          zoom: state.zoom + finite2(action.delta)
        });
      case "set-rail-open": {
        const railOpen = Boolean(action.railOpen);
        return railOpen === state.railOpen ? state : nextState(state, { railOpen });
      }
      case "toggle-rail":
        return nextState(state, { railOpen: !state.railOpen });
      case "set-theme": {
        const theme = member2(action.theme, THEMES, state.theme);
        return theme === state.theme ? state : nextState(state, { theme });
      }
      case "cycle-theme": {
        const index = THEMES.indexOf(state.theme);
        return nextState(state, { theme: THEMES[(index + 1) % THEMES.length] });
      }
      case "set-status": {
        const status = member2(action.status, STATUSES, state.status);
        return status === state.status ? state : nextState(state, { status });
      }
      default:
        return state;
    }
  }
  function visibleArtifactIds(state) {
    if (!state.activeArtifactId) return Object.freeze([]);
    if (state.viewMode === "split" && state.comparisonArtifactId) {
      return Object.freeze([state.activeArtifactId, state.comparisonArtifactId]);
    }
    return Object.freeze([state.activeArtifactId]);
  }
  function assertRect2(rect) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      throw new RangeError("Artifact bounds must have positive finite dimensions.");
    }
  }
  function clientPointToNormalized(rect, point) {
    assertRect2(rect);
    return Object.freeze({
      x: normalized2((finite2(point?.x ?? point?.clientX) - rect.left) / rect.width),
      y: normalized2((finite2(point?.y ?? point?.clientY) - rect.top) / rect.height)
    });
  }
  function normalizedPointToClient(rect, point) {
    assertRect2(rect);
    return Object.freeze({
      x: rect.left + normalized2(point?.x) * rect.width,
      y: rect.top + normalized2(point?.y) * rect.height
    });
  }
  function parseDataScript(document2, id) {
    const node = document2.getElementById(id);
    if (!node) throw new Error(`Missing artifact shell data: ${id}`);
    return JSON.parse(node.textContent ?? "null");
  }
  function isEditableTarget(target) {
    const HTMLElement = target?.ownerDocument?.defaultView?.HTMLElement;
    return Boolean(HTMLElement && target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
  }
  function stageArtifactById(state, id) {
    return state.artifacts.find((artifact) => artifact.id === id) ?? null;
  }
  function updateStatus(document2, state) {
    const statusPanel = document2.querySelector(".planr-stage-status");
    const surface = document2.querySelector(".planr-stage-surface");
    if (!statusPanel || !surface) return;
    const ready = state.status === "ready";
    statusPanel.hidden = ready;
    surface.toggleAttribute("inert", !ready);
    surface.setAttribute("aria-hidden", String(!ready));
    if (ready) surface.removeAttribute("aria-hidden");
    const copy = STATUS_COPY[state.status];
    if (copy) {
      const title = statusPanel.querySelector("strong");
      const detail = statusPanel.querySelector("p");
      if (title) title.textContent = copy.title;
      if (detail) detail.textContent = copy.detail;
    }
  }
  function emit(root, window, type, detail) {
    root.dispatchEvent(new window.CustomEvent(type, { detail, bubbles: true }));
  }
  async function htmlForSource(window, source) {
    if (typeof source === "string" && source.trimStart().startsWith("<")) return source;
    if (source && typeof source === "object" && typeof source.html === "string") return source.html;
    if (source instanceof window.Blob) return source.text();
    if (source instanceof window.ArrayBuffer) return new window.TextDecoder().decode(source);
    if (window.ArrayBuffer.isView(source)) {
      return new window.TextDecoder().decode(
        new window.Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      );
    }
    return null;
  }
  function mountArtifactStage({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    resolveArtifactSource,
    bridgeClient,
    onState,
    review: reviewOptions = {},
    share: shareOptions = {},
    hosted: hostedOptions = {}
  } = {}) {
    if (!document2 || !window) return null;
    const root = document2.querySelector(".planr-shell");
    if (!root) return null;
    let payload;
    let shellModel;
    let reviewConfig;
    try {
      payload = parseDataScript(document2, "planr-artifact-stage-payload");
      shellModel = parseDataScript(document2, "planr-artifact-shell-model");
      reviewConfig = parseDataScript(document2, "planr-artifact-review-state");
    } catch {
      payload = { artifacts: [], viewer: { mode: "single", activeArtifactId: "" } };
      shellModel = { status: "invalid" };
      reviewConfig = { reviewOf: "0".repeat(64), review: null };
    }
    let state;
    try {
      state = createArtifactStageState(payload, shellModel);
    } catch {
      state = createArtifactStageState({}, { status: "invalid" });
    }
    const frames = new Map(
      [...document2.querySelectorAll("[data-planr-artifact-frame]")].map((frame) => [frame.dataset.planrArtifactFrame, frame])
    );
    const panels = new Map(
      [...document2.querySelectorAll(".planr-artifact-panel[data-artifact-id]")].map((panel) => [panel.dataset.artifactId, panel])
    );
    const documentLayouts = /* @__PURE__ */ new Map();
    const cleanup = [];
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function render({ announce: announce2 = false } = {}) {
      const visible = new Set(visibleArtifactIds(state));
      root.dataset.planrView = state.viewMode;
      root.dataset.planrReviewMode = state.reviewMode;
      root.dataset.planrState = state.status;
      root.dataset.planrRailOpen = String(state.railOpen);
      root.dataset.planrPresentation = state.presentation;
      document2.documentElement.dataset.planrPresentation = state.presentation;
      document2.documentElement.dataset.planrTheme = state.theme;
      const grid = document2.querySelector(".planr-frame-grid");
      const surface = document2.querySelector(".planr-stage-surface");
      const tablist = document2.querySelector(".planr-variants");
      const rail = document2.getElementById("planr-review-rail");
      const feedbackButton = document2.querySelector('[data-planr-action="feedback"]');
      const themeButton = document2.querySelector('[data-planr-action="theme"]');
      const statusSlot = document2.querySelector('[data-planr-slot="status"]');
      const metadata = document2.querySelector(".planr-title-block > span");
      const breadcrumb = document2.querySelector(".planr-stage-heading > span:first-child");
      const activeArtifact = stageArtifactById(state, state.activeArtifactId);
      if (grid) grid.dataset.planrLayout = state.viewMode;
      const visualOrder = state.viewMode === "split" ? [...visible, ...state.artifacts.map(({ id }) => id).filter((id) => !visible.has(id))] : state.artifacts.map(({ id }) => id);
      if (surface) surface.style.setProperty("--planr-shell-zoom", String(state.zoom / 100));
      if (tablist) tablist.hidden = state.viewMode === "single" || state.artifacts.length < 2;
      if (rail) {
        rail.toggleAttribute("inert", !state.railOpen);
        rail.setAttribute("aria-hidden", String(!state.railOpen));
        if (state.railOpen) rail.removeAttribute("aria-hidden");
      }
      if (feedbackButton) feedbackButton.setAttribute("aria-expanded", String(state.railOpen));
      if (themeButton) {
        themeButton.textContent = state.theme;
        themeButton.setAttribute("aria-label", `Shell theme ${state.theme}`);
      }
      if (statusSlot) statusSlot.textContent = state.reviewMode === "comment" ? "Comment mode" : "Interactions enabled";
      if (metadata && activeArtifact) {
        metadata.textContent = `HTML · ${activeArtifact.viewport.width}×${activeArtifact.viewport.height}`;
      }
      if (breadcrumb) breadcrumb.textContent = `ARTIFACT / ${(activeArtifact?.title ?? "Artifact").toUpperCase()}`;
      for (const button of document2.querySelectorAll("[data-planr-view]")) {
        const mode = button.dataset.planrView;
        button.setAttribute("aria-pressed", String(mode === state.viewMode));
        button.disabled = state.artifacts.length < 2 && mode !== "single";
      }
      for (const button of document2.querySelectorAll("[data-planr-mode]")) {
        button.setAttribute("aria-pressed", String(button.dataset.planrMode === state.reviewMode));
      }
      for (const button of document2.querySelectorAll('[data-planr-action="zoom-reset"]')) {
        button.textContent = `${state.zoom}%`;
      }
      for (const tab of document2.querySelectorAll('[role="tab"][data-artifact-id]')) {
        const selected = tab.dataset.artifactId === state.activeArtifactId;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      for (const [id, panel] of panels) {
        const isVisible = visible.has(id);
        const isPrimary = id === state.activeArtifactId;
        panel.hidden = !isVisible;
        panel.style.order = String(visualOrder.indexOf(id));
        const artifact = stageArtifactById(state, id);
        panel.setAttribute("aria-label", `${isPrimary ? "Primary" : "Comparison"} artifact: ${artifact?.title ?? id}`);
        const frame = frames.get(id);
        const annotationLayer = panel.querySelector("[data-planr-annotation-layer]");
        if (frame) frame.tabIndex = isVisible && state.status === "ready" && state.reviewMode === "interact" ? 0 : -1;
        if (annotationLayer) {
          const enabled = isVisible && state.status === "ready" && state.reviewMode === "comment";
          annotationLayer.tabIndex = enabled ? 0 : -1;
          annotationLayer.setAttribute("aria-disabled", String(!enabled));
        }
      }
      updateStatus(document2, state);
      if (typeof onState === "function") {
        try {
          onState(state);
        } catch {
        }
      }
      if (announce2) emit(root, window, ARTIFACT_STAGE_EVENTS.change, state);
    }
    function dispatch(action, { announce: announce2 = true } = {}) {
      const previous = state;
      state = reduceArtifactStageState(state, action);
      if (state !== previous) render({ announce: announce2 });
      return state;
    }
    function setActiveFromTab(tab, { focus = false } = {}) {
      dispatch({ type: "set-active", artifactId: tab.dataset.artifactId });
      if (focus) tab.focus();
    }
    function onClick(event) {
      const target = event.target.closest?.("button");
      if (!target) return;
      if (target.hasAttribute("data-planr-close-feedback")) {
        dispatch({ type: "set-rail-open", railOpen: false });
        document2.querySelector('[data-planr-action="feedback"]')?.focus();
        return;
      }
      if (target.dataset.planrView) {
        dispatch({ type: "set-view-mode", viewMode: target.dataset.planrView });
        return;
      }
      if (target.dataset.artifactId && target.getAttribute("role") === "tab") {
        setActiveFromTab(target);
        return;
      }
      if (target.dataset.planrMode) {
        dispatch({ type: "set-review-mode", reviewMode: target.dataset.planrMode });
        return;
      }
      switch (target.dataset.planrAction) {
        case "zoom-out":
          dispatch({ type: "zoom-by", delta: -ARTIFACT_STAGE_LIMITS.zoomStep });
          break;
        case "zoom-reset":
          dispatch({ type: "set-zoom", zoom: ARTIFACT_STAGE_LIMITS.defaultZoom });
          break;
        case "zoom-in":
          dispatch({ type: "zoom-by", delta: ARTIFACT_STAGE_LIMITS.zoomStep });
          break;
        case "feedback": {
          const rail = document2.getElementById("planr-review-rail");
          if (state.railOpen && rail?.contains(document2.activeElement)) target.focus();
          dispatch({ type: "toggle-rail" });
          break;
        }
        case "theme":
          dispatch({ type: "cycle-theme" });
          break;
        default:
          break;
      }
    }
    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !isEditableTarget(event.target)) {
        if (event.key.toLowerCase() === "i") {
          dispatch({ type: "set-review-mode", reviewMode: "interact" });
          return;
        }
        if (event.key.toLowerCase() === "c") {
          dispatch({ type: "set-review-mode", reviewMode: "comment" });
          return;
        }
        if (event.key === "Escape" && state.railOpen) {
          dispatch({ type: "set-rail-open", railOpen: false });
          document2.querySelector('[data-planr-action="feedback"]')?.focus();
          return;
        }
      }
      const tab = event.target.closest?.('[role="tab"][data-artifact-id]');
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...document2.querySelectorAll('[role="tab"][data-artifact-id]')];
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      setActiveFromTab(tabs[nextIndex], { focus: true });
    }
    function emitSelection(layer, start, end = start) {
      if (state.reviewMode !== "comment" || state.status !== "ready") return;
      const artifactId = layer.dataset.planrAnnotationLayer;
      if (!visibleArtifactIds(state).includes(artifactId)) return;
      const artifact = stageArtifactById(state, artifactId);
      if (!artifact) return;
      const region = clientSelectionToNormalized(layer.getBoundingClientRect(), start, end);
      const measured = state.presentation === "document" ? documentLayouts.get(artifactId) : null;
      const detail = Object.freeze({
        schemaVersion: "1.0.0",
        artifactId,
        region,
        viewport: measured ?? artifact.viewport
      });
      emit(root, window, ARTIFACT_STAGE_EVENTS.region, detail);
      emit(root, window, ARTIFACT_STAGE_EVENTS.point, detail);
    }
    for (const layer of document2.querySelectorAll("[data-planr-annotation-layer]")) {
      let selection = null;
      let selectionPreview = null;
      listen(layer, "pointerdown", (event) => {
        if (event.button !== 0 || state.reviewMode !== "comment" || state.status !== "ready") return;
        if (event.target !== layer) return;
        event.preventDefault();
        selection = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY } };
        layer.setPointerCapture?.(event.pointerId);
        selectionPreview = document2.createElement("span");
        selectionPreview.className = "planr-region-selection";
        selectionPreview.setAttribute("aria-hidden", "true");
        layer.append(selectionPreview);
      });
      listen(layer, "pointermove", (event) => {
        if (!selection || selection.pointerId !== event.pointerId || !selectionPreview) return;
        const region = clientSelectionToNormalized(
          layer.getBoundingClientRect(),
          selection.start,
          { x: event.clientX, y: event.clientY }
        );
        selectionPreview.style.left = `${region.x * 100}%`;
        selectionPreview.style.top = `${region.y * 100}%`;
        selectionPreview.style.width = `${region.w * 100}%`;
        selectionPreview.style.height = `${region.h * 100}%`;
      });
      listen(layer, "pointercancel", (event) => {
        if (!selection || selection.pointerId !== event.pointerId) return;
        layer.releasePointerCapture?.(event.pointerId);
        selection = null;
        selectionPreview?.remove();
        selectionPreview = null;
      });
      listen(layer, "pointerup", (event) => {
        if (!selection || selection.pointerId !== event.pointerId) return;
        const start = selection.start;
        layer.releasePointerCapture?.(event.pointerId);
        selection = null;
        selectionPreview?.remove();
        selectionPreview = null;
        emitSelection(layer, start, { x: event.clientX, y: event.clientY });
      });
      listen(layer, "keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        if (event.target !== layer) return;
        event.preventDefault();
        const bounds = layer.getBoundingClientRect();
        emitSelection(layer, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      });
    }
    for (const [artifactId, frame] of frames) {
      listen(frame, ARTIFACT_STAGE_EVENTS.layout, (event) => {
        if (state.presentation !== "document") return;
        const width = event.detail?.width;
        const height = event.detail?.height;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > ARTIFACT_STAGE_LIMITS.maxDocumentWidth || height < 1 || height > ARTIFACT_STAGE_LIMITS.maxDocumentHeight) return;
        const layout = Object.freeze({ width, height });
        documentLayouts.set(artifactId, layout);
        const panel = panels.get(artifactId);
        if (!panel) return;
        panel.dataset.planrLayoutMeasured = "true";
        panel.style.setProperty("--planr-document-width", `${width}px`);
        panel.style.setProperty("--planr-document-height", `${height}px`);
      });
    }
    listen(root, "click", onClick);
    listen(document2, "keydown", onKeyDown);
    render();
    let readyPromise = Promise.resolve(state);
    let feedbackController = null;
    let annotationController = null;
    let shareController = null;
    let hostedController = null;
    const controller = Object.freeze({
      getState: () => state,
      getFrame: (artifactId) => frames.get(artifactId) ?? null,
      getPanel: (artifactId) => panels.get(artifactId) ?? null,
      get review() {
        return feedbackController;
      },
      get annotations() {
        return annotationController;
      },
      get share() {
        return shareController;
      },
      get hosted() {
        return hostedController;
      },
      get ready() {
        return readyPromise;
      },
      dispatch,
      destroy() {
        for (const remove of cleanup.splice(0)) remove();
      }
    });
    window.__openPlanrArtifactStage = controller;
    feedbackController = mountArtifactFeedbackRail({
      document: document2,
      window,
      root,
      stageController: controller,
      reviewOf: reviewConfig?.reviewOf,
      initialReview: reviewConfig?.review ?? null,
      artifacts: state.artifacts,
      ...reviewOptions
    });
    annotationController = mountArtifactAnnotations({
      document: document2,
      window,
      root,
      stageController: controller,
      reviewController: feedbackController
    });
    shareController = mountArtifactShareDialog({
      document: document2,
      window,
      root,
      stageController: controller,
      ...shareOptions
    });
    hostedController = mountHostedArtifactViewer({
      document: document2,
      window,
      ...hostedOptions
    });
    if (feedbackController?.destroy) cleanup.push(() => feedbackController.destroy());
    if (annotationController?.destroy) cleanup.push(() => annotationController.destroy());
    if (shareController?.destroy) cleanup.push(() => shareController.destroy());
    if (hostedController?.destroy) cleanup.push(() => hostedController.destroy());
    async function assignArtifactSource(artifact) {
      const frame = frames.get(artifact.id);
      if (!frame) throw new Error(`Missing artifact frame: ${artifact.id}`);
      const source = await resolveArtifactSource(artifact, {
        frame,
        getState: () => state
      });
      if (typeof window.TextDecoder !== "function") {
        const error = new Error("UTF-8 decoding support is required for artifact sources.");
        error.code = "E_ARTIFACT_BROWSER_UNSUPPORTED";
        throw error;
      }
      const html = await htmlForSource(window, source);
      if (!html) {
        throw new TypeError(
          `Artifact source resolver must return HTML bytes or a Blob for ${artifact.id}.`
        );
      }
      const loaded = new Promise((resolve, reject) => {
        frame.addEventListener("load", resolve, { once: true });
        frame.addEventListener("error", () => reject(new Error(`Artifact frame failed: ${artifact.id}`)), { once: true });
      });
      if (typeof bridgeClient?.attach === "function") {
        const detach = bridgeClient.attach({
          artifact,
          frame,
          getState: () => state
        });
        if (typeof detach === "function") cleanup.push(detach);
      }
      frame.dataset.planrArtifactDigest = artifact.sha256;
      if (typeof window.URL?.createObjectURL !== "function" || typeof window.Blob !== "function") {
        const error = new Error("Blob URL support is required for artifact sources.");
        error.code = "E_ARTIFACT_BROWSER_UNSUPPORTED";
        throw error;
      }
      const sourceUrl = window.URL.createObjectURL(new window.Blob([html], {
        type: "text/html;charset=utf-8"
      }));
      cleanup.push(() => window.URL.revokeObjectURL(sourceUrl));
      frame.removeAttribute("srcdoc");
      frame.src = sourceUrl;
      await loaded;
    }
    if (state.status === "ready" && state.artifacts.length > 0) {
      if (typeof resolveArtifactSource !== "function") {
        state = reduceArtifactStageState(state, { type: "set-status", status: "loading" });
        render();
        readyPromise = Promise.resolve(state);
      } else {
        state = reduceArtifactStageState(state, { type: "set-status", status: "loading" });
        render();
        readyPromise = Promise.all(state.artifacts.map(assignArtifactSource)).then(() => {
          state = reduceArtifactStageState(state, { type: "set-status", status: "ready" });
          render({ announce: true });
          return state;
        }).catch((error) => {
          const status = error?.code === "E_ARTIFACT_BROWSER_UNSUPPORTED" ? "unsupported-browser" : "invalid";
          state = reduceArtifactStageState(state, { type: "set-status", status });
          render({ announce: true });
          return state;
        });
      }
    }
    return controller;
  }
  function bootstrapArtifactStage(document2 = globalThis.document, options = {}) {
    return mountArtifactStage({ ...options, document: document2, window: document2?.defaultView });
  }
  if (typeof document !== "undefined") {
    const options = globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ ?? {};
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => bootstrapArtifactStage(document, options), { once: true });
    } else {
      queueMicrotask(() => bootstrapArtifactStage(document, options));
    }
  }
  return __toCommonJS(stage_exports);
})();
