import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderArtifactShellDocument } from "../artifact/ui/shell.mjs";
import { renderDesignStudioMarkup } from "./studio-render.mjs";
export { DESIGN_STUDIO_VERSION, DESIGN_STUDIO_ASSETS } from "./studio-render.mjs";
import { renderDesignReviewExportSource } from "./review-export.mjs";
const templateRoot = new URL("../../templates/studio/", import.meta.url);

/** Stable review identities are independent of presentation and render revision. */
export function designStudioArtifactId(variantId, screenId, frameId) {
	// Length-prefixed encoding avoids ambiguities when ids contain separators.
	const id = [
		"design",
		...[variantId, screenId, frameId].map(
			(value) => `${value.length}-${value}`,
		),
	].join(".");
	return id.length <= 128
		? id
		: `design.${createHash("sha256")
				.update(JSON.stringify([variantId, screenId, frameId]))
				.digest("hex")}`;
}

export function createDesignStudioEntries(document, envelope) {
	const ids = new Set(envelope.artifacts.map(({ id }) => id));
	const entries = [];
	for (const variant of document.variants.filter(
		({ status }) => status === "ready",
	)) {
		for (const screenId of document.screenOrder) {
			for (const frame of document.frames) {
				const artifactId = designStudioArtifactId(
					variant.id,
					screenId,
					frame.id,
				);
				if (!ids.has(artifactId))
					throw new Error(`Design studio is missing artifact ${artifactId}.`);
				entries.push({
					artifactId,
					variantId: variant.id,
					screenId,
					frameId: frame.id,
				});
			}
		}
	}
	return entries;
}

export function renderDesignStudio(input = {}, options = {}) {
  return renderDesignStudioMarkup({...input, entries: input.entries ?? createDesignStudioEntries(input.document, input.envelope)}, {
    ...options,
    renderShell: renderArtifactShellDocument,
    style: ["studio.css", "enhancements.css"].map(file => readFileSync(new URL(file, templateRoot), "utf8")).join("\n"),
    runtime: renderDesignReviewExportSource() + "\n" + ["studio.js", "enhancements.js"].map(file => readFileSync(new URL(file, templateRoot), "utf8")).join("\n"),
  });
}
