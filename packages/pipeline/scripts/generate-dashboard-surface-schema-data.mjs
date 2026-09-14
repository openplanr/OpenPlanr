#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputs = Object.freeze([
	[
		"OPERATE_ACTION_DISPLAY_WORKSPACE_SCHEMA",
		"schemas/v1.2.0/operate-action-display-workspace.schema.json",
	],
	[
		"OPERATE_CYCLE_DISPLAY_WORKSPACE_SCHEMA",
		"schemas/v1.2.0/operate-cycle-display-workspace.schema.json",
	],
	[
		"OPERATE_RECOVERY_DISPLAY_SURFACE_SCHEMA",
		"schemas/v1.2.0/operate-recovery-display-surface.schema.json",
	],
	[
		"OPERATE_EXECUTIVE_BOARD_DISPLAY_SURFACE_SCHEMA",
		"schemas/v1.2.0/operate-executive-board-display-surface.schema.json",
	],
	[
		"OPERATE_EXPERIENCE_DISPLAY_SURFACE_SCHEMA",
		"schemas/v1.2.0/operate-experience-display-surface.schema.json",
	],
	[
		"OPERATE_EXPERIENCE_AUDIT_DISPLAY_SURFACE_SCHEMA",
		"schemas/v1.2.0/operate-experience-audit-display-surface.schema.json",
	],
	[
		"OPERATE_EXPERIENCE_SURFACE_SCHEMA",
		"schemas/v1.2.0/operate-experience-surface.schema.json",
	],
	[
		"OPERATE_API_ENVELOPE_SCHEMA",
		"schemas/v2.0.0/operate-api-envelope.schema.json",
	],
	[
		"OPERATE_ALLOWED_ACTION_SCHEMA",
		"schemas/v2.0.0/operate-allowed-action.schema.json",
	],
	[
		"OPERATE_EXPERIENCE_VIEW_SCHEMA",
		"schemas/v2.0.0/operate-experience-view.schema.json",
	],
	[
		"OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA",
		"schemas/v2.0.0/operate-review-bound-submission.schema.json",
	],
	[
		"OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA",
		"schemas/v2.0.0/operate-review-display-workspace.schema.json",
	],
	[
		"OPERATING_ASSIGNMENT_SCHEMA",
		"schemas/v2.0.0/operating-assignment.schema.json",
	],
	[
		"OPERATING_FINDING_SCHEMA",
		"schemas/v2.0.0/operating-finding.schema.json",
	],
	[
		"OPERATE_EXPERIENCE_PREVIEW_SCHEMA",
		"schemas/v2.0.0/operate-experience-preview.schema.json",
	],
	[
		"OPERATING_WORK_LEDGER_SCHEMA",
		"schemas/v2.0.0/operating-work-ledger.schema.json",
	],
	[
		"OPERATING_DELIVERY_ROUTE_SCHEMA",
		"schemas/v2.0.0/operating-delivery-route.schema.json",
	],
	[
		"OPERATING_EVIDENCE_RESOLUTION_SCHEMA",
		"schemas/v2.0.0/operating-evidence-resolution.schema.json",
	],
	[
		"OPERATING_EXECUTION_RESULT_SCHEMA",
		"schemas/v2.0.0/operating-execution-result.schema.json",
	],
	[
		"OPERATING_GOVERNED_OPERATION_SCHEMA",
		"schemas/v2.0.0/operating-governed-operation.schema.json",
	],
	["OPERATING_REVIEW_SCHEMA", "schemas/v2.0.0/operating-review.schema.json"],
	[
		"OPERATING_REVIEW_READ_SCHEMA",
		"schemas/v2.0.0/operating-review-read.schema.json",
	],
	[
		"OPERATING_REVIEW_RECEIPT_SCHEMA",
		"schemas/v2.0.0/operating-review-receipt.schema.json",
	],
	[
		"OPERATING_TRACE_MATRIX_SCHEMA",
		"schemas/v2.0.0/operating-trace-matrix.schema.json",
	],
]);

const reviewInputNames = Object.freeze([
	"OPERATE_ALLOWED_ACTION_SCHEMA",
	"OPERATE_EXPERIENCE_VIEW_SCHEMA",
	"OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA",
	"OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA",
	"OPERATING_ASSIGNMENT_SCHEMA",
	"OPERATING_EVIDENCE_RESOLUTION_SCHEMA",
	"OPERATING_REVIEW_SCHEMA",
	"OPERATING_REVIEW_READ_SCHEMA",
	"OPERATING_REVIEW_RECEIPT_SCHEMA",
	"OPERATING_TRACE_MATRIX_SCHEMA",
]);
const reviewValidationRootNames = Object.freeze([
	"OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA",
	"OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA",
	"OPERATING_REVIEW_RECEIPT_SCHEMA",
]);

const reviewInputs = Object.freeze(
	inputs
		.filter(([exportName]) => reviewInputNames.includes(exportName))
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
);

if (reviewInputs.length !== reviewInputNames.length) {
	throw new Error("The dashboard Review schema input inventory is incomplete.");
}

function decodeJsonPointer(pointer) {
	if (pointer === "") return [];
	if (!pointer.startsWith("/")) {
		throw new Error(`Unsupported Review schema reference fragment: #${pointer}`);
	}
	return pointer
		.slice(1)
		.split("/")
		.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function schemaAtPointer(schema, pointer, filename) {
	let value = schema;
	for (const part of decodeJsonPointer(pointer)) {
		if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) {
			throw new Error(`Unresolved Review schema reference: ${filename}#${pointer}`);
		}
		value = value[part];
	}
	return value;
}

function setSchemaPointer(schema, pointer, value) {
	const parts = decodeJsonPointer(pointer);
	let target = schema;
	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index];
		if (!Object.hasOwn(target, part)) target[part] = {};
		if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) {
			throw new Error(`Review schema pointer cannot be materialized: #${pointer}`);
		}
		target = target[part];
	}
	if (parts.length > 0) target[parts.at(-1)] = structuredClone(value);
}

function visitReachableSchema(schema, visitReference) {
	if (Array.isArray(schema)) {
		for (const entry of schema) visitReachableSchema(entry, visitReference);
		return;
	}
	if (!schema || typeof schema !== "object") return;
	if (typeof schema.$ref === "string") visitReference(schema.$ref);
	for (const [keyword, value] of Object.entries(schema)) {
		if (keyword === "$defs" || keyword === "definitions") continue;
		visitReachableSchema(value, visitReference);
	}
}

function minimalSchemaPointers(pointers) {
	const entries = [...pointers]
		.map((pointer) => ({ pointer, parts: decodeJsonPointer(pointer) }))
		.sort((left, right) => (
			left.parts.length - right.parts.length
			|| (left.pointer < right.pointer ? -1 : left.pointer > right.pointer ? 1 : 0)
		));
	return entries
		.filter((entry, index) => !entries.slice(0, index).some((candidate) => (
			candidate.parts.length <= entry.parts.length
			&& candidate.parts.every((part, partIndex) => part === entry.parts[partIndex])
		)))
		.map(({ pointer }) => pointer);
}

function buildReviewSchemaSlices(sourceRoot) {
	const schemas = new Map(reviewInputs.map(([exportName, relativePath]) => {
		const schema = JSON.parse(readFileSync(resolve(sourceRoot, relativePath), "utf8"));
		return [relativePath.split("/").at(-1), { exportName, relativePath, schema }];
	}));
	const requirements = new Map();
	const queued = new Set();
	const queue = [];

	const enqueue = (sourceFilename, reference) => {
		const hashIndex = reference.indexOf("#");
		const referencePath = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
		const pointer = hashIndex === -1 ? "" : reference.slice(hashIndex + 1);
		const filename = referencePath === ""
			? sourceFilename
			: referencePath.split("/").at(-1);
		if (!schemas.has(filename)) {
			throw new Error(`Review schema closure escapes its declared inventory: ${reference}`);
		}
		decodeJsonPointer(pointer);
		const key = `${filename}#${pointer}`;
		if (queued.has(key)) return;
		queued.add(key);
		queue.push({ filename, pointer });
		const requirement = requirements.get(filename) ?? { full: false, pointers: new Set() };
		if (pointer === "") requirement.full = true;
		else requirement.pointers.add(pointer);
		requirements.set(filename, requirement);
	};

	for (const rootName of reviewValidationRootNames) {
		const root = reviewInputs.find(([exportName]) => exportName === rootName);
		if (!root) throw new Error(`Missing Review validation root: ${rootName}`);
		enqueue(root[1].split("/").at(-1), "");
	}

	while (queue.length > 0) {
		const { filename, pointer } = queue.shift();
		const document = schemas.get(filename).schema;
		const selected = pointer === "" ? document : schemaAtPointer(document, pointer, filename);
		visitReachableSchema(selected, (reference) => enqueue(filename, reference));
	}

	const slices = new Map();
	const fullRelativePaths = new Set();
	for (const [filename, { relativePath, schema }] of schemas) {
		const requirement = requirements.get(filename);
		if (!requirement) {
			throw new Error(
				`Review schema inventory member is unreachable: ${relativePath}; reachable: ${[
					...requirements.keys(),
				].sort().join(", ")}`,
			);
		}
		if (requirement.full) {
			slices.set(relativePath, schema);
			fullRelativePaths.add(relativePath);
			continue;
		}
		const slice = {};
		for (const keyword of ["$schema", "$id", "x-openplanr-contract", "title", "description"]) {
			if (Object.hasOwn(schema, keyword)) slice[keyword] = structuredClone(schema[keyword]);
		}
		for (const pointer of minimalSchemaPointers(requirement.pointers)) {
			setSchemaPointer(slice, pointer, schemaAtPointer(schema, pointer, filename));
		}
		slices.set(relativePath, slice);
	}
	return { slices, fullRelativePaths };
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

const VALUE_TAG = Object.freeze({
	null: 0,
	false: 1,
	true: 2,
	number: 3,
	string: 4,
	array: 5,
	object: 6,
});

function countSchemaTokens(value, frequencies) {
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "number") {
		const token = JSON.stringify(value);
		frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		return;
	}
	if (typeof value === "string") {
		frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) countSchemaTokens(entry, frequencies);
		return;
	}
	for (const [key, entry] of Object.entries(value)) {
		frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
		countSchemaTokens(entry, frequencies);
	}
}

function buildSchemaTokens(definitions) {
	const frequencies = new Map();
	for (const { schema } of definitions) countSchemaTokens(schema, frequencies);
	return [...frequencies]
		.sort(([leftToken, leftCount], [rightToken, rightCount]) => (
			rightCount - leftCount
			|| (leftToken < rightToken ? -1 : leftToken > rightToken ? 1 : 0)
		))
		.map(([token]) => token);
}

function writeVarUint(bytes, value) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
		throw new Error(`Dashboard schema token integer is out of range: ${value}`);
	}
	let remaining = value;
	do {
		let byte = remaining % 128;
		remaining = Math.floor(remaining / 128);
		if (remaining > 0) byte |= 0x80;
		bytes.push(byte);
	} while (remaining > 0);
}

function encodeSchemaTokenValue(value, tokenIndexes, bytes, depth = 0) {
	if (depth > 256) throw new Error("Dashboard schema token nesting exceeds 256 levels.");
	if (value === null) {
		bytes.push(VALUE_TAG.null);
		return;
	}
	if (value === false) {
		bytes.push(VALUE_TAG.false);
		return;
	}
	if (value === true) {
		bytes.push(VALUE_TAG.true);
		return;
	}
	if (typeof value === "number") {
		bytes.push(VALUE_TAG.number);
		writeVarUint(bytes, tokenIndexes.get(JSON.stringify(value)));
		return;
	}
	if (typeof value === "string") {
		bytes.push(VALUE_TAG.string);
		writeVarUint(bytes, tokenIndexes.get(value));
		return;
	}
	if (Array.isArray(value)) {
		bytes.push(VALUE_TAG.array);
		writeVarUint(bytes, value.length);
		for (const entry of value) {
			encodeSchemaTokenValue(entry, tokenIndexes, bytes, depth + 1);
		}
		return;
	}
	if (!value || typeof value !== "object") {
		throw new Error(`Unsupported dashboard schema token value: ${typeof value}`);
	}
	const entries = Object.entries(value);
	bytes.push(VALUE_TAG.object);
	writeVarUint(bytes, entries.length);
	for (const [key, entry] of entries) {
		writeVarUint(bytes, tokenIndexes.get(key));
		encodeSchemaTokenValue(entry, tokenIndexes, bytes, depth + 1);
	}
}

function encodeSchemaTokenPayload(schema, tokenIndexes) {
	const bytes = [];
	encodeSchemaTokenValue(schema, tokenIndexes, bytes);
	return Buffer.from(bytes).toString("base64");
}

function readSchemaDefinitions(selectedInputs, {
	sourceRoot,
	schemaOverrides = new Map(),
	exportNameFor = (exportName) => exportName,
}) {
	return selectedInputs.map(([exportName, relativePath]) => {
		const source = readFileSync(resolve(sourceRoot, relativePath), "utf8");
		return {
			exportName: exportNameFor(exportName),
			relativePath,
			schema: schemaOverrides.get(relativePath) ?? JSON.parse(source),
			sourceHash: sha256(source),
		};
	});
}

function buildSchemaGenerationPlan(sourceRoot) {
	const { slices, fullRelativePaths } = buildReviewSchemaSlices(sourceRoot);
	const sharedInputs = reviewInputs.filter(([, relativePath]) => (
		fullRelativePaths.has(relativePath)
	));
	const canonicalInputs = inputs.filter(([, relativePath]) => (
		!fullRelativePaths.has(relativePath)
	));
	const surfaceDefinitions = readSchemaDefinitions(canonicalInputs, { sourceRoot });
	const reviewDefinitions = readSchemaDefinitions(reviewInputs, {
		sourceRoot,
		schemaOverrides: slices,
		exportNameFor: (exportName) => `${exportName}_REVIEW_SLICE`,
	});
	const tokens = buildSchemaTokens([...surfaceDefinitions, ...reviewDefinitions]);
	const tokenIndexes = new Map(tokens.map((token, index) => [token, index]));
	return {
		tokens,
		surfaceDefinitions,
		reviewDefinitions,
		reexports: sharedInputs.map(([exportName]) => ({
			sourceName: `${exportName}_REVIEW_SLICE`,
			exportName,
		})),
		encode: (schema) => encodeSchemaTokenPayload(schema, tokenIndexes),
	};
}

function generateSchemaData(definitions, {
	reviewSpecific,
	reexports = [],
	encode,
}) {
	const lines = [
		"// Generated by scripts/generate-dashboard-surface-schema-data.mjs.",
		...(reviewSpecific
			? ["// Review-specific reachable schema subset for the browser contract."]
			: []),
		"// Canonical JSON schemas remain authoritative. Do not edit this file.",
		"",
		'import { decodeDashboardSchema } from "./operate-schema-token-codec.mjs";',
		"",
	];
	if (reexports.length > 0) {
		lines.push(
			"export {",
			...reexports.map(({ sourceName, exportName }) => (
				sourceName === exportName
					? `\t${sourceName},`
					: `\t${sourceName} as ${exportName},`
			)),
			"} from \"./operate-review-schema-data.mjs\";",
			"",
		);
	}
	for (const { exportName, relativePath, schema, sourceHash } of definitions) {
		lines.push(`// ${relativePath} sha256:${sourceHash}`);
		lines.push(
			`export const ${exportName} = /* @__PURE__ */ decodeDashboardSchema(${JSON.stringify(encode(schema))});`,
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}

function generateSchemaTokenCodecData(tokens) {
	return `// Generated by scripts/generate-dashboard-surface-schema-data.mjs.
// Shared lossless token dictionary for browser-safe dashboard schema decoding.
// Canonical JSON schemas remain authoritative. Do not edit this file.

const DASHBOARD_SCHEMA_TOKENS = Object.freeze(${JSON.stringify(tokens)});
const MAX_PAYLOAD_LENGTH = 1_000_000;
const MAX_NODES = 500_000;
const MAX_DEPTH = 256;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const JSON_NUMBER = /^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$/u;

function invalidTokenPayload() {
\tconst error = new TypeError("Dashboard schema token payload is invalid.");
\tObject.defineProperty(error, "code", {
\t\tvalue: "E_DASHBOARD_SCHEMA_TOKEN_INVALID",
\t\tenumerable: true,
\t\tconfigurable: false,
\t\twritable: false,
\t});
\treturn error;
}

function decodeBase64(payload) {
\tif (
\t\ttypeof payload !== "string"
\t\t|| payload.length === 0
\t\t|| payload.length > MAX_PAYLOAD_LENGTH
\t\t|| payload.length % 4 !== 0
\t\t|| !BASE64.test(payload)
\t) throw invalidTokenPayload();
\tlet decoded;
\ttry {
\t\tdecoded = globalThis.atob(payload);
\t\tif (globalThis.btoa(decoded) !== payload) throw invalidTokenPayload();
\t} catch {
\t\tthrow invalidTokenPayload();
\t}
\tconst bytes = new Uint8Array(decoded.length);
\tfor (let index = 0; index < decoded.length; index += 1) {
\t\tconst byte = decoded.charCodeAt(index);
\t\tif (byte > 0xff) throw invalidTokenPayload();
\t\tbytes[index] = byte;
\t}
\treturn bytes;
}

export function decodeDashboardSchema(payload) {
\tconst bytes = decodeBase64(payload);
\tlet offset = 0;
\tlet nodeCount = 0;
\tconst readByte = () => {
\t\tif (offset >= bytes.length) throw invalidTokenPayload();
\t\tconst byte = bytes[offset];
\t\toffset += 1;
\t\treturn byte;
\t};
\tconst readVarUint = () => {
\t\tlet value = 0;
\t\tlet multiplier = 1;
\t\tfor (let index = 0; index < 5; index += 1) {
\t\t\tconst byte = readByte();
\t\t\tvalue += (byte & 0x7f) * multiplier;
\t\t\tif (value > 0xffff_ffff) throw invalidTokenPayload();
\t\t\tif ((byte & 0x80) === 0) {
\t\t\t\tif (index > 0 && byte === 0) throw invalidTokenPayload();
\t\t\t\treturn value;
\t\t\t}
\t\t\tmultiplier *= 128;
\t\t}
\t\tthrow invalidTokenPayload();
\t};
\tconst readToken = () => {
\t\tconst token = DASHBOARD_SCHEMA_TOKENS[readVarUint()];
\t\tif (typeof token !== "string") throw invalidTokenPayload();
\t\treturn token;
\t};
\tconst readValue = (depth) => {
\t\tnodeCount += 1;
\t\tif (nodeCount > MAX_NODES || depth > MAX_DEPTH) throw invalidTokenPayload();
\t\tswitch (readByte()) {
\t\t\tcase ${VALUE_TAG.null}: return null;
\t\t\tcase ${VALUE_TAG.false}: return false;
\t\t\tcase ${VALUE_TAG.true}: return true;
\t\t\tcase ${VALUE_TAG.number}: {
\t\t\t\tconst token = readToken();
\t\t\t\tif (!JSON_NUMBER.test(token)) throw invalidTokenPayload();
\t\t\t\tconst number = Number(token);
\t\t\t\tif (!Number.isFinite(number) || JSON.stringify(number) !== token) {
\t\t\t\t\tthrow invalidTokenPayload();
\t\t\t\t}
\t\t\t\treturn number;
\t\t\t}
\t\t\tcase ${VALUE_TAG.string}: return readToken();
\t\t\tcase ${VALUE_TAG.array}: {
\t\t\t\tconst length = readVarUint();
\t\t\t\tif (length > MAX_NODES - nodeCount) throw invalidTokenPayload();
\t\t\t\tconst value = new Array(length);
\t\t\t\tfor (let index = 0; index < length; index += 1) {
\t\t\t\t\tvalue[index] = readValue(depth + 1);
\t\t\t\t}
\t\t\t\treturn value;
\t\t\t}
\t\t\tcase ${VALUE_TAG.object}: {
\t\t\t\tconst length = readVarUint();
\t\t\t\tif (length > MAX_NODES - nodeCount) throw invalidTokenPayload();
\t\t\t\tconst value = {};
\t\t\t\tfor (let index = 0; index < length; index += 1) {
\t\t\t\t\tconst key = readToken();
\t\t\t\t\tif (Object.hasOwn(value, key)) throw invalidTokenPayload();
\t\t\t\t\tObject.defineProperty(value, key, {
\t\t\t\t\t\tvalue: readValue(depth + 1),
\t\t\t\t\t\tenumerable: true,
\t\t\t\t\t\tconfigurable: true,
\t\t\t\t\t\twritable: true,
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\treturn value;
\t\t\t}
\t\t\tdefault: throw invalidTokenPayload();
\t\t}
\t};
\tconst schema = readValue(0);
\tif (offset !== bytes.length || !schema || typeof schema !== "object" || Array.isArray(schema)) {
\t\tthrow invalidTokenPayload();
\t}
\treturn schema;
}
`;
}

export function generateDashboardSurfaceSchemaData({
	sourceRoot = repositoryRoot,
} = {}) {
	const plan = buildSchemaGenerationPlan(sourceRoot);
	return generateSchemaData(plan.surfaceDefinitions, {
		reviewSpecific: false,
		reexports: plan.reexports,
		encode: plan.encode,
	});
}

export function generateDashboardReviewSchemaData({
	sourceRoot = repositoryRoot,
} = {}) {
	const plan = buildSchemaGenerationPlan(sourceRoot);
	return generateSchemaData(plan.reviewDefinitions, {
		reviewSpecific: true,
		encode: plan.encode,
	});
}

export function generateDashboardSchemaTokenCodecData({
	sourceRoot = repositoryRoot,
} = {}) {
	return generateSchemaTokenCodecData(buildSchemaGenerationPlan(sourceRoot).tokens);
}

export function deriveDashboardSchemaGenerationValues({
	sourceRoot = repositoryRoot,
} = {}) {
	const plan = buildSchemaGenerationPlan(sourceRoot);
	const review = Object.fromEntries(plan.reviewDefinitions.map(({ exportName, schema }) => [
		exportName,
		structuredClone(schema),
	]));
	const surface = Object.fromEntries(inputs.map(([exportName, relativePath]) => [
		exportName,
		JSON.parse(readFileSync(resolve(sourceRoot, relativePath), "utf8")),
	]));
	return { surface, review };
}

function optionValue(name, argv) {
	const index = argv.indexOf(name);
	return index === -1 ? null : argv[index + 1];
}

function runCli(argv) {
	const sourceRoot = resolve(optionValue("--root", argv) ?? repositoryRoot);
	const outputOption = optionValue("--output", argv);
	const reviewOutputOption = optionValue("--review-output", argv);
	const codecOutputOption = optionValue("--codec-output", argv);
	const customOutputRequested = outputOption !== null
		|| reviewOutputOption !== null
		|| codecOutputOption !== null;
	const generationPlan = buildSchemaGenerationPlan(sourceRoot);
	const targets = [
		...(outputOption !== null || !customOutputRequested
			? [{
				path: resolve(outputOption ?? resolve(
					sourceRoot,
					"lib/dashboard/generated/operate-experience-surface-schema-data.mjs",
				)),
				expected: generateSchemaData(generationPlan.surfaceDefinitions, {
					reviewSpecific: false,
					reexports: generationPlan.reexports,
					encode: generationPlan.encode,
				}),
				driftCode: "E_DASHBOARD_SURFACE_SCHEMA_DRIFT",
				label: "dashboard surface schema data",
			}]
			: []),
		...(reviewOutputOption !== null || !customOutputRequested
			? [{
				path: resolve(reviewOutputOption ?? resolve(
					sourceRoot,
					"lib/dashboard/generated/operate-review-schema-data.mjs",
				)),
				expected: generateSchemaData(generationPlan.reviewDefinitions, {
					reviewSpecific: true,
					encode: generationPlan.encode,
				}),
				driftCode: "E_DASHBOARD_REVIEW_SCHEMA_DRIFT",
				label: "dashboard Review schema data",
			}]
			: []),
		...(codecOutputOption !== null || !customOutputRequested
			? [{
				path: resolve(codecOutputOption ?? resolve(
					sourceRoot,
					"lib/dashboard/generated/operate-schema-token-codec.mjs",
				)),
				expected: generateSchemaTokenCodecData(generationPlan.tokens),
				driftCode: "E_DASHBOARD_SCHEMA_CODEC_DRIFT",
				label: "dashboard schema token codec",
			}]
			: []),
	];

	for (const target of targets) {
		if (argv.includes("--check")) {
			let current = "";
			try {
				current = readFileSync(target.path, "utf8");
			} catch {
				// Report the same deterministic drift error for a missing output.
			}
			if (current !== target.expected) {
				process.stderr.write(
					`${target.driftCode}: generated ${target.label} is stale\n`,
				);
				process.exitCode = 1;
			} else {
				process.stdout.write(
					`${target.label[0].toUpperCase()}${target.label.slice(1)} is current.\n`,
				);
			}
		} else {
			writeFileSync(target.path, target.expected, "utf8");
			process.stdout.write(`Generated ${target.path}.\n`);
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runCli(process.argv);
}
