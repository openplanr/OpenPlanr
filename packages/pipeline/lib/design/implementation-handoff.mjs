import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { canonicalizeJson } from "../protocol/canonical-json.mjs";
import {
	assertDesignImplementationHandoff,
	designImplementationHandoffDigest,
	isDesignHandoffRelativePath,
} from "../protocol/design-handoff-contracts.mjs";
import { renderImplementationHandoffMarkdown } from "./implementation-handoff-markdown.mjs";

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REQUIREMENT_KINDS = new Set([
	"behavior",
	"visual-state",
	"responsive",
	"accessibility",
	"content-data-assumption",
	"constraint",
	"verification-intent",
]);
const INPUT_FIELDS = new Set(["id", "version", "title", "basis", "sources", "requirements"]);
const REQUIREMENT_FIELDS = new Set(["id", "kind", "statement", "sourceRefs", "verification"]);

const normalizeText = (value, label) => {
	if (typeof value !== "string") throw new TypeError(`${label} must be text.`);
	const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
	if (!normalized) throw new TypeError(`${label} cannot be empty.`);
	return normalized;
};
const clone = (value) => JSON.parse(canonicalizeJson(value));
const sha256 = (value) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const assertKnownKeys = (value, allowed, label) => {
	if (Object.keys(value).some((key) => !allowed.has(key)))
		throw new TypeError(`${label} contains unknown fields.`);
};

function atomicText(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function assertPackageSize(value) {
	if (Buffer.byteLength(jsonBytes(value)) > MAX_PACKAGE_BYTES)
		throw new TypeError("The implementation handoff JSON exceeds 2 MB.");
	if (Buffer.byteLength(value.markdown) > MAX_PACKAGE_BYTES)
		throw new TypeError("The implementation handoff Markdown exceeds 2 MB.");
}

function normalizeSource(source) {
	if (!source || typeof source !== "object" || Array.isArray(source))
		throw new TypeError("Implementation sources must be objects.");
	if (!isDesignHandoffRelativePath(source.path) || /[?#%]/u.test(source.path))
		throw new TypeError("Implementation sources require repository-relative logical paths.");
	if (source.path.includes("`"))
		throw new TypeError("Implementation source paths cannot contain Markdown delimiters.");
	if (/(?:^|\/)[^/:\s]+:[^/@\s]+@/u.test(source.path))
		throw new TypeError("Implementation source paths cannot contain credentials.");
	if (!DIGEST.test(source.revision ?? "") || !DIGEST.test(source.digest ?? ""))
		throw new TypeError("Implementation sources require exact revision and integrity values.");
	return clone(source);
}

function requirementFingerprint(requirement) {
	return canonicalizeJson({
		kind: requirement.kind,
		statement: normalizeText(requirement.statement, "Requirement statement"),
		sourceRefs: requirement.sourceRefs.map((value) => normalizeText(value, "Source reference")),
		verification: requirement.verification.map((value) =>
			normalizeText(value, "Verification expectation"),
		),
	});
}

export function deriveImplementationRequirementId(requirement) {
	const hexadecimal = createHash("sha256")
		.update(requirementFingerprint(requirement))
		.digest("hex");
	const numeric = (BigInt(`0x${hexadecimal}`) % 1_000_000_000_000n)
		.toString(10)
		.padStart(12, "0");
	return `REQ-${numeric}`;
}

function normalizeRequirement(requirement) {
	if (!requirement || typeof requirement !== "object" || Array.isArray(requirement))
		throw new TypeError("Implementation requirements must be objects.");
	assertKnownKeys(
		requirement,
		REQUIREMENT_FIELDS,
		"Implementation requirement",
	);
	if (!REQUIREMENT_KINDS.has(requirement.kind))
		throw new TypeError("Unknown implementation requirement kind.");
	if (!Array.isArray(requirement.sourceRefs) || !requirement.sourceRefs.length)
		throw new TypeError("Implementation requirements need source references.");
	if (new Set(requirement.sourceRefs).size !== requirement.sourceRefs.length)
		throw new TypeError("Implementation requirement source references must be distinct.");
	if (!Array.isArray(requirement.verification) || !requirement.verification.length)
		throw new TypeError("Implementation requirements need observable verification expectations.");
	const normalized = {
		kind: requirement.kind,
		statement: normalizeText(requirement.statement, "Requirement statement"),
		sourceRefs: requirement.sourceRefs.map((value) => normalizeText(value, "Source reference")),
		verification: requirement.verification.map((value) =>
			normalizeText(value, "Verification expectation"),
		),
	};
	const id = deriveImplementationRequirementId(normalized);
	if (requirement.id !== undefined && requirement.id !== id)
		throw new TypeError("The supplied requirement identity does not match its canonical content.");
	return { id, ...normalized };
}

/** Compose one closed, deterministic draft without reading or writing source files. */
export function composeImplementationHandoff(input) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new TypeError("Implementation handoff input must be an object.");
	assertKnownKeys(
		input,
		INPUT_FIELDS,
		"Implementation handoff input",
	);
	const sources = (input.sources ?? []).map(normalizeSource).sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	if (new Set(sources.map((source) => source.id)).size !== sources.length)
		throw new TypeError("Duplicate implementation source identity.");
	const sourceIds = new Set(sources.map((source) => source.id));
	const requirements = (input.requirements ?? [])
		.map(normalizeRequirement)
		.sort((left, right) => left.id.localeCompare(right.id));
	if (!requirements.length)
		throw new TypeError("An implementation handoff needs at least one requirement.");
	if (new Set(requirements.map((item) => item.id)).size !== requirements.length)
		throw new TypeError("Duplicate or colliding implementation requirement identity.");
	for (const requirement of requirements) {
		if (requirement.sourceRefs.some((reference) => !sourceIds.has(reference)))
			throw new TypeError("Implementation requirement references missing evidence.");
	}

	const base = {
		kind: "openplanr-design-implementation-handoff",
		schemaVersion: "1.0.0",
		id: normalizeText(input.id, "Implementation handoff identity"),
		version: input.version ?? 1,
		status: "draft",
		authority: "prepare-plan",
		title: normalizeText(input.title, "Implementation handoff title"),
		basis: clone(input.basis),
		sources,
		requirements,
	};
	const markdown = renderImplementationHandoffMarkdown(base);
	const value = { ...base, contentDigest: "sha256:" + "0".repeat(64), markdown };
	value.contentDigest = designImplementationHandoffDigest(value);
	assertDesignImplementationHandoff(value);
	assertPackageSize(value);
	return value;
}

export function assertImplementationHandoffProjection(value) {
	assertDesignImplementationHandoff(value);
	if (value.sources.map((source) => source.id).join("\n") !== [...value.sources].sort((left, right) => left.id.localeCompare(right.id)).map((source) => source.id).join("\n"))
		throw new TypeError("Implementation handoff sources are not in canonical order.");
	if (value.requirements.map((item) => item.id).join("\n") !== [...value.requirements].sort((left, right) => left.id.localeCompare(right.id)).map((item) => item.id).join("\n"))
		throw new TypeError("Implementation handoff requirements are not in canonical order.");
	for (const requirement of value.requirements)
		if (requirement.id !== deriveImplementationRequirementId(requirement))
			throw new TypeError("Implementation requirement identity does not match its canonical content.");
	if (value.markdown !== renderImplementationHandoffMarkdown(value))
		throw new TypeError("Implementation handoff Markdown differs from its JSON projection.");
	assertPackageSize(value);
	return value;
}

const resolvedBytes = (resolved) => {
	const value = resolved?.bytes ?? resolved?.value ?? resolved;
	if (typeof value === "string" || Buffer.isBuffer(value)) return Buffer.from(value);
	if (value instanceof Uint8Array) return Buffer.from(value);
	throw new TypeError("The implementation source resolver must return bytes.");
};

/** Validate every referenced source against an explicit repository resolver. */
export function verifyImplementationHandoffSources(value, resolveSource) {
	assertImplementationHandoffProjection(value);
	if (typeof resolveSource !== "function")
		throw new TypeError("Source verification requires an explicit resolver.");
	for (const source of value.sources) {
		const resolved = resolveSource(source.path, clone(source));
		const bytes = resolvedBytes(resolved);
		if (bytes.byteLength > MAX_SOURCE_BYTES)
			throw new TypeError(`Implementation source ${source.id} exceeds 16 MB.`);
		if (sha256(bytes) !== source.digest)
			throw new TypeError(`Implementation source ${source.id} no longer matches its reference.`);
		if (source.anchor) {
			if (!Array.isArray(resolved?.anchors))
				throw new TypeError(`Implementation source ${source.id} did not resolve its anchor.`);
			const expected = canonicalizeJson(source.anchor);
			if (resolved.anchors.filter((anchor) => canonicalizeJson(anchor) === expected).length !== 1)
				throw new TypeError(`Implementation source ${source.id} has an unresolved or ambiguous anchor.`);
		}
	}
	return value;
}

const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
function discoverAnchor(bytes, anchor) {
	const text = bytes.toString("utf8");
	const values = anchor.elementId ? [anchor.elementId]
		: anchor.pinId ? [anchor.reviewId, anchor.pinId]
		: anchor.section ? [anchor.section]
		: [anchor.screenId];
	const counts = values.map((value) => (text.match(new RegExp(regexEscape(value), "gu")) ?? []).length);
	if (counts.every((count) => count === 1)) return [anchor];
	if (counts.some((count) => count === 0)) return [];
	return [anchor, anchor];
}

export function createRepositorySourceResolver(root) {
	const canonicalRoot = realpathSync(resolve(root));
	return (path, source) => {
		if (!isDesignHandoffRelativePath(path))
			throw new TypeError("Implementation source path is not repository-relative.");
		const candidate = realpathSync(resolve(canonicalRoot, path));
		if (candidate !== canonicalRoot && !candidate.startsWith(`${canonicalRoot}${sep}`))
			throw new TypeError("Implementation source resolves outside the repository root.");
		const bytes = readFileSync(candidate);
		return source?.anchor
			? { bytes, anchors: discoverAnchor(bytes, source.anchor) }
			: bytes;
	};
}

export function implementationHandoffPaths(root) {
	const directory = join(resolve(root), "implementation-handoff");
	return Object.freeze({
		directory,
		draftJson: join(directory, "draft.json"),
		draftMarkdown: join(directory, "draft.md"),
		journal: join(directory, "draft-publication.json"),
		current: join(directory, "current.json"),
		history: join(directory, "versions"),
	});
}

export function recoverImplementationHandoffDraft(root) {
	const paths = implementationHandoffPaths(root);
	if (!existsSync(paths.journal)) return false;
	const journal = JSON.parse(readFileSync(paths.journal, "utf8"));
	const value = assertImplementationHandoffProjection(journal.package);
	if (journal.markdown !== value.markdown)
		throw new TypeError("Implementation handoff recovery journal is inconsistent.");
	atomicText(paths.draftJson, jsonBytes(value));
	atomicText(paths.draftMarkdown, value.markdown);
	rmSync(paths.journal, { force: true });
	return true;
}

export function readImplementationHandoffDraft(root, { allowMissing = true } = {}) {
	const paths = implementationHandoffPaths(root);
	recoverImplementationHandoffDraft(root);
	if (!existsSync(paths.draftJson)) {
		if (allowMissing) return null;
		throw new Error("No implementation handoff draft exists.");
	}
	const value = assertImplementationHandoffProjection(
		JSON.parse(readFileSync(paths.draftJson, "utf8")),
	);
	if (!existsSync(paths.draftMarkdown))
		throw new Error("Implementation handoff Markdown is missing.");
	if (readFileSync(paths.draftMarkdown, "utf8") !== value.markdown)
		throw new Error("Implementation handoff JSON and Markdown projections differ.");
	return value;
}

export function writeImplementationHandoffDraft(root, input, { resolveSource } = {}) {
	const value = input?.kind
		? assertImplementationHandoffProjection(clone(input))
		: composeImplementationHandoff(input);
	if (value.status !== "draft")
		throw new TypeError("Only editable drafts can be written through the draft composer.");
	if (resolveSource) verifyImplementationHandoffSources(value, resolveSource);
	const paths = implementationHandoffPaths(root);
	atomicText(paths.journal, jsonBytes({ package: value, markdown: value.markdown }));
	recoverImplementationHandoffDraft(root);
	return value;
}

export function exportImplementationHandoffPackage(value) {
	const checked = assertImplementationHandoffProjection(clone(value));
	return Object.freeze({ json: jsonBytes(checked), markdown: checked.markdown });
}

export function importImplementationHandoffPackage(
	input,
	{ resolveSource } = {},
) {
	if (!input || typeof input.json !== "string" || typeof input.markdown !== "string")
		throw new TypeError("Portable handoff import requires JSON and Markdown text.");
	if (Buffer.byteLength(input.json) > MAX_PACKAGE_BYTES || Buffer.byteLength(input.markdown) > MAX_PACKAGE_BYTES)
		throw new TypeError("Portable handoff import exceeds 2 MB.");
	const value = assertImplementationHandoffProjection(JSON.parse(input.json));
	if (input.markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n") !== value.markdown)
		throw new TypeError("Imported handoff Markdown does not match its JSON projection.");
	if (resolveSource) verifyImplementationHandoffSources(value, resolveSource);
	return value;
}
