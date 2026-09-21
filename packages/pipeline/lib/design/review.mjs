import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	prepareArtifactDocument,
	createArtifactBridgeNonce,
	renderArtifactParentRuntime,
} from "../artifact/bridge.mjs";
import { digestArtifactEnvelope } from "../artifact/envelope.mjs";
import { resolveArtifactReviewDestination } from "../artifact/import.mjs";
import {
	acquireStartLock,
	readRequestBody,
} from "../artifact/internal/server-util.mjs";
import { createReviewLedger } from "../artifact/merge.mjs";
import {
	readArtifactReviewState,
	withArtifactReviewLock,
	writeArtifactReviewState,
} from "../artifact/review.mjs";
import { createArtifactReviewServer } from "../artifact/review-server.mjs";
import {
	ARTIFACT_ERROR_CODES,
	PipelineError,
} from "../protocol/errors.mjs";
import {
	atomicJson,
	currentDesign,
	designSpecPath,
	hash,
	readJson,
	standaloneDesignHtml,
} from "./document.mjs";
import { renderDesignStudio } from "./studio.mjs";
import { getDesignShareStatus, shareDesign, publishDesignShare, syncDesignShare, manageDesignShare, exportDesignShareRecovery } from "./share.mjs";

import {
	readDesignExperience,
	readDesignHandoff,
	readDesignHandoffReadiness,
	updateDesignHandoff,
} from "./handoff.mjs";
import {
	createRepositorySourceResolver,
	exportImplementationHandoffPackage,
	importImplementationHandoffPackage,
	readImplementationHandoffDraft,
	writeImplementationHandoffDraft,
} from "./implementation-handoff.mjs";
import {
	approveImplementationHandoff,
	compareImplementationHandoffVersions,
	IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
	IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
	previewImplementationHandoffApproval,
	readImplementationHandoffLifecycle,
	regenerateImplementationHandoffDraft,
	revokeImplementationHandoff,
} from "./implementation-handoff-approval.mjs";
import { listDesignRevisions, readDesignRevision, reviewDigest } from "./context.mjs";
import { createDesignReviewExport } from "./review-export.mjs";

const VERSION = "1.3.0";
export const designReviewKey = (document) =>
	`design-${hash(document.id).slice(0, 24)}`;
export function designReviewPath(file, env = process.env) {
	const { root, document } = currentDesign(file);
	return resolveArtifactReviewDestination({
		cwd: root,
		env,
		artifactId: designReviewKey(document),
	}).path;
}
export function readDesignFeedback(file, env = process.env) {
	const current = currentDesign(file);
	const ledger = readArtifactReviewState(designReviewPath(file, env), {
		allowMissing: true,
	});
	const digest = digestArtifactEnvelope(current.envelope);
	const pins = (ledger?.reviews ?? []).flatMap((entry) =>
		entry.review.pins.map((pin) => {
			const target = current.entries.find(
				(item) => item.artifactId === pin.artifactId,
			);
			const screen =
				target &&
				current.document.screens.find((item) => item.id === target.screenId);
			const anchorMissing =
				pin.anchor?.planrId &&
				screen?.anchors?.length &&
				!screen.anchors.includes(pin.anchor.planrId) &&
				pin.anchor.planrId !== screen.id;
			return {
				...pin,
				reviewId: entry.review.reviewId,
				reviewOf: entry.review.reviewOf,
				...(entry.review.reviewId.startsWith("shared-") ? { revisionId: entry.review.reviewId.slice(7) } : {}),
				stale:
					entry.stale ||
					entry.review.reviewOf !== digest ||
					!target ||
					Boolean(anchorMissing),
				...(target
					? { screenId: target.screenId, variantId: target.variantId }
					: {}),
			};
		}),
	);
	return {
		revision: current.revision,
		reviewPath: designReviewPath(file, env),
		pins,
		state: readJson(join(current.root, ".design/studio-state.json"), {
			state: {},
			stateVersion: 0,
		}).state,
		ledger,
        shared: readJson(join(current.root, ".design/shared-feedback.json"), null),
	};
}

/** Deterministic projection of the local ledger, using original immutable sources. */
export function exportDesignReview(file, { scope = "all", env = process.env } = {}) {
	if (!["all", "current"].includes(scope)) throw new Error("Review export scope must be current or all.");
	const current = currentDesign(file), feedback = readDesignFeedback(file, env);
	const currentDigest = digestArtifactEnvelope(current.envelope);
	const local = new Map([[current.revision, { revisionId: current.revision, reviewOf: currentDigest, bundle: current }]]);
	let historyComplete = true;
	try {
		for (const { revision } of listDesignRevisions(file).revisions) {
			if (local.has(revision)) continue;
			try {
				const bundle = readDesignRevision(file, revision);
				local.set(revision, { revisionId: revision, reviewOf: digestArtifactEnvelope(bundle.envelope), bundle });
			} catch { historyComplete = false; }
		}
	} catch { historyComplete = false; }
	const byDigest = new Map();
	for (const value of local.values()) byDigest.set(value.reviewOf, [...(byDigest.get(value.reviewOf) ?? []), value]);
	// Attachment status projects only public identities. Credentials never enter
	// the export input, and an absent attachment does not block local reviews.
	let shared = null;
	try { shared = getDesignShareStatus(file, { env }); } catch { /* Local-only or unavailable attachment. */ }
	const currentRevisionId = shared?.publishedRevision === current.revision && shared?.revision ? shared.revision : current.revision;
	const revisions = [...local.values()];
	const entries = (feedback.ledger?.reviews ?? []).filter(entry => scope === "all" || entry.review.reviewOf === currentDigest);
	const pins = entries.flatMap(entry => {
		const { review } = entry;
		const matching = byDigest.get(review.reviewOf) ?? [];
		const original = matching.length === 1 ? matching[0] : null;
		const sharedRevisionId = review.reviewId.startsWith("shared-") ? review.reviewId.slice(7) : null;
		if (sharedRevisionId && original) revisions.push({ ...original, revisionId: sharedRevisionId });
		return review.pins.map(pin => ({ ...pin, reviewId: review.reviewId, reviewOf: review.reviewOf,
			...(sharedRevisionId || original ? { revisionId: sharedRevisionId ?? (original.revisionId === current.revision ? currentRevisionId : original.revisionId) } : {}), stale: entry.stale }));
	});
	const localChanges = entries.some(({ review }) => !review.reviewId.startsWith("shared-")
		? Boolean(review.pins.length || review.overall)
		: JSON.stringify(feedback.shared?.importedReviews?.[review.reviewId]) !== JSON.stringify(review));
	return createDesignReviewExport({
		bundle: { bundle: current, revisionId: currentRevisionId, reviewOf: currentDigest },
		revisions, feedback: { pins, ledger: { reviews: entries } },
		metadata: readDesignExperience(file, { env }).metadata,
		historyComplete: historyComplete && !(feedback.shared?.issues?.length),
		includesUnsentLocalChanges: localChanges,
	});
}

function validateState(value, current) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Buffer.byteLength(JSON.stringify(value)) > 64 * 1024
	)
		throw new Error("Studio state must be an object under 64 KB.");
	const variants = new Set(
		current.document.variants
			.filter((item) => item.status === "ready")
			.map((item) => item.id),
	);
	const fields = new Set([
		"schemaVersion",
		"view",
		"screenId",
		"frameId",
		"variantId",
		"selectedVariant",
		"compare",
		"navOpen",
		"reviewOpen",
		"zoom",
		"camera",
		"viewports",
		"positions",
		"ratings",
		"remix",
		"preferences",
	]);
	if (Object.keys(value).some((key) => !fields.has(key)))
		throw new Error("Studio state has unknown fields.");
	if (
		value.view &&
		!["canvas", "prototype", "walkthrough"].includes(value.view)
	)
		throw new Error("Unknown studio view.");
	for (const key of ["variantId", "selectedVariant"])
		if (value[key] && !variants.has(value[key]))
			throw new Error("Select an available design variant.");
	if (value.screenId && !current.document.screenOrder.includes(value.screenId))
		throw new Error("Unknown studio screen.");
	if (
		value.frameId &&
		!current.document.frames.some((item) => item.id === value.frameId)
	)
		throw new Error("Unknown studio frame.");
	for (const key of ["navOpen", "reviewOpen"])
		if (value[key] !== undefined && typeof value[key] !== "boolean")
			throw new Error("Studio panels must use boolean visibility state.");
	if (
		value.zoom !== undefined &&
		(!Number.isFinite(value.zoom) || value.zoom < 0.01 || value.zoom > 1000)
	)
		throw new Error("Invalid studio zoom.");
	const validateViewport = (viewport) => {
		if (
			!viewport ||
			typeof viewport !== "object" ||
			Array.isArray(viewport) ||
			!Number.isFinite(viewport.x) ||
			!Number.isFinite(viewport.y) ||
			Math.abs(viewport.x) > 1e7 ||
			Math.abs(viewport.y) > 1e7 ||
			(viewport.zoom !== undefined &&
				(!Number.isFinite(viewport.zoom) ||
					viewport.zoom < 0.01 ||
					viewport.zoom > 1000))
		)
			throw new Error("Invalid studio viewport.");
	};
	if (value.camera !== undefined)
		validateViewport({ ...value.camera, zoom: value.zoom ?? 1 });
	if (value.viewports !== undefined) {
		if (
			!value.viewports ||
			typeof value.viewports !== "object" ||
			Array.isArray(value.viewports) ||
			Object.keys(value.viewports).some(
				(key) => !["canvas", "prototype", "walkthrough"].includes(key),
			)
		)
			throw new Error("Studio viewports have unknown views.");
		for (const viewport of Object.values(value.viewports))
			validateViewport(viewport);
	}
	for (const [id, rating] of Object.entries(value.ratings ?? {}))
		if (
			!variants.has(id) ||
			!Number.isInteger(rating) ||
			rating < 1 ||
			rating > 5
		)
			throw new Error("Ratings must target available variants and be 1–5.");
	for (const [id, point] of Object.entries(value.positions ?? {}))
		if (
			!current.entries.some((entry) => entry.artifactId === id) ||
			!Number.isFinite(point.x) ||
			!Number.isFinite(point.y) ||
			Math.abs(point.x) > 1e7 ||
			Math.abs(point.y) > 1e7
		)
			throw new Error("Invalid artboard arrangement.");
	return structuredClone(value);
}

function projectRoot(root) {
	let candidate = root;
	while (true) {
		if (
			existsSync(join(candidate, ".planr")) ||
			existsSync(join(candidate, ".git"))
		)
			return candidate;
		const parent = dirname(candidate);
		if (parent === candidate) return root;
		candidate = parent;
	}
}

function currentImplementationBasis(file, env) {
	const handoff = readDesignHandoff(file, { env });
	const readiness = readDesignHandoffReadiness(file, { env });
	if (!handoff.draft || handoff.draft.status !== "approved" || !handoff.current)
		throw Object.assign(
			new Error("Approve the current review handoff before composing the implementation package."),
			{ statusCode: 409 },
		);
	if (readiness.readiness.status !== "ready")
		throw Object.assign(
			new Error("Resolve the remaining design readiness checks before composing the implementation package."),
			{ statusCode: 409 },
		);
	return {
		designId: handoff.basis.designId,
		sourceRevision: `sha256:${handoff.basis.sourceRevision}`,
		selectedVariant: handoff.basis.selectedVariant,
		readiness: {
			status: readiness.readiness.status,
			digest: readiness.digest,
		},
		reviewHandoff: {
			version: handoff.draft.version,
			contentDigest: `sha256:${handoff.draft.contentHash}`,
		},
	};
}

async function persistDesignTaste(current, state) {
	const path = join(
		projectRoot(current.root),
		".planr/design-system/taste.json",
	);
	const release = await acquireStartLock(`${path}.lock`);
	try {
		const taste = readJson(path, { designs: {} });
		const previous = taste.designs?.[current.document.id] ?? {};
		const validIds = new Set(
			current.document.variants
				.filter((variant) => variant.status === "ready")
				.map((variant) => variant.id),
		);
		const ids = (values) => [
			...new Set(
				(Array.isArray(values) ? values : []).filter((id) => validIds.has(id)),
			),
		];
		const explicitSelected = ids(
			state.preferences?.selected ?? previous.selected,
		);
		const selected = explicitSelected.includes(state.selectedVariant)
			? [state.selectedVariant]
			: explicitSelected;
		const rejected = ids(
			state.preferences?.rejected ?? previous.rejected,
		).filter((id) => !selected.includes(id));
		atomicJson(path, {
			...taste,
			designs: {
				...taste.designs,
				[current.document.id]: {
					...previous,
					selected,
					rejected,
					ratings: state.ratings ?? previous.ratings ?? {},
					remix: state.remix ?? previous.remix ?? {},
					revision: current.revision,
				},
			},
		});
		return path;
	} finally {
		release();
	}
}

export async function saveDesignState(file, { state, revision, stateVersion }) {
	let current = currentDesign(file);
	if (revision !== current.revision)
		throw Object.assign(
			new Error("The design changed. Reload before saving feedback."),
			{ statusCode: 409 },
		);
	const path = join(current.root, ".design/studio-state.json");
	const release = await acquireStartLock(`${path}.lock`);
	try {
		current = currentDesign(file);
		if (revision !== current.revision)
			throw Object.assign(
				new Error("The design changed. Reload before saving feedback."),
				{ statusCode: 409 },
			);
		const previous = readJson(path, { state: {}, stateVersion: 0 });
		if (stateVersion !== previous.stateVersion)
			throw Object.assign(
				new Error(
					"Feedback changed in another window. Reload to merge the saved state.",
				),
				{ statusCode: 409 },
			);
		const next = {
			state: validateState(state, current),
			stateVersion: previous.stateVersion + 1,
			revision,
		};
		atomicJson(path, next);
		const tastePath = await persistDesignTaste(current, next.state);
		return { ...next, tastePath };
	} finally {
		release();
	}
}

function respond(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(JSON.stringify(value));
}
const readBody = async (req) =>
	JSON.parse(
		await readRequestBody(req, { maxBytes: 128 * 1024, encoding: "utf8" }),
	);
const readImplementationBody = async (req) =>
	JSON.parse(
		await readRequestBody(req, { maxBytes: 5 * 1024 * 1024, encoding: "utf8" }),
	);

/** Same artifact server and ledger in both CLI and installed-skill entrypoints. */
export async function startDesignReview(file, options = {}) {
	const { root } = currentDesign(file);
	const release = await acquireStartLock(join(root, ".design/start.lock"));
	try {
		return await startDesignReviewUnlocked(file, options);
	} finally {
		release();
	}
}

async function startDesignReviewUnlocked(
	file,
	{
		port = 0,
		env = process.env,
		noOpen = true,
		view,
		openUrl,
		fetchImpl = fetch,
		clock = () => new Date(),
	} = {},
) {
	let current = currentDesign(file);
	if (view !== undefined) {
		const saved = readJson(join(current.root, ".design/studio-state.json"), {
			state: {},
			stateVersion: 0,
		});
		await saveDesignState(file, {
			...saved,
			revision: current.revision,
			state: { ...saved.state, view },
		});
	}
	const stateFile = join(current.root, ".design/server.json");
	const old = readJson(stateFile, null);
	if (
		old?.version === VERSION &&
		old.url &&
		/^http:\/\/127\.0\.0\.1:\d+\/r\//u.test(old.url)
	) {
		try {
			const status = await fetchImpl(`${old.url}api/design-status`, {
				signal: AbortSignal.timeout(700),
			});
			const data = await status.json();
			if (
				status.ok &&
				data.documentId === current.document.id &&
				(!port || new URL(old.url).port === String(port))
			) {
				if (!noOpen) await openUrl?.(old.url);
				return {
					ok: true,
					url: old.url,
					sessionId: old.sessionId,
					reused: true,
					status: "loading",
					revision: current.revision,
					reviewPath: designReviewPath(file, env),
				};
			}
		} catch {
			/* stale ownership; open a new local server */
		}
	}
	let server;
	server = createArtifactReviewServer({
		env,
		prepareSource: (options) =>
			prepareArtifactDocument({ ...options, allowLocalForms: true }),
		async refreshSession(session) {
			current = currentDesign(file);
			if (session.designRevision === current.revision) return;
			await session.writeQueue;
			const digest = digestArtifactEnvelope(current.envelope);
			await withArtifactReviewLock(session.reviewPath, () => {
				const ledger =
					readArtifactReviewState(session.reviewPath, { allowMissing: true }) ??
					session.reviewState;
				session.reviewState = createReviewLedger({
					artifactId: ledger.artifactId,
					currentReviewOf: digest,
					reviews: ledger.reviews.map((entry) => ({
						review: entry.review,
						stale: entry.stale || entry.review.reviewOf !== digest,
					})),
				});
				writeArtifactReviewState(session.reviewPath, session.reviewState);
			});
			session.envelope = current.envelope;
			session.designRevision = current.revision;
		},
		renderDocument({ model, base }) {
			const state = readJson(join(current.root, ".design/studio-state.json"), {
				state: {},
			}).state;
			const stalePins = readDesignFeedback(file, env).pins.filter(
				(pin) => pin.stale,
			);
			return renderDesignStudio(
				{ ...current, envelope: model.envelope, state, stalePins },
				{ stageRuntimeUrl: `${base}runtime.js` },
			).replace("</head>", `<style>${readFileSync(new URL("../../templates/studio/share.css", import.meta.url), "utf8")}</style></head>`);
		},
		renderRuntime({ options, base }) {
			const settings = {
				stateUrl: `${base}api/design-state`,
				statusUrl: `${base}api/design-status`,
				readyUrl: `${base}api/design-ready`,
                shareUrl: `${base}api/design-share`,
                experienceUrl: `${base}api/design-experience`,
                readinessUrl: `${base}api/design-handoff-readiness`,
                handoffUrl: `${base}api/design-handoff`,
                implementationHandoffUrl: `${base}api/design-implementation-handoff`,
                revisionsUrl: `${base}api/design-revisions`,
                reviewExportUrl: `${base}api/design-feedback-export`,
			};
			return `globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__={...${JSON.stringify(settings)},loadReviewExport:async({scope="all"}={})=>{const r=await fetch(${JSON.stringify(`${base}api/design-feedback-export`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify({scope})});const value=await r.json();if(!r.ok)throw new Error(value.error||"Review export unavailable");return value},loadExperience:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-experience`)});if(!r.ok)throw new Error("Review context unavailable");return r.json()},loadReadiness:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-handoff-readiness`)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Handoff readiness unavailable");return value},loadHandoff:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-handoff`)});if(!r.ok)throw new Error("Handoff unavailable");return r.json()},updateHandoff:async(input)=>{const r=await fetch(${JSON.stringify(`${base}api/design-handoff`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify(input)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Could not update handoff");return value},loadImplementationHandoff:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-implementation-handoff`)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Implementation package unavailable");return value},updateImplementationHandoff:async(input)=>{const r=await fetch(${JSON.stringify(`${base}api/design-implementation-handoff`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify(input)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Could not update implementation package");return value},listRevisions:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-revisions`)});if(!r.ok)throw new Error("Revision history unavailable");return r.json()},loadRevision:async(revision)=>{const r=await fetch(${JSON.stringify(`${base}api/design-revisions`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify({revision})});if(!r.ok)throw new Error("Revision unavailable");return r.json()},exportHtml:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-export`)});if(!r.ok)throw new Error('Export failed');return r.text()}};\n${renderArtifactParentRuntime({ ...options, adapterRuntimeUrl: `${base}api/design-share-runtime` })}`;
		},
		async handleSessionRequest({ req, res, segments }) {
			if (
				segments.length !== 5 ||
				segments[3] !== "api" ||
				!segments[4].startsWith("design-")
			)
				return false;
			try {
				const route = segments[4];
				const localImplementationActor = {
					id: "local-owner",
					role: "owner",
					capabilities: [
						IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
						IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
					],
				};
                if (route === "design-experience" && req.method === "GET") {
                  respond(res, 200, readDesignExperience(file, { env }));
                } else if (route === "design-handoff-readiness" && req.method === "GET") {
                  respond(res, 200, readDesignHandoffReadiness(file, { env }));
                } else if (route === "design-handoff" && req.method === "GET") {
                  respond(res, 200, readDesignHandoff(file, { env }));
                } else if (route === "design-implementation-handoff" && req.method === "GET") {
					const design = currentDesign(file);
					const unlock = await acquireStartLock(join(design.root, ".design/render.lock"));
					try {
						const root = dirname(designSpecPath(design.root));
						respond(res, 200, { ok: true, draft: readImplementationHandoffDraft(root), ...readImplementationHandoffLifecycle(root), approvalPreview: previewImplementationHandoffApproval(root) });
					} finally {
						unlock();
					}
                } else if (route === "design-revisions" && req.method === "GET") {
                  respond(res, 200, listDesignRevisions(file));
                } else if (["design-handoff", "design-implementation-handoff", "design-revisions", "design-feedback-export"].includes(route) && req.method === "POST") {
                  if (req.headers["x-openplanr-design"] !== "1" || !String(req.headers["content-type"] ?? "").startsWith("application/json") || (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.port}`)) throw Object.assign(new Error("Owner actions require a same-origin studio request."), { statusCode: 403 });
                  const input = route === "design-implementation-handoff" ? await readImplementationBody(req) : await readBody(req);
                  if (route === "design-handoff") respond(res, 200, await updateDesignHandoff(file, input, { env, fetchImpl }));
                  else if (route === "design-implementation-handoff") {
					if (!input || typeof input !== "object" || Array.isArray(input) || !["draft", "regenerate", "export", "import", "approve", "revoke", "compare"].includes(input.action)) throw new Error("Unknown implementation package action.");
					const initial = currentDesign(file);
					const unlock = await acquireStartLock(join(initial.root, ".design/render.lock"));
					try {
						const design = currentDesign(file);
						const root = dirname(designSpecPath(design.root));
						const resolver = createRepositorySourceResolver(projectRoot(design.root));
						const approvalOptions = {
							actor: localImplementationActor,
							clock,
							resolveSource: resolver,
							...(["draft", "regenerate", "import", "approve"].includes(input.action)
								? { currentBasis: currentImplementationBasis(file, env) }
								: {}),
						};
						if (input.action === "draft") {
							if (!input.package || input.package.kind)
								throw new Error("Draft composition requires editable package fields, not a lifecycle record.");
							if (readImplementationHandoffLifecycle(root).history.length)
								throw Object.assign(new Error("Use regenerate to create a new version after approval."), { statusCode: 409 });
							const draft = writeImplementationHandoffDraft(root, {
								...input.package,
								version: 1,
								basis: approvalOptions.currentBasis,
							}, { resolveSource: resolver });
							respond(res, 200, { ok: true, draft });
						} else if (input.action === "regenerate") {
							if (!input.package || input.package.kind)
								throw new Error("Regeneration requires editable package fields, not a lifecycle record.");
							const value = regenerateImplementationHandoffDraft(root, {
								...input.package,
								basis: approvalOptions.currentBasis,
							}, { requestId: input.requestId }, approvalOptions);
							respond(res, 200, { ok: true, ...value });
						} else if (input.action === "import") {
							const draft = importImplementationHandoffPackage(input.package, { resolveSource: resolver });
							if (reviewDigest(draft.basis) !== reviewDigest(approvalOptions.currentBasis))
								throw Object.assign(new Error("The imported implementation package belongs to a different or earlier design basis."), { statusCode: 409 });
							const maximumVersion = Math.max(0, ...readImplementationHandoffLifecycle(root).history.map((item) => item.version));
							if (draft.version <= maximumVersion)
								throw Object.assign(new Error("Imported implementation packages cannot replace immutable version history."), { statusCode: 409 });
							writeImplementationHandoffDraft(root, draft, { resolveSource: resolver });
							respond(res, 200, { ok: true, draft });
						} else if (input.action === "approve") {
							const value = approveImplementationHandoff(root, input, approvalOptions);
							respond(res, 200, { ok: true, ...value });
						} else if (input.action === "revoke") {
							const value = revokeImplementationHandoff(root, input, approvalOptions);
							respond(res, 200, { ok: true, ...value });
						} else if (input.action === "compare") {
							respond(res, 200, { ok: true, comparison: compareImplementationHandoffVersions(root, input.left, input.right) });
						} else {
							const draft = readImplementationHandoffDraft(root, { allowMissing: false });
							respond(res, 200, { ok: true, package: exportImplementationHandoffPackage(draft) });
						}
					} finally {
						unlock();
					}
                  }
                  else if (route === "design-feedback-export") {
                    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "scope") || (input.scope !== undefined && !["all", "current"].includes(input.scope))) throw new Error("Review export requires scope current or all.");
                    await syncDesignShare(file, { env, fetchImpl });
                    respond(res, 200, exportDesignReview(file, { scope: input.scope ?? "all", env }));
                  } else {
                    const bundle = readDesignRevision(file, input.revision);
                    const comparisonSources = Object.fromEntries(bundle.envelope.artifacts.map(artifact => [artifact.id, prepareArtifactDocument({ html: artifact.html, artifactId: artifact.id, nonce: createArtifactBridgeNonce(), parentOrigin: `http://127.0.0.1:${server.port}`, portable: true, allowLocalForms: true }).html]));
                    respond(res, 200, { ...bundle, comparisonSources });
                  }
                } else if (route === "design-share-runtime" && req.method === "GET") {
                  res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
                  res.end(readFileSync(new URL("../../templates/studio/share.js", import.meta.url), "utf8"));
                } else if (route === "design-share" && req.method === "GET") {
                  respond(res, 200, getDesignShareStatus(file, { env }));
                } else if (route === "design-share" && req.method === "POST") {
                  if (req.headers["x-openplanr-design"] !== "1" || !String(req.headers["content-type"] ?? "").startsWith("application/json")) throw Object.assign(new Error("Sharing requires a same-origin studio request."), { statusCode: 403 });
                  const origin = req.headers.origin;
                  if (origin && origin !== `http://127.0.0.1:${server.port}`) throw Object.assign(new Error("Sharing requires a same-origin studio request."), { statusCode: 403 });
                  const { action } = await readBody(req);
                  const options = { env, fetchImpl };
                  let result;
                  if (action === "create") result = await shareDesign(file, options);
                  else if (action === "publish") result = await publishDesignShare(file, options);
                  else if (action === "sync") result = await syncDesignShare(file, options);
                  else if (action === "recovery") result = await exportDesignShareRecovery(file, { ...options, output: join(env.HOME ?? process.env.HOME, "Downloads", `openplanr-design-recovery-${Date.now()}.json`) });
                  else result = await manageDesignShare(file, action, options);
                  respond(res, 200, result);
                } else if (route === "design-status" && req.method === "GET") {
					const ready = readJson(
						join(current.root, ".design/browser-ready.json"),
						null,
					);
					respond(res, 200, {
						ok: true,
						documentId: current.document.id,
						revision: current.revision,
						status:
							ready?.revision === current.revision ? ready.status : "loading",
						verification: current.verification.status,
					});
				} else if (route === "design-state" && req.method === "GET") {
					respond(res, 200, {
						...readJson(join(current.root, ".design/studio-state.json"), {
							state: {},
							stateVersion: 0,
						}),
						revision: current.revision,
					});
				} else if (route === "design-state" && req.method === "PUT") {
					respond(res, 200, await saveDesignState(file, await readBody(req)));
				} else if (route === "design-ready" && req.method === "POST") {
					const value = await readBody(req);
					if (
						value.revision !== current.revision ||
						value.status !== "ready" ||
						!Array.isArray(value.artifacts) ||
						current.entries.some(
							(entry) => !value.artifacts.includes(entry.artifactId),
						)
					)
						throw new Error(
							"Browser readiness does not cover every expected design artboard.",
						);
					atomicJson(join(current.root, ".design/browser-ready.json"), {
						status: "ready",
						revision: current.revision,
						checkedAt: new Date().toISOString(),
					});
					respond(res, 200, { ok: true });
				} else if (route === "design-export" && req.method === "GET") {
					const state = readJson(
						join(current.root, ".design/studio-state.json"),
						{ state: {} },
					).state;
					res.writeHead(200, {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					});
					res.end(
						standaloneDesignHtml(
							{ ...current, state },
							state.view ?? current.document.defaultView,
						),
					);
				} else
					respond(res, 404, { ok: false, error: "Unknown design operation." });
			} catch (error) {
				respond(res, error.statusCode ?? 400, {
					ok: false,
					error: error.message,
				});
			}
			return true;
		},
	});
	try {
		try {
			await server.listen(port);
		} catch (error) {
			if (!port || error.code !== "EADDRINUSE") throw error;
			await server.listen(0);
		}
		const origin = `http://127.0.0.1:${server.port}`;
		const health = await fetchImpl(`${origin}/health`).then((response) =>
			response.json(),
		);
		if (!health.ok || health.instanceId !== server.instanceId)
			throw new Error("Design review server health check failed.");
		const registered = await fetchImpl(`${origin}/internal/v1/sessions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${server.controlToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				envelope: current.envelope,
				title: current.document.title,
				cwd: current.root,
				reviewKey: designReviewKey(current.document),
			}),
		});
		const registration = await registered.json();
		if (!registered.ok)
			throw new Error(
				`Design review registration failed: ${JSON.stringify(registration)}`,
			);
		const url = `${origin}${registration.path}`;
		if (!(await fetchImpl(url)).ok)
			throw new Error("Design studio document failed to load.");
		atomicJson(stateFile, {
			version: VERSION,
			url,
			sessionId: registration.sessionId,
			pid: process.pid,
			instanceId: server.instanceId,
		});
		if (!noOpen) await openUrl?.(url);
		return {
			ok: true,
			url,
			sessionId: registration.sessionId,
			status: "loading",
			revision: current.revision,
			reviewPath: designReviewPath(file, env),
			close: () => server.close(),
		};
	} catch (error) {
		await server.close();
		throw error;
	}
}

export async function resolveDesignPins(
	file,
	{ pinIds, summary, env = process.env },
) {
	const current = currentDesign(file);
	if (current.verification.status !== "verified")
		throw new Error(
			"Inspect and verify the rendered revision before resolving pins.",
		);
	if (!summary?.trim() || !pinIds?.length)
		throw new Error("Pin resolution requires pin IDs and a change summary.");
	const path = designReviewPath(file, env);
	return withArtifactReviewLock(path, () => {
		const ledger = readArtifactReviewState(path);
		const wanted = new Set(pinIds),
			found = new Set();
		const revisions = ledger.reviews.map((entry) => ({
			...entry,
			review: {
				...entry.review,
				pins: entry.review.pins.map((pin) => {
					if (!wanted.has(pin.id)) return pin;
					const artifact = current.envelope.artifacts.find(
						(item) => item.id === pin.artifactId,
					);
					if (!artifact)
						throw new PipelineError(
							ARTIFACT_ERROR_CODES.STALE_REVIEW,
							`Pin ${pin.id} has no current screen. Keep it stale until explicitly mapped.`,
						);
					if (
						pin.anchor?.planrId &&
						!artifact.html.includes(`data-planr-id="${pin.anchor.planrId}"`) &&
						!artifact.html.includes(`id="${pin.anchor.planrId}"`)
					)
						throw new PipelineError(
							ARTIFACT_ERROR_CODES.STALE_REVIEW,
							`Pin ${pin.id} has no current anchor. Keep it stale until explicitly mapped.`,
						);
					found.add(pin.id);
					return {
						...pin,
						status: "resolved",
						updatedAt: new Date().toISOString(),
					};
				}),
			},
		}));
		if (found.size !== wanted.size)
			throw new PipelineError(
				ARTIFACT_ERROR_CODES.REVIEW_INVALID,
				"One or more requested pins do not exist.",
			);
		writeArtifactReviewState(
			path,
			createReviewLedger({ ...ledger, reviews: revisions }),
		);
		const history = readJson(
			join(current.root, ".design/review-history.json"),
			[],
		);
		atomicJson(join(current.root, ".design/review-history.json"), [
			...history,
			{
				revision: current.revision,
				pinIds,
				summary,
				at: new Date().toISOString(),
			},
		]);
		return { ok: true, resolved: [...found], revision: current.revision };
	});
}
