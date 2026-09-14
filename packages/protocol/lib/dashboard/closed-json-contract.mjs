import { sha256Hex } from "../../src/canonical-json.mjs";

export const hasOwn = (value, key) => Object.hasOwn(value, key);

export function deepFreeze(value, seen = new Set()) {
	if (value === null || typeof value !== "object" || seen.has(value))
		return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreeze(child, seen);
	return Object.freeze(value);
}

export function safeDataClone(value) {
	// Validate the original object graph before cloning. structuredClone drops
	// symbol and non-enumerable properties, so cloning first would allow hidden
	// fields to be laundered out of an otherwise closed contract.
	serializeJcs(value);
	return structuredClone(value);
}

function assertUnicodeScalarString(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				throw new TypeError("JCS requires Unicode scalar strings.");
			}
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			throw new TypeError("JCS requires Unicode scalar strings.");
		}
	}
}

function serialize(value, seen) {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") {
		assertUnicodeScalarString(value);
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new TypeError("JCS requires finite numbers.");
		return JSON.stringify(value);
	}
	if (typeof value !== "object") throw new TypeError("JCS requires JSON data.");
	if (seen.has(value)) throw new TypeError("JCS cannot canonicalize a cycle.");
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const ownKeys = Reflect.ownKeys(value);
			if (
				ownKeys.some((key) => {
					if (key === "length") return false;
					if (typeof key !== "string") return true;
					const index = Number(key);
					return (
						!Number.isSafeInteger(index) ||
						index < 0 ||
						index >= value.length ||
						String(index) !== key
					);
				})
			) {
				throw new TypeError("JCS requires plain JSON arrays.");
			}
			const entries = [];
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					String(index),
				);
				if (
					!descriptor ||
					!descriptor.enumerable ||
					descriptor.get ||
					descriptor.set
				) {
					throw new TypeError("JCS cannot canonicalize a sparse array.");
				}
				entries.push(serialize(descriptor.value, seen));
			}
			return `[${entries.join(",")}]`;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError("JCS requires plain JSON objects.");
		}
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (
			Reflect.ownKeys(value).some((key) => {
				if (typeof key !== "string") return true;
				const descriptor = descriptors[key];
				return (
					!descriptor?.enumerable ||
					typeof descriptor.get === "function" ||
					typeof descriptor.set === "function"
				);
			})
		) {
			throw new TypeError("JCS requires enumerable data properties only.");
		}
		const entries = Object.keys(descriptors)
			.sort()
			.map((key) => {
				assertUnicodeScalarString(key);
				return `${JSON.stringify(key)}:${serialize(descriptors[key].value, seen)}`;
			});
		return `{${entries.join(",")}}`;
	} finally {
		seen.delete(value);
	}
}

export function serializeJcs(value) {
	return serialize(value, new Set());
}

export function contentHash(value, domain) {
	return `sha256:${sha256Hex(`${domain}\u0000${serializeJcs(value)}`)}`;
}

export function jcsHash(value) {
	return `sha256:${sha256Hex(serializeJcs(value))}`;
}

export function withoutContentHash(value) {
	const clone = safeDataClone(value);
	delete clone.integrity.contentHash;
	return clone;
}

export function exactJson(left, right) {
	return serializeJcs(left) === serializeJcs(right);
}

export function exactEventHead(left, right) {
	return left?.sequence === right?.sequence && left?.hash === right?.hash;
}
