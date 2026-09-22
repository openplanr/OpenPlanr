(() => {
  // ../protocol/src/canonical-json.mjs
  var hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function assertUnicodeScalarString(value, path) {
    for (let index2 = 0; index2 < value.length; index2 += 1) {
      const code = value.charCodeAt(index2);
      if (code >= 55296 && code <= 56319) {
        const next = value.charCodeAt(index2 + 1);
        if (!(next >= 56320 && next <= 57343)) {
          throw new TypeError(`JCS cannot canonicalize a lone high surrogate at ${path}.`);
        }
        index2 += 1;
      } else if (code >= 56320 && code <= 57343) {
        throw new TypeError(`JCS cannot canonicalize a lone low surrogate at ${path}.`);
      }
    }
  }
  function serialize(value, path, seen) {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") {
      assertUnicodeScalarString(value, path);
      return JSON.stringify(value);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError(`JCS requires a finite number at ${path}.`);
      return JSON.stringify(value);
    }
    if (typeof value !== "object") throw new TypeError(`JCS cannot canonicalize ${typeof value} at ${path}.`);
    if (seen.has(value)) throw new TypeError(`JCS cannot canonicalize a cycle at ${path}.`);
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const entries3 = [];
        for (let index2 = 0; index2 < value.length; index2 += 1) {
          if (!hasOwn(value, index2)) throw new TypeError(`JCS cannot canonicalize a sparse array at ${path}[${index2}].`);
          entries3.push(serialize(value[index2], `${path}[${index2}]`, seen));
        }
        return `[${entries3.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`JCS requires a plain JSON object at ${path}.`);
      }
      const entries2 = Object.keys(value).sort().map((key) => {
        assertUnicodeScalarString(key, `${path} key`);
        return `${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`, seen)}`;
      });
      return `{${entries2.join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }
  function canonicalizeJson(value) {
    return serialize(value, "$", /* @__PURE__ */ new Set());
  }
  var SHA256_K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var rotr = (value, bits) => value >>> bits | value << 32 - bits;
  function sha256Hex(value) {
    const candidate = typeof value === "string" ? new TextEncoder().encode(value) : value;
    if (!ArrayBuffer.isView(candidate) || Object.prototype.toString.call(candidate) !== "[object Uint8Array]") {
      throw new TypeError("sha256Hex expects a string or Uint8Array.");
    }
    const input = new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength);
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(input);
    bytes[input.length] = 128;
    const view = new DataView(bytes.buffer);
    const bitLength = BigInt(input.length) * 8n;
    view.setUint32(paddedLength - 8, Number(bitLength >> 32n & 0xffffffffn));
    view.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn));
    let h0 = 1779033703;
    let h1 = 3144134277;
    let h2 = 1013904242;
    let h3 = 2773480762;
    let h4 = 1359893119;
    let h5 = 2600822924;
    let h6 = 528734635;
    let h7 = 1541459225;
    const words = new Uint32Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index2 = 0; index2 < 16; index2 += 1) words[index2] = view.getUint32(offset + index2 * 4);
      for (let index2 = 16; index2 < 64; index2 += 1) {
        const s0 = rotr(words[index2 - 15], 7) ^ rotr(words[index2 - 15], 18) ^ words[index2 - 15] >>> 3;
        const s1 = rotr(words[index2 - 2], 17) ^ rotr(words[index2 - 2], 19) ^ words[index2 - 2] >>> 10;
        words[index2] = words[index2 - 16] + s0 + words[index2 - 7] + s1 >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let index2 = 0; index2 < 64; index2 += 1) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const choice = e & f ^ ~e & g;
        const temp1 = h + s1 + choice + SHA256_K[index2] + words[index2] >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const majority = a & b ^ a & c ^ b & c;
        const temp2 = s0 + majority >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + temp1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2 >>> 0;
      }
      h0 = h0 + a >>> 0;
      h1 = h1 + b >>> 0;
      h2 = h2 + c >>> 0;
      h3 = h3 + d >>> 0;
      h4 = h4 + e >>> 0;
      h5 = h5 + f >>> 0;
      h6 = h6 + g >>> 0;
      h7 = h7 + h >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => part.toString(16).padStart(8, "0")).join("");
  }
  function sha256Jcs(value) {
    return `sha256:${sha256Hex(canonicalizeJson(value))}`;
  }

  // ../protocol/src/json-schema.mjs
  var typeOf = (v) => {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (Number.isInteger(v)) return "integer";
    if (typeof v === "number") return "number";
    return typeof v;
  };
  var matchesType = (v, t) => {
    if (t === "integer") return Number.isInteger(v);
    if (t === "number") return typeof v === "number";
    if (t === "string") return typeof v === "string";
    if (t === "boolean") return typeof v === "boolean";
    if (t === "null") return v === null;
    if (t === "array") return Array.isArray(v);
    if (t === "object") return v !== null && typeof v === "object" && !Array.isArray(v);
    return false;
  };
  var FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
  var FORMAT_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  function resolveJsonPointer(root, reference) {
    if (reference === "#") return root;
    if (!reference.startsWith("#/")) return null;
    return reference.slice(2).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~")).reduce((value, part) => value?.[part], root);
  }
  var validateNode = (value, schema2, path, errs, context) => {
    if (schema2 === true) return;
    if (schema2 === false) {
      errs.push({ path, rule: "schema:false", detail: "value not allowed" });
      return;
    }
    if (typeof schema2?.$ref === "string") {
      const reference = schema2.$ref;
      let resolved;
      let nextRoot = context.rootSchema;
      let resolvedBase = context.base;
      if (reference.startsWith("#")) {
        resolved = resolveJsonPointer(context.rootSchema, reference);
      } else if (typeof context.resolveRef === "function") {
        const result = context.resolveRef(reference, { base: context.base });
        resolved = result?.schema ?? result;
        nextRoot = result?.rootSchema ?? resolved;
        resolvedBase = result?.base ?? resolved?.$id ?? context.base;
      }
      if (!resolved) {
        errs.push({ path, rule: "$ref", detail: `could not resolve schema reference ${reference}` });
        return;
      }
      const referenceKey = `${context.base ?? "<root>"}:${reference}`;
      if (context.referenceStack.includes(referenceKey)) {
        errs.push({ path, rule: "$ref", detail: `circular schema reference ${reference}` });
        return;
      }
      validateNode(value, resolved, path, errs, {
        ...context,
        rootSchema: nextRoot,
        base: resolvedBase,
        referenceStack: [...context.referenceStack, referenceKey]
      });
    }
    if (schema2.type !== void 0) {
      const types = Array.isArray(schema2.type) ? schema2.type : [schema2.type];
      if (!types.some((t) => matchesType(value, t))) {
        errs.push({ path, rule: "type", detail: `expected ${types.join("|")}, got ${typeOf(value)}` });
        return;
      }
    }
    if (schema2.const !== void 0) {
      if (value !== schema2.const) {
        errs.push({ path, rule: "const", detail: `expected ${JSON.stringify(schema2.const)}, got ${JSON.stringify(value)}` });
      }
    }
    if (Array.isArray(schema2.enum)) {
      if (!schema2.enum.includes(value)) {
        errs.push({
          path,
          rule: "enum",
          detail: `value ${JSON.stringify(value)} not in enum [${schema2.enum.map((x) => JSON.stringify(x)).join(", ")}]`
        });
      }
    }
    if (typeof value === "string") {
      if (typeof schema2.minLength === "number" && value.length < schema2.minLength) {
        errs.push({ path, rule: "minLength", detail: `length ${value.length} < ${schema2.minLength}` });
      }
      if (typeof schema2.maxLength === "number" && value.length > schema2.maxLength) {
        errs.push({ path, rule: "maxLength", detail: `length ${value.length} > ${schema2.maxLength}` });
      }
      if (typeof schema2.pattern === "string") {
        try {
          if (!new RegExp(schema2.pattern).test(value)) {
            errs.push({ path, rule: "pattern", detail: `value ${JSON.stringify(value)} does not match /${schema2.pattern}/` });
          }
        } catch (e) {
          errs.push({ path, rule: "pattern", detail: `invalid regex /${schema2.pattern}/: ${e.message}` });
        }
      }
      if (typeof schema2.format === "string") {
        if (schema2.format === "date" && !FORMAT_DATE.test(value)) {
          errs.push({ path, rule: "format:date", detail: `value ${JSON.stringify(value)} is not YYYY-MM-DD` });
        } else if (schema2.format === "date-time" && !FORMAT_DATETIME.test(value)) {
          errs.push({ path, rule: "format:date-time", detail: `value ${JSON.stringify(value)} is not ISO 8601 date-time` });
        }
      }
    }
    if (typeof value === "number") {
      if (typeof schema2.minimum === "number" && value < schema2.minimum) {
        errs.push({ path, rule: "minimum", detail: `value ${value} < ${schema2.minimum}` });
      }
      if (typeof schema2.maximum === "number" && value > schema2.maximum) {
        errs.push({ path, rule: "maximum", detail: `value ${value} > ${schema2.maximum}` });
      }
    }
    if (Array.isArray(value)) {
      if (typeof schema2.minItems === "number" && value.length < schema2.minItems) {
        errs.push({ path, rule: "minItems", detail: `length ${value.length} < ${schema2.minItems}` });
      }
      if (typeof schema2.maxItems === "number" && value.length > schema2.maxItems) {
        errs.push({ path, rule: "maxItems", detail: `length ${value.length} > ${schema2.maxItems}` });
      }
      const prefixLength = Array.isArray(schema2.prefixItems) ? schema2.prefixItems.length : 0;
      if (prefixLength > 0) {
        for (let i = 0; i < Math.min(value.length, prefixLength); i++) {
          validateNode(value[i], schema2.prefixItems[i], `${path}[${i}]`, errs, context);
        }
      }
      if (schema2.items !== void 0) {
        for (let i = prefixLength; i < value.length; i++) {
          validateNode(value[i], schema2.items, `${path}[${i}]`, errs, context);
        }
      }
      if (schema2.uniqueItems === true) {
        const seen = /* @__PURE__ */ new Set();
        for (const item of value) {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            errs.push({ path, rule: "uniqueItems", detail: `duplicate item ${key}` });
            break;
          }
          seen.add(key);
        }
      }
      if (schema2.contains !== void 0) {
        let matches = 0;
        for (let index2 = 0; index2 < value.length; index2 += 1) {
          const containedErrors = [];
          validateNode(value[index2], schema2.contains, `${path}[${index2}]`, containedErrors, context);
          if (containedErrors.length === 0) matches += 1;
        }
        const minimum = Number.isSafeInteger(schema2.minContains) ? schema2.minContains : 1;
        const maximum = Number.isSafeInteger(schema2.maxContains) ? schema2.maxContains : null;
        if (matches < minimum) {
          errs.push({ path, rule: "contains", detail: `matched ${matches} contained items; expected at least ${minimum}` });
        }
        if (maximum !== null && matches > maximum) {
          errs.push({ path, rule: "contains", detail: `matched ${matches} contained items; expected at most ${maximum}` });
        }
      }
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (Array.isArray(schema2.required)) {
        for (const req of schema2.required) {
          if (!Object.hasOwn(value, req)) {
            errs.push({ path, rule: "required", detail: `missing required property '${req}'` });
          }
        }
      }
      const props = schema2.properties || {};
      for (const [k, v] of Object.entries(value)) {
        if (!Object.hasOwn(props, k)) {
          if (schema2.additionalProperties === false) {
            errs.push({ path, rule: "additionalProperties", detail: `unknown property '${k}'` });
          } else if (schema2.additionalProperties === true || schema2.additionalProperties !== null && typeof schema2.additionalProperties === "object") {
            validateNode(v, schema2.additionalProperties, `${path}.${k}`, errs, context);
          }
        }
      }
      for (const [k, v] of Object.entries(value)) {
        if (Object.hasOwn(props, k)) validateNode(v, props[k], `${path}.${k}`, errs, context);
      }
    }
    if (Array.isArray(schema2.oneOf)) {
      let matched = 0;
      for (const sub of schema2.oneOf) {
        const e = [];
        validateNode(value, sub, path, e, context);
        if (e.length === 0) matched++;
      }
      if (matched !== 1) {
        const titles = schema2.oneOf.map((s) => s.title || "(unnamed)").join(" | ");
        errs.push({
          path,
          rule: "oneOf",
          detail: `matched ${matched}/${schema2.oneOf.length} branches (expected exactly 1). Branches: ${titles}`
        });
      }
    }
    if (Array.isArray(schema2.anyOf)) {
      let matched = 0;
      for (const sub of schema2.anyOf) {
        const candidateErrors = [];
        validateNode(value, sub, path, candidateErrors, context);
        if (candidateErrors.length === 0) matched += 1;
      }
      if (matched === 0) {
        const titles = schema2.anyOf.map((sub) => sub.title || "(unnamed)").join(" | ");
        errs.push({
          path,
          rule: "anyOf",
          detail: `matched 0/${schema2.anyOf.length} branches (expected at least 1). Branches: ${titles}`
        });
      }
    }
    if (Array.isArray(schema2.allOf)) {
      for (const sub of schema2.allOf) {
        validateNode(value, sub, path, errs, context);
      }
    }
    if (schema2.if !== void 0) {
      const conditionErrors = [];
      validateNode(value, schema2.if, path, conditionErrors, context);
      const branch = conditionErrors.length === 0 ? schema2.then : schema2.else;
      if (branch !== void 0) validateNode(value, branch, path, errs, context);
    }
    if (schema2.not !== void 0) {
      const e = [];
      validateNode(value, schema2.not, path, e, context);
      if (e.length === 0) {
        errs.push({ path, rule: "not", detail: "value matched a forbidden subschema" });
      }
    }
  };
  var validateJson = (value, schema2, {
    resolveRef = null,
    base = schema2?.$id ?? null
  } = {}) => {
    const errs = [];
    validateNode(value, schema2, "$", errs, {
      rootSchema: schema2,
      resolveRef,
      base,
      referenceStack: []
    });
    return errs;
  };

  // ../protocol/src/generated/diagram-registries.mjs
  var deepFreeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const nested of Object.values(value)) deepFreeze(nested);
      Object.freeze(value);
    }
    return value;
  };
  var DIAGRAM_REGISTRIES = deepFreeze({
    "diagram-grammars.json": {
      "kind": "diagram-type-registry",
      "schemaVersion": "1.0.0",
      "protocolVersion": "1.6.0",
      "documentVersion": "1.0.0",
      "digestAlgorithm": "sha256",
      "canonicalization": "rfc8785",
      "registryVersion": "1.0.0",
      "primitives": [
        "node",
        "relation",
        "group",
        "lane",
        "event",
        "series",
        "axis",
        "set",
        "annotation",
        "emphasis"
      ],
      "layoutFamilies": [
        "cause-effect",
        "chart",
        "chronology",
        "containment",
        "entity",
        "graph",
        "hierarchy",
        "lanes",
        "sankey",
        "wardley"
      ],
      "grammars": [
        {
          "grammarId": "architecture",
          "grammarVersion": "1.0.0",
          "title": "Architecture",
          "summary": "Architecture semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "system architecture",
            "software architecture",
            "components"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/architecture.planr-diagram.json",
          "reference": "references/diagram/architecture.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Architecture diagram",
            "description": "Diagram content for the architecture grammar in semantic reading order."
          }
        },
        {
          "grammarId": "it-current-state",
          "grammarVersion": "1.0.0",
          "title": "IT current state",
          "summary": "IT current state semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "legacy landscape",
            "current state",
            "modernization"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/it-current-state.planr-diagram.json",
          "reference": "references/diagram/it-current-state.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "IT current state diagram",
            "description": "Diagram content for the it current state grammar in semantic reading order."
          }
        },
        {
          "grammarId": "flowchart",
          "grammarVersion": "1.0.0",
          "title": "Flowchart",
          "summary": "Flowchart semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "decision flow",
            "workflow",
            "process flow"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/flowchart.planr-diagram.json",
          "reference": "references/diagram/flowchart.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Flowchart diagram",
            "description": "Diagram content for the flowchart grammar in semantic reading order."
          }
        },
        {
          "grammarId": "sequence",
          "grammarVersion": "1.0.0",
          "title": "Sequence",
          "summary": "Sequence semantic grammar using the chronology layout family.",
          "layoutFamily": "chronology",
          "aliases": [
            "message sequence",
            "interaction sequence",
            "request trace"
          ],
          "requiredPrimitives": [
            "node",
            "relation",
            "event"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/sequence.planr-diagram.json",
          "reference": "references/diagram/sequence.md",
          "rendererContract": {
            "layoutFamily": "chronology",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Sequence diagram",
            "description": "Diagram content for the sequence grammar in semantic reading order."
          }
        },
        {
          "grammarId": "state-machine",
          "grammarVersion": "1.0.0",
          "title": "State machine",
          "summary": "State machine semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "state diagram",
            "lifecycle states",
            "transitions"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/state-machine.planr-diagram.json",
          "reference": "references/diagram/state-machine.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "State machine diagram",
            "description": "Diagram content for the state machine grammar in semantic reading order."
          }
        },
        {
          "grammarId": "er-data-model",
          "grammarVersion": "1.0.0",
          "title": "ER data model",
          "summary": "ER data model semantic grammar using the entity layout family.",
          "layoutFamily": "entity",
          "aliases": [
            "entity relationship",
            "logical data model",
            "er diagram"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/er-data-model.planr-diagram.json",
          "reference": "references/diagram/er-data-model.md",
          "rendererContract": {
            "layoutFamily": "entity",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "ER data model diagram",
            "description": "Diagram content for the er data model grammar in semantic reading order."
          }
        },
        {
          "grammarId": "timeline",
          "grammarVersion": "1.0.0",
          "title": "Timeline",
          "summary": "Timeline semantic grammar using the chronology layout family.",
          "layoutFamily": "chronology",
          "aliases": [
            "milestones",
            "history",
            "roadmap"
          ],
          "requiredPrimitives": [
            "event"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/timeline.planr-diagram.json",
          "reference": "references/diagram/timeline.md",
          "rendererContract": {
            "layoutFamily": "chronology",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Timeline diagram",
            "description": "Diagram content for the timeline grammar in semantic reading order."
          }
        },
        {
          "grammarId": "swimlane",
          "grammarVersion": "1.0.0",
          "title": "Swimlane",
          "summary": "Swimlane semantic grammar using the lanes layout family.",
          "layoutFamily": "lanes",
          "aliases": [
            "cross functional",
            "handoff flow",
            "responsibility lanes"
          ],
          "requiredPrimitives": [
            "node",
            "lane"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "lane",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/swimlane.planr-diagram.json",
          "reference": "references/diagram/swimlane.md",
          "rendererContract": {
            "layoutFamily": "lanes",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Swimlane diagram",
            "description": "Diagram content for the swimlane grammar in semantic reading order."
          }
        },
        {
          "grammarId": "quadrant",
          "grammarVersion": "1.0.0",
          "title": "Quadrant",
          "summary": "Quadrant semantic grammar using the chart layout family.",
          "layoutFamily": "chart",
          "aliases": [
            "two axis matrix",
            "impact effort",
            "four quadrants"
          ],
          "requiredPrimitives": [
            "node",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "series",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/quadrant.planr-diagram.json",
          "reference": "references/diagram/quadrant.md",
          "rendererContract": {
            "layoutFamily": "chart",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Quadrant diagram",
            "description": "Diagram content for the quadrant grammar in semantic reading order."
          }
        },
        {
          "grammarId": "radar",
          "grammarVersion": "1.0.0",
          "title": "Radar chart",
          "summary": "Radar chart semantic grammar using the chart layout family.",
          "layoutFamily": "chart",
          "aliases": [
            "spider chart",
            "multi axis comparison"
          ],
          "requiredPrimitives": [
            "series",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "series",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/radar.planr-diagram.json",
          "reference": "references/diagram/radar.md",
          "rendererContract": {
            "layoutFamily": "chart",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Radar chart diagram",
            "description": "Diagram content for the radar chart grammar in semantic reading order."
          }
        },
        {
          "grammarId": "polar",
          "grammarVersion": "1.0.0",
          "title": "Polar chart",
          "summary": "Polar chart semantic grammar using the chart layout family.",
          "layoutFamily": "chart",
          "aliases": [
            "polar area",
            "cyclic magnitude"
          ],
          "requiredPrimitives": [
            "series",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "series",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/polar.planr-diagram.json",
          "reference": "references/diagram/polar.md",
          "rendererContract": {
            "layoutFamily": "chart",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Polar chart diagram",
            "description": "Diagram content for the polar chart grammar in semantic reading order."
          }
        },
        {
          "grammarId": "loop-flywheel",
          "grammarVersion": "1.0.0",
          "title": "Loop and flywheel",
          "summary": "Loop and flywheel semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "flywheel",
            "reinforcing loop",
            "feedback loop"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/loop-flywheel.planr-diagram.json",
          "reference": "references/diagram/loop-flywheel.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Loop and flywheel diagram",
            "description": "Diagram content for the loop and flywheel grammar in semantic reading order."
          }
        },
        {
          "grammarId": "nested",
          "grammarVersion": "1.0.0",
          "title": "Nested containment",
          "summary": "Nested containment semantic grammar using the containment layout family.",
          "layoutFamily": "containment",
          "aliases": [
            "nested boxes",
            "containment map"
          ],
          "requiredPrimitives": [
            "node",
            "group"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "set",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/nested.planr-diagram.json",
          "reference": "references/diagram/nested.md",
          "rendererContract": {
            "layoutFamily": "containment",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Nested containment diagram",
            "description": "Diagram content for the nested containment grammar in semantic reading order."
          }
        },
        {
          "grammarId": "tree",
          "grammarVersion": "1.0.0",
          "title": "Tree",
          "summary": "Tree semantic grammar using the hierarchy layout family.",
          "layoutFamily": "hierarchy",
          "aliases": [
            "hierarchy tree",
            "parent child"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/tree.planr-diagram.json",
          "reference": "references/diagram/tree.md",
          "rendererContract": {
            "layoutFamily": "hierarchy",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Tree diagram",
            "description": "Diagram content for the tree grammar in semantic reading order."
          }
        },
        {
          "grammarId": "org-chart",
          "grammarVersion": "1.0.0",
          "title": "Organization chart",
          "summary": "Organization chart semantic grammar using the hierarchy layout family.",
          "layoutFamily": "hierarchy",
          "aliases": [
            "org chart",
            "reporting lines",
            "team structure"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/org-chart.planr-diagram.json",
          "reference": "references/diagram/org-chart.md",
          "rendererContract": {
            "layoutFamily": "hierarchy",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Organization chart diagram",
            "description": "Diagram content for the organization chart grammar in semantic reading order."
          }
        },
        {
          "grammarId": "layer-stack",
          "grammarVersion": "1.0.0",
          "title": "Layer stack",
          "summary": "Layer stack semantic grammar using the hierarchy layout family.",
          "layoutFamily": "hierarchy",
          "aliases": [
            "layered architecture",
            "stacked abstractions"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/layer-stack.planr-diagram.json",
          "reference": "references/diagram/layer-stack.md",
          "rendererContract": {
            "layoutFamily": "hierarchy",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Layer stack diagram",
            "description": "Diagram content for the layer stack grammar in semantic reading order."
          }
        },
        {
          "grammarId": "venn",
          "grammarVersion": "1.0.0",
          "title": "Venn",
          "summary": "Venn semantic grammar using the containment layout family.",
          "layoutFamily": "containment",
          "aliases": [
            "set overlap",
            "venn diagram"
          ],
          "requiredPrimitives": [
            "set"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "set",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/venn.planr-diagram.json",
          "reference": "references/diagram/venn.md",
          "rendererContract": {
            "layoutFamily": "containment",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Venn diagram",
            "description": "Diagram content for the venn grammar in semantic reading order."
          }
        },
        {
          "grammarId": "pyramid-funnel",
          "grammarVersion": "1.0.0",
          "title": "Pyramid and funnel",
          "summary": "Pyramid and funnel semantic grammar using the hierarchy layout family.",
          "layoutFamily": "hierarchy",
          "aliases": [
            "pyramid",
            "funnel",
            "ranked hierarchy"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/pyramid-funnel.planr-diagram.json",
          "reference": "references/diagram/pyramid-funnel.md",
          "rendererContract": {
            "layoutFamily": "hierarchy",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Pyramid and funnel diagram",
            "description": "Diagram content for the pyramid and funnel grammar in semantic reading order."
          }
        },
        {
          "grammarId": "bar",
          "grammarVersion": "1.0.0",
          "title": "Bar chart",
          "summary": "Bar chart semantic grammar using the chart layout family.",
          "layoutFamily": "chart",
          "aliases": [
            "bar graph",
            "categorical comparison"
          ],
          "requiredPrimitives": [
            "series",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "series",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/bar.planr-diagram.json",
          "reference": "references/diagram/bar.md",
          "rendererContract": {
            "layoutFamily": "chart",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Bar chart diagram",
            "description": "Diagram content for the bar chart grammar in semantic reading order."
          }
        },
        {
          "grammarId": "treemap",
          "grammarVersion": "1.0.0",
          "title": "Treemap",
          "summary": "Treemap semantic grammar using the containment layout family.",
          "layoutFamily": "containment",
          "aliases": [
            "part of whole",
            "area hierarchy"
          ],
          "requiredPrimitives": [
            "node",
            "group"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "set",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/treemap.planr-diagram.json",
          "reference": "references/diagram/treemap.md",
          "rendererContract": {
            "layoutFamily": "containment",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Treemap diagram",
            "description": "Diagram content for the treemap grammar in semantic reading order."
          }
        },
        {
          "grammarId": "line",
          "grammarVersion": "1.0.0",
          "title": "Line chart",
          "summary": "Line chart semantic grammar using the chart layout family.",
          "layoutFamily": "chart",
          "aliases": [
            "line graph",
            "trend chart"
          ],
          "requiredPrimitives": [
            "series",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "series",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/line.planr-diagram.json",
          "reference": "references/diagram/line.md",
          "rendererContract": {
            "layoutFamily": "chart",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Line chart diagram",
            "description": "Diagram content for the line chart grammar in semantic reading order."
          }
        },
        {
          "grammarId": "gantt",
          "grammarVersion": "1.0.0",
          "title": "Gantt",
          "summary": "Gantt semantic grammar using the chronology layout family.",
          "layoutFamily": "chronology",
          "aliases": [
            "gantt chart",
            "project schedule",
            "task timeline"
          ],
          "requiredPrimitives": [
            "event"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/gantt.planr-diagram.json",
          "reference": "references/diagram/gantt.md",
          "rendererContract": {
            "layoutFamily": "chronology",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Gantt diagram",
            "description": "Diagram content for the gantt grammar in semantic reading order."
          }
        },
        {
          "grammarId": "scatter",
          "grammarVersion": "1.0.0",
          "title": "Scatter plot",
          "summary": "Scatter plot semantic grammar using the chart layout family.",
          "layoutFamily": "chart",
          "aliases": [
            "scatter chart",
            "correlation",
            "distribution plot"
          ],
          "requiredPrimitives": [
            "series",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "series",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/scatter.planr-diagram.json",
          "reference": "references/diagram/scatter.md",
          "rendererContract": {
            "layoutFamily": "chart",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Scatter plot diagram",
            "description": "Diagram content for the scatter plot grammar in semantic reading order."
          }
        },
        {
          "grammarId": "high-level",
          "grammarVersion": "1.0.0",
          "title": "High-level system view",
          "summary": "High-level system view semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "high level architecture",
            "end to end stack"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/high-level.planr-diagram.json",
          "reference": "references/diagram/high-level.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "High-level system view diagram",
            "description": "Diagram content for the high-level system view grammar in semantic reading order."
          }
        },
        {
          "grammarId": "process",
          "grammarVersion": "1.0.0",
          "title": "Process",
          "summary": "Process semantic grammar using the lanes layout family.",
          "layoutFamily": "lanes",
          "aliases": [
            "business process",
            "multi actor process"
          ],
          "requiredPrimitives": [
            "node",
            "relation",
            "lane"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "lane",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/process.planr-diagram.json",
          "reference": "references/diagram/process.md",
          "rendererContract": {
            "layoutFamily": "lanes",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Process diagram",
            "description": "Diagram content for the process grammar in semantic reading order."
          }
        },
        {
          "grammarId": "medallion",
          "grammarVersion": "1.0.0",
          "title": "Medallion",
          "summary": "Medallion semantic grammar using the hierarchy layout family.",
          "layoutFamily": "hierarchy",
          "aliases": [
            "bronze silver gold",
            "data lakehouse tiers"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/medallion.planr-diagram.json",
          "reference": "references/diagram/medallion.md",
          "rendererContract": {
            "layoutFamily": "hierarchy",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Medallion diagram",
            "description": "Diagram content for the medallion grammar in semantic reading order."
          }
        },
        {
          "grammarId": "data-flow",
          "grammarVersion": "1.0.0",
          "title": "Data flow",
          "summary": "Data flow semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "data pipeline",
            "information flow"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/data-flow.planr-diagram.json",
          "reference": "references/diagram/data-flow.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Data flow diagram",
            "description": "Diagram content for the data flow grammar in semantic reading order."
          }
        },
        {
          "grammarId": "dp-integration",
          "grammarVersion": "1.0.0",
          "title": "Data platform integration",
          "summary": "Data platform integration semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "sources core consumers",
            "integration landscape"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/dp-integration.planr-diagram.json",
          "reference": "references/diagram/dp-integration.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Data platform integration diagram",
            "description": "Diagram content for the data platform integration grammar in semantic reading order."
          }
        },
        {
          "grammarId": "dp-security-matrix",
          "grammarVersion": "1.0.0",
          "title": "Data platform security matrix",
          "summary": "Data platform security matrix semantic grammar using the lanes layout family.",
          "layoutFamily": "lanes",
          "aliases": [
            "access matrix",
            "role permissions"
          ],
          "requiredPrimitives": [
            "node",
            "lane"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "lane",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/dp-security-matrix.planr-diagram.json",
          "reference": "references/diagram/dp-security-matrix.md",
          "rendererContract": {
            "layoutFamily": "lanes",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Data platform security matrix diagram",
            "description": "Diagram content for the data platform security matrix grammar in semantic reading order."
          }
        },
        {
          "grammarId": "sankey",
          "grammarVersion": "1.0.0",
          "title": "Sankey",
          "summary": "Sankey semantic grammar using the sankey layout family.",
          "layoutFamily": "sankey",
          "aliases": [
            "flow quantities",
            "split and merge"
          ],
          "requiredPrimitives": [
            "node",
            "relation",
            "series"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "series",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 8,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/sankey.planr-diagram.json",
          "reference": "references/diagram/sankey.md",
          "rendererContract": {
            "layoutFamily": "sankey",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Sankey diagram",
            "description": "Diagram content for the sankey grammar in semantic reading order."
          }
        },
        {
          "grammarId": "fishbone",
          "grammarVersion": "1.0.0",
          "title": "Fishbone",
          "summary": "Fishbone semantic grammar using the cause-effect layout family.",
          "layoutFamily": "cause-effect",
          "aliases": [
            "ishikawa",
            "cause and effect",
            "root causes"
          ],
          "requiredPrimitives": [
            "node",
            "relation",
            "group"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/fishbone.planr-diagram.json",
          "reference": "references/diagram/fishbone.md",
          "rendererContract": {
            "layoutFamily": "cause-effect",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Fishbone diagram",
            "description": "Diagram content for the fishbone grammar in semantic reading order."
          }
        },
        {
          "grammarId": "wardley",
          "grammarVersion": "1.0.0",
          "title": "Wardley map",
          "summary": "Wardley map semantic grammar using the wardley layout family.",
          "layoutFamily": "wardley",
          "aliases": [
            "value chain evolution",
            "wardley"
          ],
          "requiredPrimitives": [
            "node",
            "relation",
            "axis"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "axis",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/wardley.planr-diagram.json",
          "reference": "references/diagram/wardley.md",
          "rendererContract": {
            "layoutFamily": "wardley",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Wardley map diagram",
            "description": "Diagram content for the wardley map grammar in semantic reading order."
          }
        },
        {
          "grammarId": "kanban",
          "grammarVersion": "1.0.0",
          "title": "Kanban",
          "summary": "Kanban semantic grammar using the lanes layout family.",
          "layoutFamily": "lanes",
          "aliases": [
            "kanban board",
            "work in progress"
          ],
          "requiredPrimitives": [
            "node",
            "lane"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "lane",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/kanban.planr-diagram.json",
          "reference": "references/diagram/kanban.md",
          "rendererContract": {
            "layoutFamily": "lanes",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Kanban diagram",
            "description": "Diagram content for the kanban grammar in semantic reading order."
          }
        },
        {
          "grammarId": "user-journey",
          "grammarVersion": "1.0.0",
          "title": "User journey",
          "summary": "User journey semantic grammar using the lanes layout family.",
          "layoutFamily": "lanes",
          "aliases": [
            "customer journey",
            "experience map"
          ],
          "requiredPrimitives": [
            "event",
            "lane"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "lane",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/user-journey.planr-diagram.json",
          "reference": "references/diagram/user-journey.md",
          "rendererContract": {
            "layoutFamily": "lanes",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "User journey diagram",
            "description": "Diagram content for the user journey grammar in semantic reading order."
          }
        },
        {
          "grammarId": "deployment",
          "grammarVersion": "1.0.0",
          "title": "Deployment",
          "summary": "Deployment semantic grammar using the containment layout family.",
          "layoutFamily": "containment",
          "aliases": [
            "deployment diagram",
            "zones hosts artifacts"
          ],
          "requiredPrimitives": [
            "node",
            "group"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "set",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "partial",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/deployment.planr-diagram.json",
          "reference": "references/diagram/deployment.md",
          "rendererContract": {
            "layoutFamily": "containment",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Deployment diagram",
            "description": "Diagram content for the deployment grammar in semantic reading order."
          }
        },
        {
          "grammarId": "dependency-graph",
          "grammarVersion": "1.0.0",
          "title": "Dependency graph",
          "summary": "Dependency graph semantic grammar using the graph layout family.",
          "layoutFamily": "graph",
          "aliases": [
            "dependencies",
            "fan in graph",
            "package graph"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 10,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/dependency-graph.planr-diagram.json",
          "reference": "references/diagram/dependency-graph.md",
          "rendererContract": {
            "layoutFamily": "graph",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Dependency graph diagram",
            "description": "Diagram content for the dependency graph grammar in semantic reading order."
          }
        },
        {
          "grammarId": "uml-class",
          "grammarVersion": "1.0.0",
          "title": "UML class",
          "summary": "UML class semantic grammar using the entity layout family.",
          "layoutFamily": "entity",
          "aliases": [
            "class diagram",
            "typed relations"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/uml-class.planr-diagram.json",
          "reference": "references/diagram/uml-class.md",
          "rendererContract": {
            "layoutFamily": "entity",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "UML class diagram",
            "description": "Diagram content for the uml class grammar in semantic reading order."
          }
        },
        {
          "grammarId": "story-map",
          "grammarVersion": "1.0.0",
          "title": "Story map",
          "summary": "Story map semantic grammar using the lanes layout family.",
          "layoutFamily": "lanes",
          "aliases": [
            "user story map",
            "release slices"
          ],
          "requiredPrimitives": [
            "node",
            "lane"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "lane",
            "event",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "unsupported",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/story-map.planr-diagram.json",
          "reference": "references/diagram/story-map.md",
          "rendererContract": {
            "layoutFamily": "lanes",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Story map diagram",
            "description": "Diagram content for the story map grammar in semantic reading order."
          }
        },
        {
          "grammarId": "database-schema",
          "grammarVersion": "1.0.0",
          "title": "Database schema",
          "summary": "Database schema semantic grammar using the entity layout family.",
          "layoutFamily": "entity",
          "aliases": [
            "physical schema",
            "database tables",
            "foreign keys"
          ],
          "requiredPrimitives": [
            "node"
          ],
          "allowedPrimitives": [
            "node",
            "relation",
            "group",
            "annotation",
            "emphasis"
          ],
          "directions": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ],
          "detailLimits": {
            "simplified": 7,
            "balanced": 12,
            "faithful": 24,
            "hard": 24
          },
          "readability": {
            "maxLabelCharacters": 80,
            "maxCrossings": 12,
            "maxFanIn": 6,
            "minTextSize": 12,
            "aspectRatios": [
              "fit",
              "doc-wide",
              "slide-16x9"
            ]
          },
          "projections": {
            "mermaid": "editable",
            "excalidraw": "editable"
          },
          "fixture": "fixtures/diagram/grammars/database-schema.planr-diagram.json",
          "reference": "references/diagram/database-schema.md",
          "rendererContract": {
            "layoutFamily": "entity",
            "contractVersion": "1.0.0",
            "staticByDefault": true
          },
          "accessibilityTemplate": {
            "title": "Database schema diagram",
            "description": "Diagram content for the database schema grammar in semantic reading order."
          }
        }
      ],
      "documentDigest": "sha256:f78d668b7cf01ba9c0dacbe64b6e7a1b19c6dc7e5855c9861594beb3d6984653"
    },
    "diagram-semantic-patterns.json": {
      "kind": "diagram-semantic-pattern-registry",
      "schemaVersion": "1.0.0",
      "protocolVersion": "1.6.0",
      "documentVersion": "1.0.0",
      "digestAlgorithm": "sha256",
      "canonicalization": "rfc8785",
      "patterns": [
        {
          "patternId": "fan-in-bottleneck",
          "patternVersion": "1.0.0",
          "triggers": [
            "queue",
            "bottleneck",
            "fan in"
          ],
          "candidateGrammars": [
            "dependency-graph",
            "sankey",
            "data-flow"
          ],
          "selection": "rank-only"
        },
        {
          "patternId": "repeated-stages",
          "patternVersion": "1.0.0",
          "triggers": [
            "stages",
            "pipeline slots",
            "repeat"
          ],
          "candidateGrammars": [
            "process",
            "swimlane",
            "data-flow"
          ],
          "selection": "rank-only"
        },
        {
          "patternId": "unstructured-transformation",
          "patternVersion": "1.0.0",
          "triggers": [
            "unstructured input",
            "transform",
            "normalize"
          ],
          "candidateGrammars": [
            "data-flow",
            "dp-integration"
          ],
          "selection": "rank-only"
        },
        {
          "patternId": "paired-policy-trace",
          "patternVersion": "1.0.0",
          "triggers": [
            "policy trace",
            "allow deny",
            "decision path"
          ],
          "candidateGrammars": [
            "sequence",
            "flowchart"
          ],
          "selection": "rank-only"
        },
        {
          "patternId": "secure-paved-road",
          "patternVersion": "1.0.0",
          "triggers": [
            "secure path",
            "paved road",
            "guardrails"
          ],
          "candidateGrammars": [
            "architecture",
            "deployment"
          ],
          "selection": "rank-only"
        },
        {
          "patternId": "governance-catalog",
          "patternVersion": "1.0.0",
          "triggers": [
            "catalog",
            "governance",
            "ownership"
          ],
          "candidateGrammars": [
            "tree",
            "org-chart",
            "layer-stack"
          ],
          "selection": "rank-only"
        },
        {
          "patternId": "compensating-layers",
          "patternVersion": "1.0.0",
          "triggers": [
            "defense in depth",
            "compensating controls"
          ],
          "candidateGrammars": [
            "layer-stack",
            "dp-security-matrix"
          ],
          "selection": "rank-only"
        }
      ],
      "documentDigest": "sha256:36a925bd1be54ef9a80ccd44039c9390dd7c4cc00185dbc03ba01be8997e222f"
    }
  });

  // ../protocol/src/diagram-authoring-contracts.mjs
  var deepFreeze2 = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze2);
      Object.freeze(value);
    }
    return value;
  };
  var DIAGRAM_EDIT_OPERATION_CLASSES = deepFreeze2([
    "insert-elements",
    "update-semantics",
    "remove-elements",
    "set-membership-order",
    "set-geometry",
    "set-appearance-locks"
  ]);
  var DIAGRAM_AUTHORING_LIMITS = deepFreeze2({
    depth: 48,
    values: 5e5,
    textCodeUnits: 8388608,
    sourceBytes: 1048576,
    elements: 1e4,
    operations: 256,
    coordinate: 1e6
  });
  var closed = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
  var arr = (items, maxItems, minItems = 0, uniqueItems = false) => ({ type: "array", items, minItems, maxItems, ...uniqueItems ? { uniqueItems } : {} });
  var nullable = (schema2) => ({ anyOf: [{ type: "null" }, schema2] });
  var str = (maxLength = 4096, minLength = 0) => ({ type: "string", minLength, maxLength });
  var enumOf = (...values) => ({ enum: values });
  var id = { type: "string", pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$", minLength: 1, maxLength: 128 };
  var digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
  var token = { type: "string", pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$", maxLength: 64 };
  var relativePath = { type: "string", minLength: 1, maxLength: 1024, pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$" };
  var coordinate = { type: "number", minimum: -1e6, maximum: 1e6 };
  var positiveSize = { type: "number", minimum: 0.01, maximum: 1e6 };
  var index = { type: "integer", minimum: 0, maximum: 1e4 };
  var ids = arr(id, 1e4, 0, true);
  var semanticKinds = ["process", "start", "end", "decision", "data-store", "component"];
  var relationKinds = ["association", "dependency", "flow", "message", "transition"];
  var node = closed({ id, label: str(), kind: enumOf(...semanticKinds), description: nullable(str()) });
  var relation = closed({ id, from: id, to: id, kind: enumOf(...relationKinds), direction: enumOf("forward", "both", "none"), label: nullable(str()), weight: nullable({ type: "number", minimum: 0, maximum: 1e6 }) });
  var container = closed({ id, label: str(), members: ids });
  var annotation = closed({ id, text: str(), targetId: nullable(id) });
  var emphasis = closed({ targetId: id, level: enumOf("primary", "secondary", "muted") });
  var semanticCollections = {
    nodes: arr(node, 4096),
    relations: arr(relation, 8192),
    groups: arr(container, 1024),
    lanes: arr(container, 256),
    events: arr(false, 0),
    series: arr(false, 0),
    axes: arr(false, 0),
    sets: arr(false, 0),
    annotations: arr(annotation, 1024),
    emphasis: arr(emphasis, 1024)
  };
  var bounds = closed({ x: coordinate, y: coordinate, width: positiveSize, height: positiveSize });
  var point = closed({ x: coordinate, y: coordinate });
  var attachment = closed({ side: enumOf("top", "right", "bottom", "left"), offset: { type: "number", minimum: 0, maximum: 1 } });
  var route = closed({ mode: enumOf("automatic", "manual"), strategy: enumOf("straight", "orthogonal"), from: attachment, to: attachment, points: arr(point, 256) });
  var labelPlacement = closed({ x: coordinate, y: coordinate, width: positiveSize });
  var appearance = closed({
    shape: enumOf("rectangle", "rounded-rectangle", "ellipse", "diamond", "cylinder", "text", "container", "connector"),
    fill: enumOf("surface", "accent", "success", "warning", "danger", "transparent"),
    stroke: enumOf("default", "accent", "muted", "danger", "none"),
    strokeWidth: { type: "number", minimum: 0, maximum: 16 },
    strokeStyle: enumOf("solid", "dashed", "dotted"),
    fontSize: { type: "integer", minimum: 8, maximum: 72 },
    textAlign: enumOf("left", "center", "right")
  });
  var locks = closed({ position: { type: "boolean" }, size: { type: "boolean" }, route: { type: "boolean" } });
  var placement = closed({ elementId: id, bounds: nullable(bounds), route: nullable(route), label: nullable(labelPlacement), zIndex: index, appearance, locks });
  var snapshot = closed({ bundleDigest: digest, semanticDigest: digest, presentationDigest: digest });
  var schema = (name, kind, properties) => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://openplanr.dev/schemas/v1.13.0/${name}.schema.json`,
    "x-openplanr-contract": { id: name, version: "1.13.0" },
    ...closed({ kind: { const: kind }, schemaVersion: { const: "1.0.0" }, protocolVersion: { const: "1.13.0" }, ...properties })
  });
  var documentSchema = schema("diagram-document", "planr-diagram", {
    diagramId: id,
    title: str(),
    summary: str(),
    audience: enumOf("engineer", "executive", "mixed"),
    grammar: closed({ id: enumOf("flowchart", "process", "swimlane", "architecture"), version: { const: "1.0.0" } }),
    ...semanticCollections,
    laneOrder: ids,
    accessibility: closed({ title: str(), description: str(), readingOrder: ids }),
    documentDigest: digest
  });
  var presentationSchema = schema("diagram-presentation", "diagram-presentation", {
    diagramId: id,
    semanticDigest: digest,
    coordinateSystem: { const: "global-canvas" },
    layout: closed({ direction: enumOf("top-down", "left-right", "right-left", "bottom-up"), detailTier: enumOf("simplified", "balanced", "faithful") }),
    theme: closed({ themeId: enumOf("paper", "slate", "midnight"), mode: enumOf("light", "dark", "auto") }),
    elements: arr(placement, 1e4),
    presentationDigest: digest
  });
  var range = closed({ startByte: { type: "integer", minimum: 0, maximum: 1048576 }, endByte: { type: "integer", minimum: 0, maximum: 1048576 } });
  var sourceMapSchema = schema("diagram-source-map", "diagram-source-map", {
    diagramId: id,
    semanticDigest: digest,
    sourceDigest: digest,
    sourceByteLength: { type: "integer", minimum: 0, maximum: 1048576 },
    encoding: { const: "utf-8" },
    parser: closed({ id: token, version: str(64, 1) }),
    certificationVersion: { const: "flowchart-copy-v1" },
    entries: arr(closed({ sourceId: nullable(str(128, 1)), elementIds: ids, range: nullable(range), construct: token, confidence: enumOf("exact", "ambiguous"), losses: arr(str(512, 1), 64) }), 1e4)
  });
  var fidelityValue = enumOf("lossless", "partial", "unsupported");
  var fidelitySchema = schema("diagram-fidelity-report", "diagram-fidelity-report", {
    diagramId: id,
    basis: snapshot,
    sourceDigest: nullable(digest),
    sourceFormat: enumOf("mermaid", "planr-diagram-bundle"),
    targetFormat: enumOf("mermaid", "planr-diagram-bundle", "svg", "html", "png"),
    semantic: fidelityValue,
    presentation: fidelityValue,
    sourceText: fidelityValue,
    losses: arr(closed({ dimension: enumOf("semantic", "presentation", "sourceText"), code: token, elementIds: ids, message: str(512, 1) }), 1024)
  });
  var bundleSchema = schema("diagram-authoring-bundle", "diagram-authoring-bundle", {
    diagramId: id,
    document: documentSchema,
    presentation: presentationSchema,
    originalSource: nullable(closed({ format: { const: "mermaid" }, text: str(1048576), sourceDigest: digest })),
    sourceMap: nullable(sourceMapSchema),
    bundleDigest: digest
  });
  var semanticEntry = { oneOf: [
    closed({ collection: { const: "nodes" }, value: node }),
    closed({ collection: { const: "relations" }, value: relation }),
    closed({ collection: { const: "groups" }, value: container }),
    closed({ collection: { const: "lanes" }, value: container }),
    closed({ collection: { const: "annotations" }, value: annotation })
  ] };
  var editableSemanticValue = (collection, properties) => closed({
    type: { const: "update-semantics" },
    collection: { const: collection },
    elementId: id,
    before: closed(properties),
    after: closed(properties)
  });
  var updateSchemas = [
    editableSemanticValue("nodes", { label: str(), kind: enumOf(...semanticKinds), description: nullable(str()) }),
    editableSemanticValue("relations", { from: id, to: id, kind: enumOf(...relationKinds), direction: enumOf("forward", "both", "none"), label: nullable(str()), weight: nullable({ type: "number", minimum: 0, maximum: 1e6 }) }),
    editableSemanticValue("groups", { label: str() }),
    editableSemanticValue("lanes", { label: str() }),
    editableSemanticValue("annotations", { text: str(), targetId: nullable(id) }),
    closed({ type: { const: "update-semantics" }, collection: { const: "emphasis" }, elementId: id, before: nullable(enumOf("primary", "secondary", "muted")), after: nullable(enumOf("primary", "secondary", "muted")), index: { type: "integer", minimum: 0, maximum: 1024 } }, ["type", "collection", "elementId", "before", "after"]),
    closed({ type: { const: "update-semantics" }, collection: { const: "document" }, before: closed({ title: str(), summary: str(), audience: enumOf("engineer", "executive", "mixed"), accessibility: documentSchema.properties.accessibility }), after: closed({ title: str(), summary: str(), audience: enumOf("engineer", "executive", "mixed"), accessibility: documentSchema.properties.accessibility }) }),
    closed({ type: { const: "update-semantics" }, collection: { const: "source-map" }, before: nullable(sourceMapSchema), after: nullable(sourceMapSchema) })
  ];
  var membershipState = closed({ groups: arr(closed({ id, members: ids }), 1024), lanes: arr(closed({ id, members: ids }), 256), laneOrder: ids });
  var geometryValue = closed({ bounds: nullable(bounds), route: nullable(route), label: nullable(labelPlacement), zIndex: index });
  var appearanceValue = closed({ appearance, locks });
  var operation = { oneOf: [
    closed({ type: { const: "insert-elements" }, elements: arr(semanticEntry, 1e4, 1), presentation: arr(placement, 1e4, 1), positions: arr(closed({ elementId: id, semanticIndex: index, presentationIndex: index }), 1e4, 1) }, ["type", "elements", "presentation"]),
    ...updateSchemas,
    closed({ type: { const: "remove-elements" }, elements: arr(semanticEntry, 1e4, 1), presentation: arr(placement, 1e4, 1) }),
    closed({ type: { const: "set-membership-order" }, before: membershipState, after: membershipState }),
    closed({ type: { const: "set-geometry" }, changes: arr(closed({ elementId: id, before: geometryValue, after: geometryValue }), 1e4, 1) }),
    closed({ type: { const: "set-appearance-locks" }, changes: arr(closed({ elementId: id, before: appearanceValue, after: appearanceValue }), 1e4, 1) })
  ] };
  var transactionSchema = schema("diagram-edit-transaction", "diagram-edit-transaction", {
    transactionId: id,
    diagramId: id,
    base: snapshot,
    operations: arr(operation, 256, 1),
    undoOf: nullable(id)
  });
  var proposalSchema = schema("diagram-change-proposal", "diagram-change-proposal", {
    proposalId: id,
    diagramId: id,
    base: snapshot,
    transaction: transactionSchema,
    summary: str(4096, 1),
    author: closed({ kind: enumOf("human", "agent"), id }),
    status: enumOf("proposed", "accepted", "rejected", "stale")
  });
  var publicationSchema = schema("diagram-publication-state", "diagram-publication-state", {
    diagramId: id,
    draft: nullable(snapshot),
    published: nullable(snapshot),
    audience: enumOf("private", "company", "public"),
    capabilitySemantics: { const: "descriptive-only-requires-host-authorization" }
  });
  var manifestSchema = schema("diagram-manifest", "diagram-manifest", {
    diagramId: id,
    basis: snapshot,
    bundle: closed({ path: relativePath, transportDigest: digest }),
    renderer: closed({ id: token, version: str(64, 1) }),
    outputs: arr(closed({ path: relativePath, mediaType: enumOf("image/svg+xml", "text/html", "image/png"), transportDigest: digest, fidelity: fidelitySchema }), 32, 1)
  });
  manifestSchema.properties.theme = closed({ id: token, version: str(64, 1) });
  var mermaidConstruct = closed({ construct: token, import: fidelityValue, export: fidelityValue, semanticRoundTrip: fidelityValue, mapping: str(512, 1) });
  var capabilityProfile = closed({
    grammarId: enumOf("flowchart", "process", "swimlane", "architecture"),
    authoring: { const: true },
    primitives: arr(enumOf("node", "relation", "group", "lane", "annotation", "emphasis"), 6, 1, true),
    nodeKinds: arr(enumOf(...semanticKinds), 6, 1, true),
    relationKinds: arr(enumOf(...relationKinds), 5, 1, true),
    operations: arr(enumOf(...DIAGRAM_EDIT_OPERATION_CLASSES), 6, 6, true),
    mermaid: closed({ mode: { const: "copy" }, certificationVersion: { const: "flowchart-copy-v1" }, constructs: arr(mermaidConstruct, 32, 1), linkedSource: { const: false } })
  });
  var capabilitiesSchema = schema("diagram-authoring-capabilities", "diagram-authoring-capabilities", {
    version: { const: "1.0.0" },
    liveCollaboration: { const: false },
    profiles: arr(capabilityProfile, 4, 4),
    unsupportedGrammars: arr(token, 128, 0, true)
  });
  var schemas = {
    "diagram-document": documentSchema,
    "diagram-presentation": presentationSchema,
    "diagram-authoring-bundle": bundleSchema,
    "diagram-edit-transaction": transactionSchema,
    "diagram-source-map": sourceMapSchema,
    "diagram-fidelity-report": fidelitySchema,
    "diagram-manifest": manifestSchema,
    "diagram-change-proposal": proposalSchema,
    "diagram-publication-state": publicationSchema,
    "diagram-authoring-capabilities": capabilitiesSchema
  };
  var DIAGRAM_AUTHORING_SCHEMAS = deepFreeze2(schemas);
  var DIAGRAM_AUTHORING_CONTRACT_FILES = deepFreeze2(Object.fromEntries(Object.keys(schemas).map((name) => [name, `${name}.schema.json`])));
  var mermaidConstructs = [
    ["flowchart-direction", "lossless", "lossless", "lossless", "flowchart TB/TD/LR/RL/BT maps to presentation layout direction"],
    ["explicit-node-id", "lossless", "lossless", "lossless", "Explicit source ID maps through source-map to stable semantic node ID; labels never establish identity"],
    ["plain-node-label", "lossless", "lossless", "lossless", "Escaped plain text maps to node label; HTML is inert text and is not executed"],
    ["rectangle-node", "lossless", "lossless", "lossless", "node.kind process and presentation shape rectangle"],
    ["rounded-node", "lossless", "lossless", "lossless", "node.kind process and presentation shape rounded-rectangle"],
    ["decision-node", "lossless", "lossless", "lossless", "node.kind decision and presentation shape diamond"],
    ["cylinder-node", "lossless", "lossless", "lossless", "node.kind data-store and presentation shape cylinder"],
    ["directed-edge", "lossless", "lossless", "lossless", "relation.kind flow and direction forward; source and target IDs are semantic endpoints"],
    ["bidirectional-edge", "lossless", "lossless", "lossless", "relation.kind flow and direction both"],
    ["undirected-edge", "lossless", "lossless", "lossless", "relation.kind association and direction none"],
    ["plain-edge-label", "lossless", "lossless", "lossless", "Escaped plain text maps to relation label"],
    ["subgraph", "lossless", "lossless", "lossless", "Explicit subgraph ID maps to one semantic group in an acyclic single-parent forest"],
    ["lane-semantics", "unsupported", "partial", "partial", "Mermaid subgraphs do not encode lane identity or explicit lane order"],
    ["manual-geometry", "unsupported", "partial", "partial", "Standard Mermaid does not preserve coordinates, routes, attachments, stacking or locks"],
    ["styles-and-directives", "unsupported", "unsupported", "unsupported", "CSS, classDef, init directives, links, callbacks and HTML labels are outside this certified subset"],
    ["unsupported-construct", "unsupported", "unsupported", "unsupported", "Unrecognized syntax is retained as original source with explicit loss diagnostics"]
  ].map(([construct, input, output, roundTrip, mapping]) => ({ construct, import: input, export: output, semanticRoundTrip: roundTrip, mapping }));
  var profileIds = ["flowchart", "process", "swimlane", "architecture"];
  var DIAGRAM_AUTHORING_CAPABILITIES = deepFreeze2({
    kind: "diagram-authoring-capabilities",
    schemaVersion: "1.0.0",
    protocolVersion: "1.13.0",
    version: "1.0.0",
    liveCollaboration: false,
    profiles: profileIds.map((grammarId) => ({
      grammarId,
      authoring: true,
      primitives: ["node", "relation", "group", ...grammarId === "process" || grammarId === "swimlane" ? ["lane"] : [], "annotation", "emphasis"],
      nodeKinds: [...semanticKinds],
      relationKinds: [...relationKinds],
      operations: [...DIAGRAM_EDIT_OPERATION_CLASSES],
      mermaid: { mode: "copy", certificationVersion: "flowchart-copy-v1", constructs: mermaidConstructs.map((entry2) => ({ ...entry2 })), linkedSource: false }
    })),
    unsupportedGrammars: DIAGRAM_REGISTRIES["diagram-grammars.json"].grammars.map((entry2) => entry2.grammarId).filter((value) => !profileIds.includes(value))
  });
  function getDiagramAuthoringCapability(grammarId) {
    return DIAGRAM_AUTHORING_CAPABILITIES.profiles.find((entry2) => entry2.grammarId === grammarId) ?? null;
  }
  var error = (path, rule, detail) => ({ path, rule, detail });
  function inspectData(value) {
    const issues = [];
    const ancestors = /* @__PURE__ */ new Set();
    let count = 0;
    let textSize = 0;
    function visit(current, path, depth) {
      if (issues.length) return;
      if (++count > DIAGRAM_AUTHORING_LIMITS.values || depth > DIAGRAM_AUTHORING_LIMITS.depth) {
        issues.push(error(path, "resource-limit", "Data exceeds the portable value or nesting limit."));
        return;
      }
      if (typeof current === "string") {
        textSize += current.length;
        if (textSize > DIAGRAM_AUTHORING_LIMITS.textCodeUnits) issues.push(error(path, "resource-limit", "Data exceeds the portable text limit."));
        else if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(current)) issues.push(error(path, "unicode", "Unpaired Unicode surrogate is not portable UTF-8."));
        return;
      }
      if (current === null || typeof current === "boolean") return;
      if (typeof current === "number") {
        if (!Number.isFinite(current)) issues.push(error(path, "finite-number", "Numbers must be finite."));
        return;
      }
      if (typeof current !== "object") {
        issues.push(error(path, "plain-data", "Only JSON data is accepted."));
        return;
      }
      const proto = Object.getPrototypeOf(current);
      if (Array.isArray(current) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
        issues.push(error(path, "plain-data", "Custom prototypes are not accepted."));
        return;
      }
      if (ancestors.has(current)) {
        issues.push(error(path, "cycle", "Cyclic data is not accepted."));
        return;
      }
      ancestors.add(current);
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string" || key === "__proto__" || key === "constructor" || key === "prototype") {
          issues.push(error(path, "unsafe-key", "Unsafe or symbolic object key."));
          break;
        }
        const descriptor = descriptors[key];
        if (descriptor.get || descriptor.set || !("value" in descriptor)) {
          issues.push(error(path, "accessor", "Accessors are not accepted."));
          break;
        }
        if (Array.isArray(current) && key === "length") continue;
        if (!descriptor.enumerable || Array.isArray(current) && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= current.length)) {
          issues.push(error(path, "plain-data", "Non-JSON properties are not accepted."));
          break;
        }
        visit(descriptor.value, Array.isArray(current) ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
        if (issues.length) break;
      }
      if (!issues.length && Array.isArray(current) && Object.keys(descriptors).length !== current.length + 1) issues.push(error(path, "sparse-array", "Sparse arrays are not accepted."));
      ancestors.delete(current);
    }
    try {
      visit(value, "$", 0);
    } catch {
      issues.push(error("$", "plain-data", "Data cannot be inspected safely."));
    }
    return issues;
  }
  function assertData(value) {
    const issues = inspectData(value);
    if (issues.length) throw new TypeError(`${issues[0].path}: ${issues[0].rule}`);
  }
  function digestExcluding(value, field2) {
    assertData(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Digest input must be an object.");
    const input = { ...value };
    delete input[field2];
    return sha256Jcs(input);
  }
  var diagramDocumentDigest = (value) => digestExcluding(value, "documentDigest");
  var diagramPresentationDigest = (value) => digestExcluding(value, "presentationDigest");
  var diagramAuthoringBundleDigest = (value) => digestExcluding(value, "bundleDigest");
  var same = (a, b) => canonicalizeJson(a) === canonicalizeJson(b);
  var sourceDigest = (text2) => `sha256:${sha256Hex(text2)}`;
  var semanticNames = ["nodes", "relations", "groups", "lanes", "events", "series", "axes", "sets", "annotations"];
  var allElements = (doc) => semanticNames.flatMap((name) => doc[name]);
  var expectedSnapshot = (bundle) => ({ bundleDigest: bundle.bundleDigest, semanticDigest: bundle.document.documentDigest, presentationDigest: bundle.presentation.presentationDigest });
  function hasContainmentCycle(parents) {
    const complete = /* @__PURE__ */ new Set();
    for (const member of parents.keys()) {
      const visited = /* @__PURE__ */ new Set();
      let current = member;
      while (current && !complete.has(current)) {
        if (visited.has(current)) return true;
        visited.add(current);
        current = parents.get(current);
      }
      for (const item of visited) complete.add(item);
    }
    return false;
  }
  function documentIssues(doc, path, issues) {
    const entries2 = allElements(doc);
    const byId = /* @__PURE__ */ new Map();
    if (entries2.length + doc.emphasis.length > 1e4) issues.push(error(path, "resource-limit", "Too many semantic primitive entries."));
    for (const collection of semanticNames) for (let i = 0; i < doc[collection].length; i += 1) {
      const entry2 = doc[collection][i];
      if (byId.has(entry2.id)) issues.push(error(`${path}.${collection}[${i}].id`, "duplicate-id", "Semantic element IDs must be globally unique."));
      byId.set(entry2.id, { ...entry2, collection });
    }
    const capability = getDiagramAuthoringCapability(doc.grammar.id);
    if (!capability.primitives.includes("lane") && doc.lanes.length) issues.push(error(`${path}.lanes`, "profile-primitive", "This authoring profile does not support lanes."));
    doc.relations.forEach((edge, i) => ["from", "to"].forEach((key) => {
      if (byId.get(edge[key])?.collection !== "nodes") issues.push(error(`${path}.relations[${i}].${key}`, "endpoint", "Relationship endpoints must reference semantic nodes."));
    }));
    const parent = /* @__PURE__ */ new Map();
    for (const collection of ["groups", "lanes"]) doc[collection].forEach((group, i) => group.members.forEach((member, j) => {
      const child = byId.get(member);
      const memberPath = `${path}.${collection}[${i}].members[${j}]`;
      if (!child || !["nodes", "groups", "lanes", "annotations"].includes(child.collection)) issues.push(error(memberPath, "containment-reference", "Container members must reference a placeable semantic element."));
      if (parent.has(member)) issues.push(error(memberPath, "multiple-parents", "An element has more than one immediate container."));
      parent.set(member, group.id);
    }));
    if (hasContainmentCycle(parent)) issues.push(error(path, "containment-cycle", "Container membership must form a forest."));
    if (!same([...doc.laneOrder].sort(), doc.lanes.map((item) => item.id).sort())) issues.push(error(`${path}.laneOrder`, "lane-order", "Every lane must occur exactly once in laneOrder."));
    doc.annotations.forEach((entry2, i) => {
      if (entry2.targetId !== null && !byId.has(entry2.targetId)) issues.push(error(`${path}.annotations[${i}].targetId`, "reference", "Annotation target is missing."));
    });
    const emphasisIds = /* @__PURE__ */ new Set();
    doc.emphasis.forEach((entry2, i) => {
      if (!byId.has(entry2.targetId)) issues.push(error(`${path}.emphasis[${i}].targetId`, "reference", "Emphasis target is missing."));
      if (emphasisIds.has(entry2.targetId)) issues.push(error(`${path}.emphasis[${i}].targetId`, "duplicate-id", "Only one emphasis entry is allowed per target."));
      emphasisIds.add(entry2.targetId);
    });
    doc.accessibility.readingOrder.forEach((entry2, i) => {
      if (!byId.has(entry2)) issues.push(error(`${path}.accessibility.readingOrder[${i}]`, "reference", "Reading order target is missing."));
    });
    if (doc.documentDigest !== diagramDocumentDigest(doc)) issues.push(error(`${path}.documentDigest`, "digest", "Semantic content digest does not match."));
  }
  function presentationIssues(value, doc, path, issues) {
    const idsSeen = /* @__PURE__ */ new Set();
    const byId = doc ? new Map(allElements(doc).map((entry2) => [entry2.id, entry2])) : null;
    const nodes = doc ? new Set(doc.nodes.map((entry2) => entry2.id)) : null;
    const relations = doc ? new Map(doc.relations.map((entry2) => [entry2.id, entry2])) : null;
    const containers = doc ? new Set([...doc.groups, ...doc.lanes].map((entry2) => entry2.id)) : null;
    if (doc && (value.diagramId !== doc.diagramId || value.semanticDigest !== doc.documentDigest)) issues.push(error(path, "basis", "Presentation does not reference the exact semantic document."));
    value.elements.forEach((entry2, i) => {
      const location = `${path}.elements[${i}]`;
      geometryIssues(entry2, location, issues);
      if (idsSeen.has(entry2.elementId)) issues.push(error(`${location}.elementId`, "duplicate-id", "Presentation element IDs must be unique."));
      idsSeen.add(entry2.elementId);
      if (byId && !byId.has(entry2.elementId)) issues.push(error(`${location}.elementId`, "reference", "Presentation element is not in the semantic document."));
      if (entry2.route !== null && entry2.bounds !== null) issues.push(error(location, "geometry-kind", "A connector has a route; a shape has bounds."));
      if (entry2.route === null && entry2.bounds === null) issues.push(error(location, "geometry-kind", "A placed element requires bounds or a route."));
      if (entry2.route?.mode === "manual" && entry2.route.points.length < 2) issues.push(error(`${location}.route.points`, "manual-route", "A manual route requires at least two global points."));
      if (entry2.route?.mode === "automatic" && entry2.route.points.length !== 0) issues.push(error(`${location}.route.points`, "automatic-route", "Automatic route geometry is derived and must not carry authored points."));
      if (entry2.route && entry2.appearance.shape !== "connector") issues.push(error(`${location}.appearance.shape`, "shape-kind", "Routes must use the connector shape."));
      if (entry2.bounds && entry2.appearance.shape === "connector") issues.push(error(`${location}.appearance.shape`, "shape-kind", "Bounded elements cannot use the connector shape."));
      if (relations?.has(entry2.elementId) && !entry2.route) issues.push(error(location, "geometry-kind", "Semantic relations require route geometry."));
      if (doc && !relations.has(entry2.elementId) && !entry2.bounds) issues.push(error(location, "geometry-kind", "Non-relation elements require bounds."));
      if (containers?.has(entry2.elementId) && entry2.appearance.shape !== "container") issues.push(error(`${location}.appearance.shape`, "shape-kind", "Containers require the container visual shape."));
      if (nodes?.has(entry2.elementId) && ["container", "text"].includes(entry2.appearance.shape)) issues.push(error(`${location}.appearance.shape`, "shape-kind", "Nodes require a node visual shape."));
    });
    if (byId && (idsSeen.size !== byId.size || [...byId.keys()].some((key) => !idsSeen.has(key)))) issues.push(error(`${path}.elements`, "presentation-coverage", "Every semantic element must have exactly one placement."));
    if (value.presentationDigest !== diagramPresentationDigest(value)) issues.push(error(`${path}.presentationDigest`, "digest", "Presentation content digest does not match."));
  }
  function sourceMapIssues(value, doc, text2, path, issues) {
    if (doc && (value.diagramId !== doc.diagramId || value.semanticDigest !== doc.documentDigest)) issues.push(error(path, "basis", "Source map does not reference the exact semantic document."));
    const elementIds = doc ? new Set(allElements(doc).map((entry2) => entry2.id)) : null;
    const sourceIds = /* @__PURE__ */ new Set();
    let boundaries = null;
    if (text2 !== void 0) {
      const byteLength = new TextEncoder().encode(text2).length;
      if (value.sourceDigest !== sourceDigest(text2) || value.sourceByteLength !== byteLength) issues.push(error(path, "source-digest", "Source digest and byte length must match exact UTF-8 source text."));
      const requested = new Set(value.entries.flatMap((entry2) => entry2.range ? [entry2.range.startByte, entry2.range.endByte] : []));
      boundaries = /* @__PURE__ */ new Set([0]);
      let cursor = 0;
      for (const character of text2) {
        const code = character.codePointAt(0);
        cursor += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
        if (requested.has(cursor)) boundaries.add(cursor);
      }
    }
    value.entries.forEach((entry2, i) => {
      const location = `${path}.entries[${i}]`;
      if (entry2.sourceId !== null && sourceIds.has(entry2.sourceId)) issues.push(error(`${location}.sourceId`, "ambiguous-source-id", "Duplicate explicit source IDs must be represented by one ambiguous entry."));
      if (entry2.sourceId !== null) sourceIds.add(entry2.sourceId);
      if (entry2.confidence === "exact" && (entry2.sourceId === null && entry2.range === null || entry2.elementIds.length !== 1)) issues.push(error(location, "source-identity", "Exact correspondence requires a source ID or exact range and one semantic element."));
      const certification = mermaidConstructs.find((item) => item.construct === entry2.construct);
      if (!certification || certification.import === "unsupported" && (entry2.confidence === "exact" || entry2.losses.length === 0)) issues.push(error(`${location}.construct`, "source-certification", "Unsupported syntax requires the certified loss record and cannot claim exact correspondence."));
      if (elementIds) entry2.elementIds.forEach((item, j) => {
        if (!elementIds.has(item)) issues.push(error(`${location}.elementIds[${j}]`, "reference", "Source map semantic element is missing."));
      });
      if (entry2.range && (entry2.range.startByte > entry2.range.endByte || entry2.range.endByte > value.sourceByteLength || boundaries && (!boundaries.has(entry2.range.startByte) || !boundaries.has(entry2.range.endByte)))) issues.push(error(`${location}.range`, "source-range", "Source range must lie on UTF-8 boundaries within the original source."));
    });
  }
  function bundleIssues(bundle, path, issues) {
    documentIssues(bundle.document, `${path}.document`, issues);
    presentationIssues(bundle.presentation, bundle.document, `${path}.presentation`, issues);
    if (bundle.diagramId !== bundle.document.diagramId || bundle.diagramId !== bundle.presentation.diagramId) issues.push(error(`${path}.diagramId`, "diagram-id", "Bundle members must identify one diagram."));
    if (bundle.originalSource === null !== (bundle.sourceMap === null)) issues.push(error(path, "source-pair", "Original source and its correspondence map must be retained together."));
    if (bundle.originalSource) {
      if (new TextEncoder().encode(bundle.originalSource.text).length > DIAGRAM_AUTHORING_LIMITS.sourceBytes) issues.push(error(`${path}.originalSource.text`, "resource-limit", "Original source exceeds the UTF-8 byte limit."));
      if (bundle.originalSource.sourceDigest !== sourceDigest(bundle.originalSource.text)) issues.push(error(`${path}.originalSource.sourceDigest`, "source-digest", "Source digest must match exact original UTF-8 bytes."));
    }
    if (bundle.sourceMap) sourceMapIssues(bundle.sourceMap, bundle.document, bundle.originalSource?.text, `${path}.sourceMap`, issues);
    if (bundle.bundleDigest !== diagramAuthoringBundleDigest(bundle)) issues.push(error(`${path}.bundleDigest`, "digest", "Bundle content digest does not match."));
  }
  function basisIssues(value, bundle, path, issues) {
    if (bundle && (value.diagramId !== bundle.diagramId || !same(value.base ?? value.basis, expectedSnapshot(bundle)))) issues.push(error(path, "basis", "The artifact does not reference the exact supplied bundle snapshot."));
  }
  function transactionIssues(value, bundle, path, issues) {
    basisIssues(value, bundle, path, issues);
    if (value.undoOf === value.transactionId) issues.push(error(`${path}.undoOf`, "undo-reference", "An inverse cannot reference its own transaction."));
    const available = bundle ? new Set(allElements(bundle.document).map((entry2) => entry2.id)) : null;
    const collectionById = bundle ? new Map(semanticNames.flatMap((name) => bundle.document[name].map((entry2) => [entry2.id, name]))) : null;
    const insertedCollections = /* @__PURE__ */ new Map();
    const inserted = /* @__PURE__ */ new Set();
    const removed = /* @__PURE__ */ new Set();
    const capability = bundle ? getDiagramAuthoringCapability(bundle.document.grammar.id) : null;
    const collectionOf = (elementId) => collectionById?.get(elementId) ?? insertedCollections.get(elementId);
    const membershipReferences = (collection, item, location) => {
      if (!collectionById) return;
      const actualCollection = collectionOf(item.id);
      if (!actualCollection) issues.push(error(`${location}.id`, "containment-reference", "Membership container is not in the base or inserts."));
      else if (actualCollection !== collection) issues.push(error(`${location}.id`, "element-class", "Membership container must match its semantic collection."));
      item.members.forEach((member, j) => {
        if (!["nodes", "groups", "lanes", "annotations"].includes(collectionOf(member))) issues.push(error(`${location}.members[${j}]`, "containment-reference", "Container members must reference placeable elements in the base or inserts."));
      });
    };
    const semanticGeometry = (collection, geometry, location) => {
      if (collection && collection === "relations" !== (geometry.route !== null)) issues.push(error(location, "geometry-kind", "Geometry must match the semantic element class."));
    };
    const semanticAppearance = (collection, appearance2, location) => {
      if (!collection) return;
      const shape2 = appearance2.shape;
      if (collection === "relations" && shape2 !== "connector" || collection !== "relations" && shape2 === "connector" || ["groups", "lanes"].includes(collection) && shape2 !== "container" || collection === "nodes" && ["container", "text"].includes(shape2)) issues.push(error(`${location}.shape`, "shape-kind", "Appearance must match the semantic element class."));
    };
    value.operations.forEach((op, i) => {
      const location = `${path}.operations[${i}]`;
      if (op.type === "insert-elements" || op.type === "remove-elements") {
        const entryIds = op.elements.map((entry2) => entry2.value.id);
        const presentationIds = op.presentation.map((entry2) => entry2.elementId);
        if (new Set(entryIds).size !== entryIds.length) issues.push(error(`${location}.elements`, "duplicate-id", "Each operation must identify unique semantic elements."));
        if (!same([...entryIds].sort(), [...presentationIds].sort())) issues.push(error(`${location}.presentation`, "presentation-coverage", "Inserted or removed semantic elements require matching presentation entries."));
        if (op.type === "insert-elements" && op.positions) {
          const positionedIds = op.positions.map((entry2) => entry2.elementId);
          if (new Set(positionedIds).size !== positionedIds.length) issues.push(error(`${location}.positions`, "duplicate-id", "Insertion positions must identify each element once."));
          if (!same([...entryIds].sort(), [...positionedIds].sort())) issues.push(error(`${location}.positions`, "position-coverage", "Insertion positions must cover exactly the inserted elements."));
        }
        for (const entry2 of op.elements) {
          if (op.type === "insert-elements") {
            if (entry2.collection === "lanes" && capability && !capability.primitives.includes("lane")) issues.push(error(`${location}.elements`, "profile-primitive", "This authoring profile does not support lanes."));
            if (inserted.has(entry2.value.id) || available?.has(entry2.value.id)) issues.push(error(`${location}.elements`, "duplicate-id", "An insert must allocate a new stable element ID."));
            inserted.add(entry2.value.id);
            insertedCollections.set(entry2.value.id, entry2.collection);
          } else {
            if (removed.has(entry2.value.id)) issues.push(error(`${location}.elements`, "duplicate-id", "An element cannot be removed twice."));
            if (available && !available.has(entry2.value.id) && !inserted.has(entry2.value.id)) issues.push(error(`${location}.elements`, "reference", "Removed element is not in the base or earlier inserts."));
            if (collectionById && (collectionById.get(entry2.value.id) ?? insertedCollections.get(entry2.value.id)) !== entry2.collection) issues.push(error(`${location}.elements`, "element-class", "Removed entry must identify the actual semantic element class."));
            removed.add(entry2.value.id);
          }
        }
        if (op.type === "insert-elements" && collectionById) op.elements.forEach((entry2, j) => {
          if (entry2.collection === "relations") for (const endpoint of ["from", "to"]) {
            if ((collectionById.get(entry2.value[endpoint]) ?? insertedCollections.get(entry2.value[endpoint])) !== "nodes") issues.push(error(`${location}.elements[${j}].value.${endpoint}`, "endpoint", "Relationship endpoints must identify nodes in the base or this insertion."));
          }
          if (["groups", "lanes"].includes(entry2.collection)) membershipReferences(entry2.collection, entry2.value, `${location}.elements[${j}].value`);
          if (entry2.collection === "annotations" && entry2.value.targetId !== null && !collectionOf(entry2.value.targetId)) issues.push(error(`${location}.elements[${j}].value.targetId`, "reference", "Annotation target is not in the base or inserts."));
        });
        for (const [j, entry2] of op.presentation.entries()) {
          const semantic = op.elements.find((item) => item.value.id === entry2.elementId);
          geometryIssues(entry2, `${location}.presentation[${j}]`, issues);
          semanticGeometry(semantic?.collection, entry2, `${location}.presentation[${j}]`);
          semanticAppearance(semantic?.collection, entry2.appearance, `${location}.presentation[${j}].appearance`);
        }
      } else if (op.type === "set-geometry" || op.type === "set-appearance-locks") {
        const touched = /* @__PURE__ */ new Set();
        op.changes.forEach((change, j) => {
          if (touched.has(change.elementId)) issues.push(error(`${location}.changes[${j}].elementId`, "duplicate-id", "An operation must list each affected element once."));
          touched.add(change.elementId);
          if (available && !available.has(change.elementId) && !inserted.has(change.elementId)) issues.push(error(`${location}.changes[${j}].elementId`, "reference", "Affected element is not in the base or earlier inserts."));
          for (const side of ["before", "after"]) {
            const changePath = `${location}.changes[${j}].${side}`;
            if (op.type === "set-geometry") {
              geometryIssues(change[side], changePath, issues);
              if (collectionById) semanticGeometry(collectionOf(change.elementId), change[side], changePath);
            } else if (collectionById) semanticAppearance(collectionOf(change.elementId), change[side].appearance, `${changePath}.appearance`);
          }
        });
      } else if (op.type === "update-semantics") {
        if (op.collection === "emphasis" && op.index !== void 0 && (op.before !== null || op.after === null)) issues.push(error(`${location}.index`, "insertion-position", "An emphasis index is only valid when inserting an emphasis entry."));
        if (!["document", "source-map"].includes(op.collection) && available && !available.has(op.elementId) && !inserted.has(op.elementId)) issues.push(error(`${location}.elementId`, "reference", "Affected semantic element is not in the base or earlier inserts."));
        if (!["document", "source-map", "emphasis"].includes(op.collection) && collectionById && (collectionById.get(op.elementId) ?? insertedCollections.get(op.elementId)) !== op.collection) issues.push(error(`${location}.collection`, "element-class", "An update cannot change the class of its semantic element."));
        if (op.collection === "relations") for (const side of ["before", "after"]) for (const end of ["from", "to"]) {
          if (collectionById && (collectionById.get(op[side][end]) ?? insertedCollections.get(op[side][end])) !== "nodes") issues.push(error(`${location}.${side}.${end}`, "endpoint", "Relationship endpoints must identify nodes in the base or inserts."));
        }
        if (collectionById && op.collection === "annotations") for (const side of ["before", "after"]) {
          if (op[side].targetId !== null && !collectionOf(op[side].targetId)) issues.push(error(`${location}.${side}.targetId`, "reference", "Annotation target is not in the base or inserts."));
        }
        if (collectionById && op.collection === "document") for (const side of ["before", "after"]) op[side].accessibility.readingOrder.forEach((elementId, j) => {
          if (!collectionOf(elementId)) issues.push(error(`${location}.${side}.accessibility.readingOrder[${j}]`, "reference", "Reading order target is not in the base or inserts."));
        });
      } else if (op.type === "set-membership-order") {
        for (const side of ["before", "after"]) {
          const state = op[side];
          if (state.lanes.length && capability && !capability.primitives.includes("lane")) issues.push(error(`${location}.${side}.lanes`, "profile-primitive", "This authoring profile does not support lanes."));
          for (const collection of ["groups", "lanes"]) state[collection].forEach((item, j) => membershipReferences(collection, item, `${location}.${side}.${collection}[${j}]`));
          const parents = /* @__PURE__ */ new Map();
          const containers = [...state.groups, ...state.lanes];
          if (new Set(containers.map((item) => item.id)).size !== containers.length) issues.push(error(`${location}.${side}`, "duplicate-id", "Membership lists require distinct container IDs."));
          for (const item of containers) for (const member of item.members) {
            if (parents.has(member)) issues.push(error(`${location}.${side}`, "multiple-parents", "Membership assigns more than one immediate parent."));
            parents.set(member, item.id);
          }
          if (hasContainmentCycle(parents)) issues.push(error(`${location}.${side}`, "containment-cycle", "Membership must form a forest."));
          if (!same([...state.laneOrder].sort(), state.lanes.map((item) => item.id).sort())) issues.push(error(`${location}.${side}.laneOrder`, "lane-order", "Membership includes every lane in explicit order."));
        }
      }
    });
  }
  function geometryIssues(entry2, path, issues) {
    if (entry2.bounds === null === (entry2.route === null)) issues.push(error(path, "geometry-kind", "Geometry requires exactly one of bounds or route."));
    if (entry2.route?.mode === "manual" && entry2.route.points.length < 2) issues.push(error(`${path}.route.points`, "manual-route", "Manual routes require at least two global points."));
    if (entry2.route?.mode === "automatic" && entry2.route.points.length !== 0) issues.push(error(`${path}.route.points`, "automatic-route", "Automatic route points are derived."));
    if (entry2.route?.mode === "manual" && entry2.route.strategy === "straight" && entry2.route.points.length !== 2) issues.push(error(`${path}.route.points`, "route-strategy", "A straight manual route has exactly two endpoint points."));
    if (entry2.route?.mode === "manual" && entry2.route.strategy === "orthogonal" && entry2.route.points.some((point2, i, points) => i > 0 && point2.x !== points[i - 1].x && point2.y !== points[i - 1].y)) issues.push(error(`${path}.route.points`, "route-strategy", "Every orthogonal segment must be horizontal or vertical."));
  }
  function fidelityIssues(value, bundle, path, issues) {
    basisIssues(value, bundle, path, issues);
    const idsKnown = bundle ? new Set(allElements(bundle.document).map((entry2) => entry2.id)) : null;
    for (const [i, loss] of value.losses.entries()) {
      if (value[loss.dimension] === "lossless") issues.push(error(`${path}.${loss.dimension}`, "fidelity", "A dimension with reported loss cannot claim lossless fidelity."));
      if (idsKnown) loss.elementIds.forEach((entry2, j) => {
        if (!idsKnown.has(entry2)) issues.push(error(`${path}.losses[${i}].elementIds[${j}]`, "reference", "Fidelity loss refers to an unknown semantic element."));
      });
    }
    if (bundle && value.sourceDigest !== (bundle.originalSource?.sourceDigest ?? null)) issues.push(error(`${path}.sourceDigest`, "source-digest", "Fidelity report must identify the retained source, if any."));
    if (value.sourceFormat === "mermaid" && value.sourceDigest === null) issues.push(error(`${path}.sourceDigest`, "source-digest", "A Mermaid import report must identify its exact source bytes."));
    if (bundle && value.sourceFormat === "mermaid") {
      const uncertain = bundle.sourceMap?.entries.some((entry2) => entry2.confidence === "ambiguous" || entry2.losses.length || mermaidConstructs.find((item) => item.construct === entry2.construct)?.import !== "lossless");
      if (uncertain && value.semantic === "lossless") issues.push(error(`${path}.semantic`, "fidelity", "Source correspondence records ambiguity or unsupported content; semantic fidelity cannot be lossless."));
      const lostPresentation = bundle.sourceMap?.entries.some((entry2) => ["styles-and-directives", "manual-geometry", "unsupported-construct"].includes(entry2.construct));
      if (lostPresentation && value.presentation === "lossless") issues.push(error(`${path}.presentation`, "fidelity", "Unsupported source presentation cannot be reported as retained without loss."));
    }
    if (bundle && value.targetFormat === "mermaid") {
      if (bundle.presentation.elements.length && value.presentation === "lossless") issues.push(error(`${path}.presentation`, "fidelity", "Standard Mermaid does not retain authored global geometry, stacking, attachment offsets or locks."));
      const appearances = new Map(bundle.presentation.elements.map((entry2) => [entry2.elementId, entry2.appearance.shape]));
      const supportedNodes = bundle.document.nodes.every((entry2) => entry2.kind === "process" && ["rectangle", "rounded-rectangle"].includes(appearances.get(entry2.id)) || entry2.kind === "decision" && appearances.get(entry2.id) === "diamond" || entry2.kind === "data-store" && appearances.get(entry2.id) === "cylinder");
      const supportedRelations = bundle.document.relations.every((entry2) => entry2.kind === "flow" && ["forward", "both"].includes(entry2.direction) || entry2.kind === "association" && entry2.direction === "none");
      if ((!supportedNodes || !supportedRelations || bundle.document.lanes.length || bundle.document.annotations.length || bundle.document.emphasis.length) && value.semantic === "lossless") issues.push(error(`${path}.semantic`, "fidelity", "The certified Mermaid subset cannot preserve all authored semantic roles or primitives."));
    }
  }
  var validRelativePath = (value) => !value.split("/").some((part) => part === "" || part === "." || part === "..") && !/^[A-Za-z]:/u.test(value);
  function validateDiagramAuthoringArtifact(kind, value, options = {}) {
    const issues = inspectData(value);
    if (issues.length) return issues;
    const optionIssues = inspectData(options);
    if (optionIssues.length) return optionIssues.map((entry2) => ({ ...entry2, path: entry2.path.replace(/^\$/u, "$options") }));
    if (!options || Array.isArray(options) || typeof options !== "object" || Object.keys(options).some((key) => !["document", "bundle", "baseBundle", "sourceText"].includes(key))) return [error("$options", "options", "Only explicit document, bundle, baseBundle and sourceText contexts are accepted.")];
    if (options.sourceText !== void 0 && typeof options.sourceText !== "string") return [error("$options.sourceText", "type", "Source text context must be a string.")];
    if (typeof kind !== "string" || !Object.hasOwn(DIAGRAM_AUTHORING_SCHEMAS, kind)) return [error("$", "contract", "Unknown diagram authoring contract.")];
    const shapeIssues = validateJson(value, DIAGRAM_AUTHORING_SCHEMAS[kind]);
    if (shapeIssues.length) return shapeIssues.slice(0, 128).map(({ path, rule }) => error(path, rule, "Value does not satisfy the diagram authoring contract."));
    for (const name of ["document", "bundle", "baseBundle"]) if (options[name] !== void 0) {
      const contextKind = name === "document" ? "diagram-document" : "diagram-authoring-bundle";
      const failures = validateDiagramAuthoringArtifact(contextKind, options[name]);
      issues.push(...failures.map((entry2) => ({ ...entry2, path: entry2.path.replace(/^\$/u, `$options.${name}`) })));
    }
    if (issues.length) return issues;
    if (options.bundle && options.baseBundle && !same(options.bundle, options.baseBundle)) return [error("$options", "basis", "Conflicting bundle contexts are not accepted.")];
    const contextBundle = options.baseBundle ?? options.bundle;
    const contextDoc = options.document ?? contextBundle?.document;
    if (options.document && contextBundle && !same(options.document, contextBundle.document)) return [error("$options.document", "basis", "Document context must match the supplied bundle.")];
    if (options.sourceText !== void 0 && contextBundle?.originalSource && options.sourceText !== contextBundle.originalSource.text) return [error("$options.sourceText", "source-digest", "Source text context must match the supplied bundle.")];
    switch (kind) {
      case "diagram-document":
        documentIssues(value, "$", issues);
        break;
      case "diagram-presentation":
        presentationIssues(value, contextDoc, "$", issues);
        break;
      case "diagram-authoring-bundle":
        bundleIssues(value, "$", issues);
        break;
      case "diagram-source-map":
        sourceMapIssues(value, contextDoc, options.sourceText ?? contextBundle?.originalSource?.text, "$", issues);
        break;
      case "diagram-edit-transaction":
        transactionIssues(value, contextBundle, "$", issues);
        break;
      case "diagram-change-proposal":
        basisIssues(value, contextBundle, "$", issues);
        transactionIssues(value.transaction, contextBundle, "$.transaction", issues);
        if (value.diagramId !== value.transaction.diagramId || !same(value.base, value.transaction.base)) issues.push(error("$.transaction", "basis", "Proposal and transaction must identify the same exact diagram snapshot."));
        break;
      case "diagram-fidelity-report":
        fidelityIssues(value, contextBundle, "$", issues);
        break;
      case "diagram-manifest":
        basisIssues(value, contextBundle, "$", issues);
        if (!validRelativePath(value.bundle.path)) issues.push(error("$.bundle.path", "relative-path", "Bundle path must remain within its artifact scope."));
        if (!value.bundle.path.endsWith(".planr-diagram-bundle.json")) issues.push(error("$.bundle.path", "bundle-path", "The canonical bundle uses the planr-diagram-bundle.json extension."));
        value.outputs.forEach((entry2, i) => {
          if (!validRelativePath(entry2.path)) issues.push(error(`$.outputs[${i}].path`, "relative-path", "Output path must remain within its artifact scope."));
          if (entry2.path === value.bundle.path) issues.push(error(`$.outputs[${i}].path`, "canonical-output-collision", "A derived output must not overwrite the canonical bundle."));
          if (entry2.fidelity.targetFormat !== { "image/svg+xml": "svg", "text/html": "html", "image/png": "png" }[entry2.mediaType]) issues.push(error(`$.outputs[${i}].fidelity.targetFormat`, "output-format", "Output fidelity must describe the declared media type."));
          fidelityIssues(entry2.fidelity, contextBundle, `$.outputs[${i}].fidelity`, issues);
          if (entry2.fidelity.diagramId !== value.diagramId || !same(entry2.fidelity.basis, value.basis)) issues.push(error(`$.outputs[${i}].fidelity`, "basis", "Every output must identify the manifest snapshot."));
        });
        if (new Set(value.outputs.map((entry2) => entry2.path)).size !== value.outputs.length) issues.push(error("$.outputs", "duplicate-path", "Output paths must be unique."));
        break;
      case "diagram-publication-state":
        if (value.draft === null && value.published === null) issues.push(error("$", "publication-reference", "Publication metadata must identify at least one snapshot."));
        if (contextBundle && (value.diagramId !== contextBundle.diagramId || ![value.draft, value.published].some((entry2) => entry2 && same(entry2, expectedSnapshot(contextBundle))))) issues.push(error("$", "basis", "Publication metadata does not reference the supplied snapshot."));
        break;
      case "diagram-authoring-capabilities":
        if (!same(value, DIAGRAM_AUTHORING_CAPABILITIES)) issues.push(error("$", "capability-certification", "Capability claims must match the versioned certification catalog exactly."));
        break;
      default:
        break;
    }
    return issues.slice(0, 128);
  }
  var validateDiagramAuthoringBundle = (value, options) => validateDiagramAuthoringArtifact("diagram-authoring-bundle", value, options);
  var validateDiagramEditTransaction = (value, options) => validateDiagramAuthoringArtifact("diagram-edit-transaction", value, options);

  // lib/artifact/diagram/authoring/model.mjs
  var COLLECTIONS = ["nodes", "relations", "groups", "lanes", "annotations"];
  var clone = (value) => JSON.parse(JSON.stringify(value));
  var canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  var same2 = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  var diagnostic = (path, rule, detail) => ({ path, rule, detail });
  var failure = (path, rule, detail) => ({ ok: false, diagnostics: [diagnostic(path, rule, detail)] });
  function inspectPlainData(value, allowedKeyPaths = []) {
    const ancestors = /* @__PURE__ */ new Set();
    let values = 0;
    let text2 = 0;
    let issue2;
    const reject = (path, rule, detail) => {
      issue2 ??= diagnostic(path, rule, detail);
    };
    function visit(current, path, depth) {
      if (issue2) return;
      if (++values > DIAGRAM_AUTHORING_LIMITS.values || depth > DIAGRAM_AUTHORING_LIMITS.depth) return reject(path, "resource-limit", "Input exceeds portable data limits.");
      if (typeof current === "string") {
        text2 += current.length;
        if (text2 > DIAGRAM_AUTHORING_LIMITS.textCodeUnits) reject(path, "resource-limit", "Input exceeds the text limit.");
        return;
      }
      if (current === null || typeof current === "boolean") return;
      if (typeof current === "number") {
        if (!Number.isFinite(current)) reject(path, "finite-number", "Numbers must be finite.");
        return;
      }
      if (typeof current !== "object") return reject(path, "plain-data", "Only inert JSON data is accepted.");
      const proto = Object.getPrototypeOf(current);
      if (Array.isArray(current) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return reject(path, "plain-data", "Custom prototypes are not accepted.");
      if (ancestors.has(current)) return reject(path, "cycle", "Cyclic input is not accepted.");
      ancestors.add(current);
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string" || key === "__proto__" || ["constructor", "prototype"].includes(key) && !allowedKeyPaths.includes(path)) {
          reject(path, "unsafe-key", "Unsafe object key.");
          break;
        }
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, "value")) {
          reject(path, "accessor", "Accessors are not accepted.");
          break;
        }
        if (Array.isArray(current) && key === "length") continue;
        if (!descriptor.enumerable || Array.isArray(current) && !/^(0|[1-9][0-9]*)$/u.test(key)) {
          reject(path, "plain-data", "Non-JSON properties are not accepted.");
          break;
        }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
      if (Array.isArray(current) && Object.keys(descriptors).length !== current.length + 1) reject(path, "sparse-array", "Sparse arrays are not accepted.");
      ancestors.delete(current);
    }
    try {
      visit(value, "$", 0);
    } catch {
      reject("$", "plain-data", "Input could not be inspected as inert JSON data.");
    }
    return issue2 ? [issue2] : [];
  }
  function validateAuthoringBundle(bundle) {
    let diagnostics = inspectPlainData(bundle);
    if (!diagnostics.length) {
      try {
        diagnostics = validateDiagramAuthoringBundle(bundle);
      } catch {
        diagnostics = [diagnostic("$", "plain-data", "Bundle could not be inspected as inert JSON data.")];
      }
    }
    return { ok: diagnostics.length === 0, diagnostics };
  }
  var snapshot2 = (bundle) => ({ bundleDigest: bundle.bundleDigest, semanticDigest: bundle.document.documentDigest, presentationDigest: bundle.presentation.presentationDigest });
  var elementIndex = (document2) => new Map(COLLECTIONS.flatMap((collection) => document2[collection].map((value) => [value.id, { collection, value }])));
  var parentIndex = (document2) => new Map([...document2.groups, ...document2.lanes].flatMap((value) => value.members.map((id2) => [id2, value.id])));
  function descendants(document2, ids2) {
    const byId = elementIndex(document2);
    const result = new Set(ids2);
    const pending = [...ids2];
    while (pending.length) for (const member of byId.get(pending.pop())?.value.members ?? []) if (!result.has(member)) {
      result.add(member);
      pending.push(member);
    }
    return [...result];
  }
  function semanticFields(collection, value) {
    if (collection === "document") return clone({ title: value.title, summary: value.summary, audience: value.audience, accessibility: value.accessibility });
    if (collection === "groups" || collection === "lanes") return { label: value.label };
    const { id: _id, ...fields3 } = value;
    return clone(fields3);
  }
  var geometryFields = ({ bounds: bounds2, route: route2, label, zIndex }) => clone({ bounds: bounds2, route: route2, label, zIndex });
  var appearanceFields = ({ appearance: appearance2, locks: locks2 }) => clone({ appearance: appearance2, locks: locks2 });
  var membershipState2 = (document2) => clone({ groups: document2.groups.map(({ id: id2, members }) => ({ id: id2, members })), lanes: document2.lanes.map(({ id: id2, members }) => ({ id: id2, members })), laneOrder: document2.laneOrder });
  function sealBundle(bundle) {
    const result = clone(bundle);
    result.document.documentDigest = diagramDocumentDigest(result.document);
    result.presentation.semanticDigest = result.document.documentDigest;
    if (result.sourceMap) result.sourceMap.semanticDigest = result.document.documentDigest;
    result.presentation.presentationDigest = diagramPresentationDigest(result.presentation);
    result.bundleDigest = diagramAuthoringBundleDigest(result);
    return result;
  }

  // lib/artifact/diagram/authoring/diff.mjs
  function fields(before, after, base, result, path = []) {
    if (same2(before, after)) return;
    if (before && after && !Array.isArray(before) && !Array.isArray(after) && typeof before === "object" && typeof after === "object") {
      for (const key of [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].sort()) fields(before[key], after[key], base, result, [...path, key]);
    } else result.push({ ...base, path, before: before === void 0 ? null : clone(before), after: after === void 0 ? null : clone(after) });
  }
  function records(before, after, collection, identity, result) {
    const old = new Map(before.map((value) => [value[identity], value]));
    const next = new Map(after.map((value) => [value[identity], value]));
    for (const id2 of [.../* @__PURE__ */ new Set([...old.keys(), ...next.keys()])].sort()) {
      const base = { collection, elementId: id2 };
      if (!old.has(id2) || !next.has(id2)) result.push({ ...base, path: [], before: clone(old.get(id2) ?? null), after: clone(next.get(id2) ?? null) });
      else fields(old.get(id2), next.get(id2), base, result);
    }
  }
  function affectedState(before, after, semantic, presentation) {
    const writes = new Set([...semantic, ...presentation].flatMap((change) => change.elementId === null ? [] : [change.elementId]));
    const reads = new Set(writes);
    for (const change of semantic) if (change.collection === "document" && (change.path[0] === "laneOrder" || change.path[0] === "accessibility" && change.path[1] === "readingOrder")) {
      for (const id2 of [...change.before, ...change.after]) reads.add(id2);
    }
    for (const bundle of [before, after]) {
      const document2 = bundle.document;
      const parents = parentIndex(document2);
      for (const id2 of descendants(document2, [...writes])) reads.add(id2);
      for (const edge of document2.relations) if (reads.has(edge.id) || reads.has(edge.from) || reads.has(edge.to)) {
        reads.add(edge.id);
        reads.add(edge.from);
        reads.add(edge.to);
      }
      for (const note of document2.annotations) if (reads.has(note.id) || reads.has(note.targetId)) {
        reads.add(note.id);
        if (note.targetId !== null) reads.add(note.targetId);
      }
      for (const id2 of [...reads]) {
        let parent = parents.get(id2);
        while (parent) {
          reads.add(parent);
          parent = parents.get(parent);
        }
      }
    }
    const readIds = [...reads].sort();
    const writeIds = [...writes].sort();
    return { affectedIds: readIds, readIds, writeIds };
  }
  function diffDiagramBundles(before, after) {
    for (const bundle of [before, after]) {
      const checked = validateAuthoringBundle(bundle);
      if (!checked.ok) return checked;
    }
    if (before.diagramId !== after.diagramId) return failure("$.diagramId", "diagram-id", "Diff requires snapshots of the same diagram.");
    const semantic = [];
    const presentation = [];
    for (const collection of COLLECTIONS) records(before.document[collection], after.document[collection], collection, "id", semantic);
    records(before.document.emphasis, after.document.emphasis, "emphasis", "targetId", semantic);
    for (const field2 of ["title", "summary", "audience", "grammar", "laneOrder", "accessibility"]) fields(before.document[field2], after.document[field2], { collection: "document", elementId: null }, semantic, [field2]);
    records(before.presentation.elements, after.presentation.elements, "elements", "elementId", presentation);
    for (const field2 of ["layout", "theme"]) fields(before.presentation[field2], after.presentation[field2], { collection: "presentation", elementId: null }, presentation, [field2]);
    return { ok: true, semantic, presentation, impact: affectedState(before, after, semantic, presentation) };
  }
  function inverseDependencies(bundle, impact) {
    const elements = elementIndex(bundle.document);
    const parents = parentIndex(bundle.document);
    const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
    const writes = new Set(impact.writeIds);
    const incident = /* @__PURE__ */ new Map();
    const annotations = /* @__PURE__ */ new Map();
    for (const { id: id2, from, to } of bundle.document.relations) for (const endpoint of /* @__PURE__ */ new Set([from, to])) {
      if (!incident.has(endpoint)) incident.set(endpoint, []);
      incident.get(endpoint).push({ id: id2, from, to });
    }
    for (const values of incident.values()) values.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const { id: id2, targetId } of bundle.document.annotations) if (targetId !== null) {
      if (!annotations.has(targetId)) annotations.set(targetId, []);
      annotations.get(targetId).push(id2);
    }
    for (const values of annotations.values()) values.sort();
    return impact.readIds.map((elementId) => {
      const entry2 = elements.get(elementId);
      if (!entry2) return { elementId, value: null };
      if (!writes.has(elementId)) return { elementId, value: clone({ semantic: entry2, placement: placements.get(elementId), parent: parents.get(elementId) ?? null }) };
      const { from, to, targetId, members } = entry2.value;
      return { elementId, value: clone({
        collection: entry2.collection,
        parent: parents.get(elementId) ?? null,
        ...from === void 0 ? {} : { from, to },
        ...targetId === void 0 ? {} : { targetId },
        ...members === void 0 ? {} : { members },
        locks: placements.get(elementId).locks,
        incident: incident.get(elementId) ?? [],
        annotations: annotations.get(elementId) ?? []
      }) };
    });
  }
  function sourceMapChanges(before, after) {
    const changes = [];
    if (before === null || after === null) {
      if (!same2(before, after)) changes.push({ collection: "source-map", elementId: null, path: [], before: clone(before), after: clone(after) });
      return changes;
    }
    for (const key of Object.keys(before).filter((key2) => key2 !== "semanticDigest" && key2 !== "entries")) fields(before[key], after[key], { collection: "source-map", elementId: null }, changes, [key]);
    if (before.entries.length !== after.entries.length) fields(before.entries, after.entries, { collection: "source-map", elementId: null }, changes, ["entries"]);
    else for (let index2 = 0; index2 < before.entries.length; index2++) fields(before.entries[index2], after.entries[index2], { collection: "source-map", elementId: null }, changes, ["entries", String(index2)]);
    return changes;
  }

  // lib/artifact/diagram/authoring/transactions.mjs
  function precondition(actual, expected, path, diagnostics) {
    if (same2(actual, expected)) return true;
    diagnostics.push(diagnostic(path, "precondition", "The current affected value no longer matches the operation before-value."));
    return false;
  }
  function applyOperation(bundle, op, path, diagnostics) {
    const document2 = bundle.document;
    const entries2 = elementIndex(document2);
    const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
    if (op.type === "insert-elements") {
      for (const { value } of op.elements) if (entries2.has(value.id)) diagnostics.push(diagnostic(path, "duplicate-id", `Element ${value.id} already exists.`));
      if (diagnostics.length) return;
      if (op.positions) {
        const positions = new Map(op.positions.map((value) => [value.elementId, value]));
        for (const collection of ["nodes", "relations", "groups", "lanes", "annotations"]) {
          const inserted = op.elements.filter((entry2) => entry2.collection === collection).sort((a, b) => positions.get(a.value.id).semanticIndex - positions.get(b.value.id).semanticIndex);
          let previous2 = -1;
          for (const { value } of inserted) {
            const index2 = positions.get(value.id).semanticIndex;
            if (index2 <= previous2 || index2 > document2[collection].length) {
              diagnostics.push(diagnostic(path, "insertion-position", `Invalid semantic insertion position for ${value.id}.`));
              return;
            }
            document2[collection].splice(index2, 0, clone(value));
            previous2 = index2;
          }
        }
        let previous = -1;
        for (const value of [...op.presentation].sort((a, b) => positions.get(a.elementId).presentationIndex - positions.get(b.elementId).presentationIndex)) {
          const index2 = positions.get(value.elementId).presentationIndex;
          if (index2 <= previous || index2 > bundle.presentation.elements.length) {
            diagnostics.push(diagnostic(path, "insertion-position", `Invalid presentation insertion position for ${value.elementId}.`));
            return;
          }
          bundle.presentation.elements.splice(index2, 0, clone(value));
          previous = index2;
        }
      } else {
        for (const { collection, value } of op.elements) document2[collection].push(clone(value));
        bundle.presentation.elements.push(...clone(op.presentation));
      }
      for (const { collection, value } of op.elements) if (collection === "lanes" && !document2.laneOrder.includes(value.id)) document2.laneOrder.push(value.id);
    } else if (op.type === "remove-elements") {
      for (const { collection, value } of op.elements) {
        const actual = entries2.get(value.id);
        if (!actual || actual.collection !== collection) {
          diagnostics.push(diagnostic(path, "element-class", `Element ${value.id} does not belong to ${collection}.`));
          return;
        }
        if (!precondition(actual.value, value, `${path}.${value.id}`, diagnostics)) return;
      }
      for (const value of op.presentation) if (!precondition(placements.get(value.elementId) ?? null, value, `${path}.${value.elementId}`, diagnostics)) return;
      const ids2 = new Set(op.elements.map((entry2) => entry2.value.id));
      for (const collection of ["nodes", "relations", "groups", "lanes", "annotations"]) document2[collection] = document2[collection].filter((value) => !ids2.has(value.id));
      bundle.presentation.elements = bundle.presentation.elements.filter((value) => !ids2.has(value.elementId));
      document2.laneOrder = document2.laneOrder.filter((id2) => !ids2.has(id2));
    } else if (op.type === "update-semantics") {
      if (op.collection === "source-map") {
        if (precondition(bundle.sourceMap, op.before, path, diagnostics)) bundle.sourceMap = clone(op.after);
      } else if (op.collection === "document") {
        if (precondition(semanticFields("document", document2), op.before, path, diagnostics)) Object.assign(document2, clone(op.after));
      } else if (op.collection === "emphasis") {
        const actual = document2.emphasis.find((value) => value.targetId === op.elementId)?.level ?? null;
        if (!precondition(actual, op.before, path, diagnostics)) return;
        const index2 = document2.emphasis.findIndex((value) => value.targetId === op.elementId);
        if (op.after === null) document2.emphasis.splice(index2, index2 < 0 ? 0 : 1);
        else if (index2 >= 0) document2.emphasis[index2].level = op.after;
        else {
          const target = op.index ?? document2.emphasis.length;
          if (target > document2.emphasis.length) {
            diagnostics.push(diagnostic(path, "insertion-position", "Emphasis insertion index is out of range."));
            return;
          }
          document2.emphasis.splice(target, 0, { targetId: op.elementId, level: op.after });
        }
      } else {
        const entry2 = entries2.get(op.elementId);
        if (!entry2 || entry2.collection !== op.collection) {
          diagnostics.push(diagnostic(path, "element-class", `Element ${op.elementId} does not belong to ${op.collection}.`));
          return;
        }
        if (precondition(semanticFields(op.collection, entry2.value), op.before, path, diagnostics)) Object.assign(entry2.value, clone(op.after));
      }
    } else if (op.type === "set-membership-order") {
      if (!precondition(membershipState2(document2), op.before, path, diagnostics)) return;
      for (const collection of ["groups", "lanes"]) {
        if (!same2(document2[collection].map((value) => value.id).sort(), op.after[collection].map((value) => value.id).sort())) {
          diagnostics.push(diagnostic(path, "containment-reference", "Membership must include exactly the existing containers."));
          return;
        }
        for (const value of op.after[collection]) entries2.get(value.id).value.members = clone(value.members);
      }
      document2.laneOrder = clone(op.after.laneOrder);
    } else {
      const geometry = op.type === "set-geometry";
      for (const change of op.changes) {
        const placement4 = placements.get(change.elementId);
        if (!placement4) {
          diagnostics.push(diagnostic(path, "reference", `Missing placement ${change.elementId}.`));
          return;
        }
        if (!precondition(geometry ? geometryFields(placement4) : appearanceFields(placement4), change.before, `${path}.${change.elementId}`, diagnostics)) return;
        if (geometry) {
          const oldBounds = placement4.bounds;
          const newBounds = change.after.bounds;
          const positionChanged = !same2(oldBounds && { x: oldBounds.x, y: oldBounds.y }, newBounds && { x: newBounds.x, y: newBounds.y }) || !same2(placement4.label, change.after.label) || placement4.zIndex !== change.after.zIndex;
          const sizeChanged = !same2(oldBounds && { width: oldBounds.width, height: oldBounds.height }, newBounds && { width: newBounds.width, height: newBounds.height });
          if (placement4.locks.position && positionChanged || placement4.locks.size && sizeChanged || placement4.locks.route && !same2(placement4.route, change.after.route)) {
            diagnostics.push(diagnostic(`${path}.${change.elementId}`, "geometry-lock", `Geometry is locked for ${change.elementId}; explicitly unlock it first.`));
            return;
          }
        }
        Object.assign(placement4, clone(change.after));
      }
    }
  }
  function containmentIssues(before, after) {
    const oldEntries = elementIndex(before.document);
    const placements = new Map(after.presentation.elements.map((value) => [value.elementId, value]));
    const oldPlacements = new Map(before.presentation.elements.map((value) => [value.elementId, value]));
    const diagnostics = [];
    for (const parent of [...after.document.groups, ...after.document.lanes]) {
      const old = oldEntries.get(parent.id)?.value;
      const bounds2 = placements.get(parent.id)?.bounds;
      const oldBounds = oldPlacements.get(parent.id)?.bounds;
      const childrenChanged = parent.members.some((id2) => !same2(oldPlacements.get(id2)?.bounds, placements.get(id2)?.bounds));
      if (!bounds2 || old && same2(old.members, parent.members) && same2(oldBounds, bounds2) && !childrenChanged) continue;
      for (const id2 of parent.members) {
        const child = placements.get(id2)?.bounds;
        if (child && (child.x < bounds2.x || child.y < bounds2.y || child.x + child.width > bounds2.x + bounds2.width || child.y + child.height > bounds2.y + bounds2.height)) diagnostics.push(diagnostic(`$.presentation.${parent.id}`, "container-bounds", `Container ${parent.id} must contain child ${id2}.`));
      }
    }
    return diagnostics;
  }
  function attachmentPoint(bounds2, attachment2) {
    if (attachment2.side === "left" || attachment2.side === "right") return { x: bounds2.x + (attachment2.side === "right" ? bounds2.width : 0), y: bounds2.y + bounds2.height * attachment2.offset };
    return { x: bounds2.x + bounds2.width * attachment2.offset, y: bounds2.y + (attachment2.side === "bottom" ? bounds2.height : 0) };
  }
  function resolveIncidentRoutes(before, after) {
    const oldEntries = elementIndex(before.document);
    const oldPlacements = new Map(before.presentation.elements.map((value) => [value.elementId, value]));
    const placements = new Map(after.presentation.elements.map((value) => [value.elementId, value]));
    const changes = [];
    for (const relation2 of after.document.relations) {
      const old = oldEntries.get(relation2.id)?.value;
      const placement4 = placements.get(relation2.id);
      if (placement4?.route?.mode !== "manual") continue;
      const from = placements.get(relation2.from)?.bounds;
      const to = placements.get(relation2.to)?.bounds;
      if (!from || !to) continue;
      if (old && old.from === relation2.from && old.to === relation2.to && same2(oldPlacements.get(old.from)?.bounds, from) && same2(oldPlacements.get(old.to)?.bounds, to) && same2(oldPlacements.get(relation2.id)?.route, placement4.route)) continue;
      const geometry = geometryFields(placement4);
      const route2 = geometry.route;
      const start = attachmentPoint(from, route2.from);
      const end = attachmentPoint(to, route2.to);
      if (route2.strategy === "straight") route2.points = [start, end];
      else {
        const interior = route2.points.slice(1, -1);
        const points = [start, ...interior, end];
        const resolved = [points[0]];
        for (let index2 = 1; index2 < points.length; index2++) {
          const previous = resolved.at(-1);
          const next = points[index2];
          if (previous.x !== next.x && previous.y !== next.y) {
            const horizontal = index2 === 1 ? ["left", "right"].includes(route2.from.side) : !["left", "right"].includes(route2.to.side);
            resolved.push(horizontal ? { x: next.x, y: previous.y } : { x: previous.x, y: next.y });
          }
          if (!same2(resolved.at(-1), next)) resolved.push(next);
        }
        route2.points = resolved;
      }
      if (!same2(geometry, geometryFields(placement4))) changes.push({ elementId: relation2.id, before: geometryFields(placement4), after: geometry });
    }
    return changes;
  }
  function derivedSourceMap(before, after) {
    if (!before.sourceMap) return null;
    const map = clone(before.sourceMap);
    const old = elementIndex(before.document);
    const current = elementIndex(after.document);
    for (const entry2 of map.entries) {
      if (!entry2.elementIds.some((id2) => !same2(old.get(id2), current.get(id2)))) continue;
      entry2.elementIds = entry2.elementIds.filter((id2) => current.has(id2));
      entry2.confidence = "ambiguous";
      const loss = "Semantic content changed after this source correspondence was captured.";
      if (!entry2.losses.includes(loss)) entry2.losses.push(loss);
    }
    map.semanticDigest = diagramDocumentDigest(after.document);
    return map;
  }
  function previewDiagramTransaction(bundle, transaction2) {
    const checked = validateAuthoringBundle(bundle);
    if (!checked.ok) return checked;
    let diagnostics;
    try {
      diagnostics = validateDiagramEditTransaction(transaction2);
    } catch {
      return failure("$", "plain-data", "Transaction could not be inspected as inert JSON data.");
    }
    if (diagnostics.length) return { ok: false, diagnostics };
    if (transaction2.diagramId !== bundle.diagramId || !same2(transaction2.base, snapshot2(bundle))) return failure("$.base", "stale-base", "The transaction requires the exact current diagram snapshot.");
    const originalIds = elementIndex(bundle.document);
    for (const op of transaction2.operations) if (op.type === "insert-elements" && op.elements.some((entry2) => originalIds.has(entry2.value.id))) return failure("$.operations", "duplicate-id", "Inserted identities must be fresh even when the same transaction removes an existing element.");
    const next = clone(bundle);
    const canonicalTransaction = clone(transaction2);
    for (const [index2, op] of transaction2.operations.entries()) {
      applyOperation(next, op, `$.operations[${index2}]`, diagnostics);
      if (diagnostics.length) return { ok: false, diagnostics };
    }
    const routes = resolveIncidentRoutes(bundle, next);
    if (routes.some((change) => next.presentation.elements.find((value) => value.elementId === change.elementId).locks.route)) return failure("$.operations", "geometry-lock", "Incident connector routing is locked; explicitly unlock it before changing its attachment.");
    if (routes.length) {
      for (const change of routes) Object.assign(next.presentation.elements.find((value) => value.elementId === change.elementId), change.after);
      canonicalTransaction.operations.push({ type: "set-geometry", changes: routes });
    }
    if (bundle.sourceMap && !transaction2.operations.some((op) => op.type === "update-semantics" && op.collection === "source-map")) {
      const map = derivedSourceMap(bundle, next);
      if (!same2(next.sourceMap, map)) {
        canonicalTransaction.operations.push({ type: "update-semantics", collection: "source-map", before: clone(next.sourceMap), after: map });
        next.sourceMap = map;
      }
    }
    if (next.sourceMap && transaction2.operations.some((op) => op.type === "update-semantics" && op.collection === "source-map") && next.sourceMap.semanticDigest !== diagramDocumentDigest(next.document)) return failure("$.sourceMap.semanticDigest", "basis", "The updated source map must identify the resulting semantic document.");
    const sealed = sealBundle(next);
    diagnostics.push(...containmentIssues(bundle, sealed));
    const finalCheck = validateAuthoringBundle(sealed);
    diagnostics.push(...finalCheck.diagnostics);
    diagnostics.push(...validateDiagramEditTransaction(canonicalTransaction));
    if (diagnostics.length) return { ok: false, diagnostics };
    const diff = diffDiagramBundles(bundle, sealed);
    const positions = [];
    const finalIds = elementIndex(sealed.document);
    for (const [id2, entry2] of elementIndex(bundle.document)) if (!finalIds.has(id2)) positions.push({ elementId: id2, semanticIndex: bundle.document[entry2.collection].findIndex((value) => value.id === id2), presentationIndex: bundle.presentation.elements.findIndex((value) => value.elementId === id2) });
    return {
      ok: true,
      bundle: sealed,
      transaction: canonicalTransaction,
      diff: { semantic: diff.semantic, presentation: diff.presentation },
      impact: diff.impact,
      inverse: {
        diagramId: bundle.diagramId,
        transactionId: transaction2.transactionId,
        changes: { semantic: diff.semantic, presentation: diff.presentation, sourceMap: sourceMapChanges(bundle.sourceMap, sealed.sourceMap) },
        dependencies: inverseDependencies(sealed, diff.impact),
        positions,
        emphasisOrder: bundle.document.emphasis.map((value) => value.targetId)
      }
    };
  }

  // lib/artifact/diagram/authoring/commands.mjs
  var collections = ["nodes", "relations", "groups", "lanes", "annotations"];
  var fields2 = {
    create: ["elements", "presentation"],
    rename: ["id", "label"],
    describe: ["id", "description"],
    reconnect: ["id", "from", "to"],
    move: ["ids", "dx", "dy"],
    resize: ["id", "bounds"],
    geometry: ["changes"],
    appearance: ["changes"],
    reparent: ["ids", "parentId", "index"],
    group: ["group", "ids", "placement", "parentId"],
    ungroup: ["ids"],
    "reorder-lanes": ["ids"],
    duplicate: ["ids", "idMap", "dx", "dy"],
    paste: ["sourceBundle", "ids", "idMap", "dx", "dy"],
    delete: ["ids", "confirmedImpact"],
    cancel: []
  };
  var fail = (rule, detail, path = "$command") => ({ ok: false, diagnostics: [{ path, rule, detail }] });
  var entries = (document2) => collections.flatMap((collection) => document2[collection].map((value) => ({ collection, value })));
  var placement2 = (bundle, id2) => bundle.presentation.elements.find((value) => value.elementId === id2);
  var entry = (bundle, id2) => entries(bundle.document).find((item) => item.value.id === id2);
  var documentFields = (doc) => clone({ title: doc.title, summary: doc.summary, audience: doc.audience, accessibility: doc.accessibility });
  function requireValue(condition, message) {
    if (!condition) throw new TypeError(message);
  }
  function selected(bundle, ids2) {
    requireValue(Array.isArray(ids2) && ids2.length > 0 && ids2.length <= 1e4 && new Set(ids2).size === ids2.length, "Select distinct element IDs.");
    const byId = new Map(entries(bundle.document).map((item) => [item.value.id, item]));
    requireValue(ids2.every((id2) => typeof id2 === "string" && byId.has(id2)), "A selected element is missing.");
    return byId;
  }
  function closure(bundle, ids2) {
    const byId = selected(bundle, ids2), found = new Set(ids2), queue = [...ids2];
    for (let i = 0; i < queue.length; i++) {
      const value = byId.get(queue[i]).value;
      for (const id2 of value.members ?? []) if (!found.has(id2)) {
        found.add(id2);
        queue.push(id2);
      }
    }
    return found;
  }
  function parentMap(document2) {
    return new Map([...document2.groups, ...document2.lanes].flatMap((item) => item.members.map((id2) => [id2, item.id])));
  }
  function roots(bundle, ids2) {
    selected(bundle, ids2);
    const chosen = new Set(ids2), parents = parentMap(bundle.document);
    return ids2.filter((id2) => {
      let parent = parents.get(id2);
      while (parent) {
        if (chosen.has(parent)) return false;
        parent = parents.get(parent);
      }
      return true;
    });
  }
  var membershipOp = (before, after) => ({ type: "set-membership-order", before, after });
  var semanticOp = (item, after) => ({ type: "update-semantics", collection: item.collection, elementId: item.value.id, before: semanticFields(item.collection, item.value), after });
  function translate(geometry, dx, dy) {
    const next = clone(geometry);
    if (next.bounds) {
      next.bounds.x += dx;
      next.bounds.y += dy;
    }
    if (next.route?.mode === "manual") next.route.points = next.route.points.map((point2) => ({ x: point2.x + dx, y: point2.y + dy }));
    if (next.label) {
      next.label.x += dx;
      next.label.y += dy;
    }
    return next;
  }
  function reparent(bundle, ids2, parentId, index2) {
    const chosen = roots(bundle, ids2), selectedClosure = closure(bundle, chosen);
    const parent = parentId === null ? null : entry(bundle, parentId);
    requireValue(parentId === null || ["groups", "lanes"].includes(parent?.collection), "Choose a container or the diagram root as parent.");
    requireValue(!selectedClosure.has(parentId), "A container cannot contain itself or its ancestor.");
    requireValue(chosen.every((id2) => entry(bundle, id2).collection !== "relations"), "Connectors cannot become container members.");
    const before = membershipState2(bundle.document), after = clone(before);
    for (const container2 of [...after.groups, ...after.lanes]) container2.members = container2.members.filter((id2) => !chosen.includes(id2));
    if (parent) {
      const container2 = [...after.groups, ...after.lanes].find((item) => item.id === parentId);
      const offset = index2 === void 0 ? container2.members.length : index2;
      requireValue(Number.isInteger(offset) && offset >= 0 && offset <= container2.members.length, "Membership insertion index is outside the container.");
      container2.members.splice(offset, 0, ...chosen);
    } else requireValue(index2 === void 0, "Root placement does not have a membership index.");
    return membershipOp(before, after);
  }
  function removal(bundle, ids2, ungroup = false) {
    selected(bundle, ids2);
    const removed = ungroup ? new Set(ids2) : closure(bundle, ids2);
    if (ungroup) requireValue(ids2.every((id2) => ["groups", "lanes"].includes(entry(bundle, id2).collection)), "Ungroup selects containers only.");
    if (!ungroup) {
      for (const edge of bundle.document.relations) if (removed.has(edge.from) || removed.has(edge.to)) removed.add(edge.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const note of bundle.document.annotations) if (removed.has(note.targetId) && !removed.has(note.id)) {
          removed.add(note.id);
          changed = true;
        }
      }
    }
    const before = membershipState2(bundle.document), after = clone(before);
    const byId = new Map(entries(bundle.document).map((item) => [item.value.id, item]));
    function retain(id2) {
      return removed.has(id2) ? ungroup ? (byId.get(id2).value.members ?? []).flatMap(retain) : [] : [id2];
    }
    for (const container2 of [...after.groups, ...after.lanes]) container2.members = removed.has(container2.id) ? [] : container2.members.flatMap(retain);
    const operations = [membershipOp(before, after)];
    const readingOrderIds = bundle.document.accessibility.readingOrder.filter((id2) => removed.has(id2));
    if (readingOrderIds.length) {
      const beforeDocument = documentFields(bundle.document), afterDocument = clone(beforeDocument);
      afterDocument.accessibility.readingOrder = afterDocument.accessibility.readingOrder.filter((id2) => !removed.has(id2));
      operations.push({ type: "update-semantics", collection: "document", before: beforeDocument, after: afterDocument });
    }
    for (const emphasis2 of bundle.document.emphasis) if (removed.has(emphasis2.targetId)) operations.push({ type: "update-semantics", collection: "emphasis", elementId: emphasis2.targetId, before: emphasis2.level, after: null });
    if (ungroup) {
      for (const note of bundle.document.annotations) if (removed.has(note.targetId)) operations.push(semanticOp({ collection: "annotations", value: note }, { text: note.text, targetId: null }));
    }
    const elements = entries(bundle.document).filter((item) => removed.has(item.value.id)).map((item) => ({ collection: item.collection, value: { ...clone(item.value), ...item.value.members ? { members: [] } : {} } }));
    operations.push({ type: "remove-elements", elements, presentation: bundle.presentation.elements.filter((item) => removed.has(item.elementId)).map(clone) });
    const impact = {
      elementIds: [...removed].sort(),
      relationIds: bundle.document.relations.filter((item) => removed.has(item.id)).map((item) => item.id).sort(),
      annotationIds: bundle.document.annotations.filter((item) => removed.has(item.id) || removed.has(item.targetId)).map((item) => item.id).sort(),
      membershipIds: [...before.groups, ...before.lanes].filter((item) => removed.has(item.id) || item.members.some((id2) => removed.has(id2))).map((item) => item.id).sort(),
      readingOrderIds: [...readingOrderIds].sort(),
      emphasisIds: bundle.document.emphasis.filter((item) => removed.has(item.targetId)).map((item) => item.targetId).sort()
    };
    return { operations, impact };
  }
  function duplicate(bundle, command) {
    const source = command.type === "paste" ? command.sourceBundle : bundle;
    const validation = validateAuthoringBundle(source);
    requireValue(validation.ok, "The copied diagram bundle is invalid.");
    const copied = closure(source, command.ids);
    for (const relation2 of source.document.relations) if (copied.has(relation2.from) && copied.has(relation2.to)) copied.add(relation2.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const note of source.document.annotations) if (copied.has(note.targetId) && !copied.has(note.id)) {
        copied.add(note.id);
        changed = true;
      }
    }
    const excludedRelationIds = source.document.relations.filter((item) => (copied.has(item.id) || copied.has(item.from) || copied.has(item.to)) && !(copied.has(item.from) && copied.has(item.to))).map((item) => item.id);
    excludedRelationIds.forEach((id2) => copied.delete(id2));
    const idMap = command.idMap;
    requireValue(idMap && !Array.isArray(idMap) && typeof idMap === "object" && same2(Object.keys(idMap).sort(), [...copied].sort()), "Supply exactly one fresh ID for every copied element, including internal connectors and attached annotations.");
    const fresh = Object.values(idMap), existing = new Set(entries(bundle.document).map((item) => item.value.id));
    requireValue(fresh.every((id2) => typeof id2 === "string" && !existing.has(id2)) && new Set(fresh).size === fresh.length, "Copied element IDs must be fresh and distinct.");
    const dx = command.dx === void 0 ? 0 : command.dx, dy = command.dy === void 0 ? 0 : command.dy;
    requireValue(Number.isFinite(dx) && Number.isFinite(dy), "Copy offsets must be finite numbers.");
    const detachedAnnotationIds = [];
    const elements = entries(source.document).filter((item) => copied.has(item.value.id)).map((item) => {
      const value = clone(item.value);
      value.id = idMap[value.id];
      if (value.members) value.members = value.members.filter((id2) => copied.has(id2)).map((id2) => idMap[id2]);
      if (item.collection === "relations") {
        value.from = idMap[value.from];
        value.to = idMap[value.to];
      }
      if (item.collection === "annotations" && value.targetId !== null) {
        if (!copied.has(value.targetId)) detachedAnnotationIds.push(item.value.id);
        value.targetId = Object.hasOwn(idMap, value.targetId) ? idMap[value.targetId] : null;
      }
      return { collection: item.collection, value };
    });
    requireValue(elements.length > 0, "Selection has no self-contained elements to copy.");
    const presentation = source.presentation.elements.filter((item) => copied.has(item.elementId)).map((item) => ({ ...clone(item), ...translate(geometryFields(item), dx, dy), elementId: idMap[item.elementId] }));
    const operations = [{ type: "insert-elements", elements, presentation }];
    const before = membershipState2(bundle.document);
    for (const collection of ["groups", "lanes"]) before[collection].push(...elements.filter((item) => item.collection === collection).map((item) => ({ id: item.value.id, members: [...item.value.members] })));
    before.laneOrder.push(...elements.filter((item) => item.collection === "lanes").map((item) => item.value.id));
    const after = clone(before);
    after.laneOrder = [...bundle.document.laneOrder, ...source.document.laneOrder.filter((id2) => copied.has(id2)).map((id2) => idMap[id2])];
    operations.push(membershipOp(before, after));
    for (const item of source.document.emphasis) if (copied.has(item.targetId)) operations.push({ type: "update-semantics", collection: "emphasis", elementId: idMap[item.targetId], before: null, after: item.level });
    const beforeDocument = documentFields(bundle.document), afterDocument = clone(beforeDocument);
    afterDocument.accessibility.readingOrder.push(...source.document.accessibility.readingOrder.filter((id2) => copied.has(id2)).map((id2) => idMap[id2]));
    operations.push({ type: "update-semantics", collection: "document", before: beforeDocument, after: afterDocument });
    return { operations, disclosures: { excludedRelationIds: excludedRelationIds.sort(), detachedAnnotationIds: detachedAnnotationIds.sort() } };
  }
  function compileDiagramCommand(bundle, command, options = {}) {
    const validation = validateAuthoringBundle(bundle);
    if (!validation.ok) return validation;
    const diagnostics = [...inspectPlainData(command, ["$.idMap"]), ...inspectPlainData(options)];
    if (diagnostics.length) return { ok: false, diagnostics };
    if (!command || typeof command !== "object" || Array.isArray(command) || !Object.hasOwn(fields2, command.type)) return fail("command", "Unknown diagram command.");
    if (Object.keys(command).some((key) => key !== "type" && !fields2[command.type].includes(key))) return fail("command-field", "The command contains an unsupported field.");
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "transactionId")) return fail("options", "Only a caller-supplied transactionId is accepted.", "$options");
    if (command.type === "cancel") return { ok: true, cancelled: true, transaction: null };
    let operations, disclosures;
    try {
      switch (command.type) {
        case "create":
          operations = [{ type: "insert-elements", elements: clone(command.elements), presentation: clone(command.presentation) }];
          break;
        case "rename":
        case "describe":
        case "reconnect": {
          const item = entry(bundle, command.id);
          requireValue(item, "The edited element is missing.");
          const before = semanticFields(item.collection, item.value), after = clone(before);
          if (command.type === "rename") {
            requireValue(typeof command.label === "string", "The label must be text.");
            if (item.collection === "annotations") after.text = command.label;
            else after.label = command.label;
          } else if (command.type === "describe") {
            requireValue(item.collection === "nodes", "Descriptions belong to nodes.");
            after.description = command.description;
          } else {
            requireValue(item.collection === "relations", "Reconnect selects a connector.");
            after.from = command.from;
            after.to = command.to;
          }
          operations = [semanticOp(item, after)];
          break;
        }
        case "move": {
          requireValue(Number.isFinite(command.dx) && Number.isFinite(command.dy), "Movement offsets must be finite numbers.");
          const moved = closure(bundle, command.ids);
          for (const relation2 of bundle.document.relations) if (moved.has(relation2.from) && moved.has(relation2.to)) moved.add(relation2.id);
          operations = [{ type: "set-geometry", changes: bundle.presentation.elements.filter((item) => moved.has(item.elementId)).map((item) => ({ elementId: item.elementId, before: geometryFields(item), after: translate(geometryFields(item), command.dx, command.dy) })) }];
          break;
        }
        case "resize": {
          const current = placement2(bundle, command.id);
          requireValue(current?.bounds, "Resize selects a bounded element.");
          operations = [{ type: "set-geometry", changes: [{ elementId: command.id, before: geometryFields(current), after: { ...geometryFields(current), bounds: clone(command.bounds) } }] }];
          break;
        }
        case "geometry":
          operations = [{ type: "set-geometry", changes: clone(command.changes) }];
          break;
        case "appearance":
          operations = [{ type: "set-appearance-locks", changes: clone(command.changes) }];
          break;
        case "reparent":
          operations = [reparent(bundle, command.ids, command.parentId, command.index)];
          break;
        case "reorder-lanes": {
          requireValue(Array.isArray(command.ids) && same2([...command.ids].sort(), bundle.document.lanes.map((item) => item.id).sort()), "Lane order must include every lane exactly once.");
          const before = membershipState2(bundle.document);
          operations = [membershipOp(before, { ...clone(before), laneOrder: [...command.ids] })];
          break;
        }
        case "group": {
          requireValue(command.group && same2(Object.keys(command.group).sort(), ["id", "label"]), "A new group requires only its ID and label.");
          const chosen = roots(bundle, command.ids), parents = parentMap(bundle.document);
          const parentIds = new Set(chosen.map((id2) => parents.get(id2) ?? null));
          const parentId = Object.hasOwn(command, "parentId") ? command.parentId : parentIds.size === 1 ? [...parentIds][0] : null;
          const group = { ...clone(command.group), members: [] };
          const temporary = clone(bundle);
          temporary.document.groups.push(group);
          temporary.presentation.elements.push(clone(command.placement));
          requireValue(command.placement?.elementId === group.id, "The group placement must identify the new group.");
          const intoGroup = reparent(temporary, chosen, group.id);
          for (const container2 of [...intoGroup.after.groups, ...intoGroup.after.lanes]) if (container2.id === parentId) container2.members.push(group.id);
          requireValue(parentId === null || [...intoGroup.after.groups, ...intoGroup.after.lanes].some((item) => item.id === parentId), "The group parent is missing.");
          operations = [{ type: "insert-elements", elements: [{ collection: "groups", value: group }], presentation: [clone(command.placement)] }, intoGroup];
          break;
        }
        case "ungroup":
          operations = removal(bundle, command.ids, true).operations;
          break;
        case "delete": {
          const preview2 = removal(bundle, command.ids);
          if (!same2(command.confirmedImpact ?? null, preview2.impact)) return { ...fail("confirmation-required", "Confirm the complete deletion impact before compiling this transaction."), deletionImpact: preview2.impact };
          operations = preview2.operations;
          disclosures = { deletionImpact: preview2.impact };
          break;
        }
        case "duplicate":
        case "paste":
          ({ operations, disclosures } = duplicate(bundle, command));
          break;
        default:
          return fail("command", "Unknown diagram command.");
      }
      operations = operations.filter((op) => !Object.hasOwn(op, "before") || !same2(op.before, op.after));
      if (!operations.length) return { ok: true, changed: false, transaction: null };
      const transaction2 = { kind: "diagram-edit-transaction", schemaVersion: "1.0.0", protocolVersion: "1.13.0", transactionId: options.transactionId, diagramId: bundle.diagramId, base: snapshot2(bundle), operations, undoOf: null };
      const result = previewDiagramTransaction(bundle, transaction2);
      return disclosures ? { ...result, disclosures } : result;
    } catch (error2) {
      return fail("command-value", error2 instanceof TypeError ? error2.message : "The command cannot be compiled.");
    }
  }

  // lib/artifact/diagram/authoring/undo.mjs
  function record(bundle, change) {
    if (change.collection === "source-map") return bundle.sourceMap;
    if (change.collection === "document") return bundle.document;
    if (change.collection === "presentation") return bundle.presentation;
    if (change.collection === "elements") return bundle.presentation.elements.find((value) => value.elementId === change.elementId) ?? null;
    if (change.collection === "emphasis") return bundle.document.emphasis.find((value) => value.targetId === change.elementId) ?? null;
    return bundle.document[change.collection]?.find((value) => value.id === change.elementId) ?? null;
  }
  var atPath = (value, path) => path.reduce((current, key) => current?.[key], value);
  function restoreChange(bundle, change, positions, emphasisOrder) {
    if (!change.path.length) {
      if (change.collection === "source-map") {
        bundle.sourceMap = clone(change.before);
        return;
      }
      const collection = change.collection === "elements" ? bundle.presentation.elements : bundle.document[change.collection];
      const key = change.collection === "elements" ? "elementId" : change.collection === "emphasis" ? "targetId" : "id";
      const index2 = collection.findIndex((value2) => value2[key] === change.elementId);
      if (index2 >= 0) collection.splice(index2, 1);
      if (change.before !== null) {
        const position = positions.find((value2) => value2.elementId === change.elementId);
        const requested = change.collection === "emphasis" ? emphasisOrder.indexOf(change.elementId) : position?.[change.collection === "elements" ? "presentationIndex" : "semanticIndex"];
        collection.splice(requested === void 0 || requested < 0 ? collection.length : Math.min(requested, collection.length), 0, clone(change.before));
      }
      return;
    }
    const value = record(bundle, change);
    const parent = atPath(value, change.path.slice(0, -1));
    parent[change.path.at(-1)] = clone(change.before);
  }
  function validateInverse(value) {
    const diagnostics = inspectPlainData(value);
    if (diagnostics.length) return diagnostics;
    const fail5 = (detail) => [diagnostic("$.inverse", "inverse-shape", detail)];
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.diagramId !== "string" || typeof value.transactionId !== "string" || !value.changes || !Array.isArray(value.dependencies) || !Array.isArray(value.positions) || !Array.isArray(value.emphasisOrder)) return fail5("Expected conditional inverse data from a successful preview.");
    if (Object.keys(value).some((key) => !["diagramId", "transactionId", "changes", "dependencies", "positions", "emphasisOrder"].includes(key))) return fail5("Unknown inverse field.");
    for (const name of ["semantic", "presentation", "sourceMap"]) {
      if (!Array.isArray(value.changes[name])) return fail5("Inverse change lists are required.");
      for (const change of value.changes[name]) if (!change || typeof change.collection !== "string" || ![...COLLECTIONS, "document", "emphasis", "elements", "presentation", "source-map"].includes(change.collection) || change.elementId !== null && typeof change.elementId !== "string" || !Array.isArray(change.path) || change.path.some((key) => typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) || !Object.hasOwn(change, "before") || !Object.hasOwn(change, "after")) return fail5("Malformed inverse change.");
    }
    if (value.dependencies.some((item) => !item || typeof item.elementId !== "string" || !Object.hasOwn(item, "value"))) return fail5("Malformed inverse dependency.");
    if (value.positions.some((item) => !item || typeof item.elementId !== "string" || !Number.isInteger(item.semanticIndex) || item.semanticIndex < 0 || !Number.isInteger(item.presentationIndex) || item.presentationIndex < 0)) return fail5("Malformed inverse insertion position.");
    return [];
  }
  function compileCompensation(current, target, inverse, transactionId) {
    const working = clone(current);
    const operations = [];
    const diagnostics = [];
    const add = (operation2) => {
      operations.push(operation2);
      applyOperation(working, operation2, "$.inverse", diagnostics);
    };
    const oldEntries = elementIndex(current.document);
    const targetEntries = elementIndex(target.document);
    const targetPlacements = new Map(target.presentation.elements.map((value) => [value.elementId, value]));
    const unlock = current.presentation.elements.flatMap((placement4) => {
      const wanted = targetPlacements.get(placement4.elementId);
      if (!wanted || same2(geometryFields(placement4), geometryFields(wanted)) || !Object.values(placement4.locks).some(Boolean)) return [];
      return [{ elementId: placement4.elementId, before: appearanceFields(placement4), after: { appearance: clone(placement4.appearance), locks: { position: false, size: false, route: false } } }];
    });
    if (unlock.length) add({ type: "set-appearance-locks", changes: unlock });
    const removed = [...oldEntries].filter(([id2]) => !targetEntries.has(id2));
    if (removed.length) add({ type: "remove-elements", elements: removed.map(([, entry2]) => clone(entry2)), presentation: working.presentation.elements.filter((value) => removed.some(([id2]) => id2 === value.elementId)).map(clone) });
    const inserted = [...targetEntries].filter(([id2]) => !oldEntries.has(id2));
    if (inserted.length) add({ type: "insert-elements", elements: inserted.map(([, entry2]) => ({ collection: entry2.collection, value: { ...clone(entry2.value), ...entry2.value.members ? { members: [] } : {} } })), presentation: inserted.map(([id2]) => clone(targetPlacements.get(id2))), positions: inserted.map(([id2, entry2]) => ({ elementId: id2, semanticIndex: target.document[entry2.collection].findIndex((value) => value.id === id2), presentationIndex: target.presentation.elements.findIndex((value) => value.elementId === id2) })) });
    const workingEntries = elementIndex(working.document);
    for (const [id2, entry2] of targetEntries) {
      const currentEntry = workingEntries.get(id2);
      if (!same2(semanticFields(entry2.collection, currentEntry.value), semanticFields(entry2.collection, entry2.value))) add({ type: "update-semantics", collection: entry2.collection, elementId: id2, before: semanticFields(entry2.collection, currentEntry.value), after: semanticFields(entry2.collection, entry2.value) });
    }
    if (!same2(membershipState2(working.document), membershipState2(target.document))) add({ type: "set-membership-order", before: membershipState2(working.document), after: membershipState2(target.document) });
    if (!same2(semanticFields("document", working.document), semanticFields("document", target.document))) add({ type: "update-semantics", collection: "document", before: semanticFields("document", working.document), after: semanticFields("document", target.document) });
    const emphasisIds = [...new Set([...working.document.emphasis, ...target.document.emphasis].map((value) => value.targetId))];
    emphasisIds.sort((left, right) => target.document.emphasis.findIndex((value) => value.targetId === left) - target.document.emphasis.findIndex((value) => value.targetId === right));
    for (const id2 of emphasisIds) {
      const before = working.document.emphasis.find((value) => value.targetId === id2)?.level ?? null;
      const after = target.document.emphasis.find((value) => value.targetId === id2)?.level ?? null;
      if (before !== after) add({ type: "update-semantics", collection: "emphasis", elementId: id2, before, after, ...before === null && after !== null ? { index: target.document.emphasis.findIndex((value) => value.targetId === id2) } : {} });
    }
    const geometry = [];
    const appearance2 = [];
    for (const placement4 of working.presentation.elements) {
      const wanted = targetPlacements.get(placement4.elementId);
      if (!same2(geometryFields(placement4), geometryFields(wanted))) geometry.push({ elementId: placement4.elementId, before: geometryFields(placement4), after: geometryFields(wanted) });
      if (!same2(appearanceFields(placement4), appearanceFields(wanted))) appearance2.push({ elementId: placement4.elementId, before: appearanceFields(placement4), after: appearanceFields(wanted) });
    }
    if (geometry.length) add({ type: "set-geometry", changes: geometry });
    if (appearance2.length) add({ type: "set-appearance-locks", changes: appearance2 });
    if (!same2(working.sourceMap, target.sourceMap)) add({ type: "update-semantics", collection: "source-map", before: clone(working.sourceMap), after: clone(target.sourceMap) });
    if (diagnostics.length) return { ok: false, diagnostics };
    if (!operations.length) return failure("$.inverse", "no-change", "This inverse has no remaining content change.");
    return { ok: true, transaction: { kind: "diagram-edit-transaction", schemaVersion: "1.0.0", protocolVersion: "1.13.0", diagramId: current.diagramId, transactionId, base: snapshot2(current), operations, undoOf: inverse.transactionId } };
  }
  function createConditionalInverse(current, inverse, options) {
    const checked = validateAuthoringBundle(current);
    if (!checked.ok) return checked;
    const diagnostics = [...validateInverse(inverse), ...inspectPlainData(options)];
    if (diagnostics.length) return { ok: false, diagnostics };
    if (!options || typeof options !== "object" || Object.keys(options).some((key) => key !== "transactionId") || typeof options.transactionId !== "string") return failure("$.options", "inverse-shape", "Supply only a fresh transactionId.");
    if (current.diagramId !== inverse.diagramId) return failure("$.diagramId", "diagram-id", "Inverse belongs to a different diagram.");
    const changes = [...inverse.changes.semantic, ...inverse.changes.presentation, ...inverse.changes.sourceMap];
    for (const change of changes) if (!same2(atPath(record(current, change), change.path), change.after)) diagnostics.push(diagnostic(`$.inverse.${change.elementId ?? change.collection}`, "inverse-conflict", "An affected field changed after the original transaction."));
    const writeIds = [...new Set([...inverse.changes.semantic, ...inverse.changes.presentation].flatMap((change) => change.elementId === null ? [] : [change.elementId]))];
    const actual = inverseDependencies(current, { readIds: inverse.dependencies.map((item) => item.elementId), writeIds });
    if (!same2(actual, inverse.dependencies)) diagnostics.push(diagnostic("$.inverse.dependencies", "inverse-conflict", "An affected dependency changed after the original transaction."));
    if (diagnostics.length) return { ok: false, diagnostics };
    const target = clone(current);
    try {
      const structural = changes.filter((change) => !change.path.length);
      const patches = changes.filter((change) => change.path.length);
      for (const change of structural.filter((change2) => change2.before === null)) restoreChange(target, change, inverse.positions, inverse.emphasisOrder);
      const inserts = structural.filter((change) => change.before !== null).sort((a, b) => {
        const position = (change) => change.collection === "elements" ? inverse.positions.find((value) => value.elementId === change.elementId)?.presentationIndex : change.collection === "emphasis" ? inverse.emphasisOrder.indexOf(change.elementId) : inverse.positions.find((value) => value.elementId === change.elementId)?.semanticIndex;
        return (position(a) ?? 0) - (position(b) ?? 0);
      });
      for (const change of [...inserts, ...patches]) restoreChange(target, change, inverse.positions, inverse.emphasisOrder);
    } catch {
      return failure("$.inverse", "inverse-shape", "Inverse fields cannot be restored in the current diagram.");
    }
    let sealed;
    try {
      sealed = sealBundle(target);
    } catch {
      return failure("$.inverse", "inverse-shape", "Inverse fields do not describe a complete diagram.");
    }
    const validTarget = validateAuthoringBundle(sealed);
    if (!validTarget.ok) return validTarget;
    const compiled = compileCompensation(current, sealed, inverse, options.transactionId);
    if (!compiled.ok) return compiled;
    const preview2 = previewDiagramTransaction(current, compiled.transaction);
    if (!preview2.ok) return preview2;
    if (!same2(preview2.bundle, sealed)) return failure("$.inverse", "inverse-conflict", "Compensation would alter content beyond the guarded inverse.");
    return { ok: true, transaction: preview2.transaction };
  }

  // lib/artifact/diagram/errors.mjs
  var DIAGRAM_ERROR_CODES = Object.freeze({
    ACCESSIBILITY_INVALID: "E_DIAGRAM_ACCESSIBILITY_INVALID",
    GRAMMAR_AMBIGUOUS: "E_DIAGRAM_GRAMMAR_AMBIGUOUS",
    GRAMMAR_RULE_INVALID: "E_DIAGRAM_GRAMMAR_RULE_INVALID",
    GRAMMAR_UNKNOWN: "E_DIAGRAM_GRAMMAR_UNKNOWN",
    MERMAID_INVALID: "E_DIAGRAM_MERMAID_INVALID",
    MERMAID_TOO_LARGE: "E_DIAGRAM_MERMAID_TOO_LARGE",
    OUTPUT_CONFLICT: "E_DIAGRAM_OUTPUT_CONFLICT",
    OUTPUT_ESCAPE: "E_DIAGRAM_OUTPUT_ESCAPE",
    OUTPUT_LOCKED: "E_DIAGRAM_OUTPUT_LOCKED",
    PNG_INVALID: "E_DIAGRAM_PNG_INVALID",
    PROJECTION_UNSUPPORTED: "E_DIAGRAM_PROJECTION_UNSUPPORTED",
    REFERENCE_CUSTODY_INVALID: "E_DIAGRAM_REFERENCE_CUSTODY_INVALID",
    RENDER_FAILED: "E_DIAGRAM_RENDER_FAILED",
    RESOURCE_BUDGET_EXCEEDED: "E_DIAGRAM_RESOURCE_BUDGET_EXCEEDED",
    SCENE_INVALID: "E_DIAGRAM_SCENE_INVALID",
    SCHEMA_INVALID: "E_DIAGRAM_SCHEMA_INVALID",
    SOURCE_CONFLICT: "E_DIAGRAM_SOURCE_CONFLICT"
  });
  var DiagramError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "DiagramError";
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  };
  function diagramFail(code, message, details) {
    throw new DiagramError(code, message, details);
  }

  // lib/artifact/diagram/rendering/theme.mjs
  var DIAGRAM_RENDERER = Object.freeze({
    id: "openplanr-semantic-svg-resvg",
    version: "1.3.0"
  });
  var DIAGRAM_THEME = Object.freeze({
    id: "openplanr-default",
    version: "1.0.0",
    background: "#ffffff",
    surface: "#f8fafc",
    foreground: "#0f172a",
    border: "#475569",
    accent: "#2563eb",
    muted: "#64748b",
    fontFamily: "Inter",
    fontSize: 16
  });
  var DASHED_RELATION_KINDS = Object.freeze(/* @__PURE__ */ new Set(["dependency", "association"]));
  var RASTER_SCALE = 2;
  var MAX_VISIBLE_LABEL_CHARACTERS = 2048;
  var MAX_DIAGRAM_SCENE_EXTENT = 16384;

  // lib/artifact/diagram/rendering/layout.mjs
  var GROUP_PADDING = Object.freeze({ side: 28, top: 46, bottom: 28 });
  var MAX_BAND_EXTENT = MAX_DIAGRAM_SCENE_EXTENT / RASTER_SCALE;
  var CHARACTERS_PER_LINE = 32;
  var UNBREAKABLE_WORD_LENGTH = 20;
  var LANE_PADDING = Object.freeze({ title: 40, edge: 26 });
  function wrapDiagramLabel(label, maximum = CHARACTERS_PER_LINE) {
    const value = String(label).normalize("NFC");
    if (value.length > MAX_VISIBLE_LABEL_CHARACTERS) {
      diagramFail(DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED, "Diagram label exceeds the renderer text budget.", {
        characters: value.length,
        maximum: MAX_VISIBLE_LABEL_CHARACTERS,
        repair: "Shorten the label or move supporting detail into the item description."
      });
    }
    const lines = [];
    for (const paragraph of value.split(/\r?\n/u)) {
      const words = paragraph.trim().split(/\s+/u).filter(Boolean);
      if (words.length === 0) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const word of words) {
        if (word.length > Math.max(maximum, UNBREAKABLE_WORD_LENGTH)) {
          if (current) lines.push(current);
          for (let offset = 0; offset < word.length; offset += maximum) lines.push(word.slice(offset, offset + maximum));
          current = "";
        } else if (word.length > maximum) {
          if (current) lines.push(current);
          lines.push(word);
          current = "";
        } else if (!current) current = word;
        else if (`${current} ${word}`.length <= maximum) current = `${current} ${word}`;
        else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }
    return lines.length > 0 ? lines : [""];
  }

  // lib/artifact/diagram/authoring/scene.mjs
  var AUTHORED_MINIMUM_FONT_SIZE = 12;
  var issue = (rule, detail, elementIds = [], severity = "error") => ({ path: "$.presentation", rule, detail, elementIds, severity });
  var epsilon = 1e-7;
  function resolveShapeAttachment(bounds2, shape2, attachment2) {
    const { x, y, width, height } = bounds2;
    const cx = x + width / 2, cy = y + height / 2;
    const vertical = attachment2.side === "left" || attachment2.side === "right";
    const sign = attachment2.side === "left" || attachment2.side === "top" ? -1 : 1;
    let px = vertical ? cx + sign * width / 2 : x + width * attachment2.offset;
    let py = vertical ? y + height * attachment2.offset : cy + sign * height / 2;
    if (shape2 === "ellipse" || shape2 === "diamond") {
      const relative = vertical ? Math.abs((py - cy) / (height / 2)) : Math.abs((px - cx) / (width / 2));
      const scale = shape2 === "ellipse" ? Math.sqrt(Math.max(0, 1 - relative ** 2)) : Math.max(0, 1 - relative);
      if (vertical) px = cx + sign * width / 2 * scale;
      else py = cy + sign * height / 2 * scale;
    } else if (shape2 === "rounded-rectangle") {
      const radius = Math.min(14, width / 2, height / 2);
      if (vertical && (py < y + radius || py > y + height - radius)) {
        const center = py < cy ? y + radius : y + height - radius;
        px = cx + sign * (width / 2 - radius + Math.sqrt(Math.max(0, radius ** 2 - (py - center) ** 2)));
      } else if (!vertical && (px < x + radius || px > x + width - radius)) {
        const center = px < cx ? x + radius : x + width - radius;
        py = cy + sign * (height / 2 - radius + Math.sqrt(Math.max(0, radius ** 2 - (px - center) ** 2)));
      }
    } else if (shape2 === "cylinder") {
      const cap = Math.min(12, height / 4);
      if (!vertical) py = (sign < 0 ? y + cap : y + height - cap) + sign * cap * Math.sqrt(Math.max(0, 1 - ((px - cx) / (width / 2)) ** 2));
      else if (py < y + cap || py > y + height - cap) {
        const center = py < cy ? y + cap : y + height - cap;
        px = cx + sign * width / 2 * Math.sqrt(Math.max(0, 1 - ((py - center) / cap) ** 2));
      }
    }
    return { x: px, y: py };
  }
  function orthogonal(points, fromSide, toSide) {
    const result = [points[0]];
    for (let index2 = 1; index2 < points.length; index2++) {
      const previous = result.at(-1), next = points[index2];
      if (Math.abs(previous.x - next.x) > epsilon && Math.abs(previous.y - next.y) > epsilon) {
        const horizontal = index2 === 1 ? ["left", "right"].includes(fromSide) : !["left", "right"].includes(toSide);
        result.push(horizontal ? { x: next.x, y: previous.y } : { x: previous.x, y: next.y });
      }
      if (!same2(result.at(-1), next)) result.push(next);
    }
    return result;
  }
  function routePoints(relation2, placement4, placements) {
    const route2 = placement4.route;
    const from = placements.get(relation2.from), to = placements.get(relation2.to);
    const start = resolveShapeAttachment(from.bounds, from.appearance.shape, route2.from);
    const end = resolveShapeAttachment(to.bounds, to.appearance.shape, route2.to);
    if (route2.mode === "manual") {
      const authored = [start, ...route2.points.slice(1, -1).map(clone), end];
      return route2.strategy === "orthogonal" ? orthogonal(authored, route2.from.side, route2.to.side) : authored;
    }
    if (relation2.from === relation2.to) {
      const outsideX = from.bounds.x + from.bounds.width + 40;
      const outsideY = from.bounds.y - 40;
      return orthogonal([start, { x: outsideX, y: start.y }, { x: outsideX, y: outsideY }, { x: end.x, y: outsideY }, end], route2.from.side, route2.to.side);
    }
    if (route2.strategy === "straight") return [start, end];
    if (Math.abs(start.x - end.x) < epsilon || Math.abs(start.y - end.y) < epsilon) return [start, end];
    const horizontal = ["left", "right"].includes(route2.from.side);
    return horizontal ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end] : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end];
  }
  function midpoint(points) {
    const lengths = points.slice(1).map((point2, index2) => Math.hypot(point2.x - points[index2].x, point2.y - points[index2].y));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (let index2 = 0; index2 < lengths.length; index2++) {
      if (remaining <= lengths[index2] && lengths[index2] > 0) {
        const scale = remaining / lengths[index2];
        return { x: points[index2].x + (points[index2 + 1].x - points[index2].x) * scale, y: points[index2].y + (points[index2 + 1].y - points[index2].y) * scale };
      }
      remaining -= lengths[index2];
    }
    return points[0];
  }
  var textWidth = (text2, size2) => [...text2].reduce((width, character) => width + (character.codePointAt(0) > 11903 ? 1 : /[MW@#%]/u.test(character) ? 0.9 : /[il.,' ]/u.test(character) ? 0.32 : 0.62) * size2, 0);
  function resolveText(element2, diagnostics) {
    const label = element2.label;
    if (!label) return null;
    const size2 = element2.appearance.fontSize;
    const lineHeight = size2 * 1.4;
    const anchor = element2.savedLabel;
    const container2 = element2.collection === "groups" || element2.collection === "lanes";
    const inset = element2.appearance.shape === "diamond" || element2.appearance.shape === "ellipse" ? 0.22 : 0;
    const shapeWidth = element2.bounds ? Math.max(1, element2.bounds.width * (1 - inset * 2) - 24) : null;
    const available = anchor?.width ?? (element2.bounds ? shapeWidth : Math.min(280, Math.max(72, textWidth(label, size2) + 16)));
    let lines;
    try {
      lines = wrapDiagramLabel(label, Math.max(1, Math.floor(available / (size2 * 0.62))));
    } catch {
      diagnostics.push(issue("text-budget", `Label ${element2.id} exceeds the renderer text budget; move detail to a description.`, [element2.id]));
      lines = [label];
    }
    if (size2 < AUTHORED_MINIMUM_FONT_SIZE) diagnostics.push(issue("unreadable-text", `Element ${element2.id} uses ${size2}px text; readable export requires at least ${AUTHORED_MINIMUM_FONT_SIZE}px.`, [element2.id]));
    const height = lines.length * lineHeight;
    const maximumLine = Math.max(...lines.map((line) => textWidth(line, size2)), 0);
    let bounds2;
    if (anchor) bounds2 = { x: anchor.x, y: anchor.y, width: anchor.width, height };
    else if (element2.bounds) {
      const width = shapeWidth;
      bounds2 = { x: element2.bounds.x + (element2.bounds.width - width) / 2, y: container2 ? element2.bounds.y + 8 : element2.bounds.y + (element2.bounds.height - height) / 2, width, height };
    } else {
      const point2 = midpoint(element2.points);
      bounds2 = { x: point2.x - available / 2, y: point2.y - height - 8, width: available, height };
    }
    if (maximumLine > bounds2.width + 1 || element2.bounds && !anchor && height > element2.bounds.height - (container2 ? 12 : 16)) diagnostics.push(issue("label-overflow", `Label ${element2.id} does not fit its saved geometry at its saved font size.`, [element2.id]));
    const align = element2.appearance.textAlign;
    const x = bounds2.x + (align === "center" ? bounds2.width / 2 : align === "right" ? bounds2.width : 0);
    if (element2.bounds && !anchor && !container2 && lines.some((line, index2) => {
      const width = textWidth(line, size2), left = x - (align === "center" ? width / 2 : align === "right" ? width : 0);
      const top = bounds2.y + index2 * lineHeight;
      return [[left, top], [left + width, top], [left, top + lineHeight], [left + width, top + lineHeight]].some(([px, py]) => shapeInterior({ x: px, y: py }, element2) > epsilon);
    })) diagnostics.push(issue("label-overflow", `Label ${element2.id} crosses its saved shape outline; enlarge the shape or shorten the label.`, [element2.id]));
    return { lines, bounds: bounds2, fontSize: size2, lineHeight, align, x, baseline: bounds2.y + size2 };
  }
  function shapeInterior(point2, element2) {
    const { x, y, width, height } = element2.bounds;
    const dx = Math.abs(point2.x - x - width / 2), dy = Math.abs(point2.y - y - height / 2);
    const shape2 = element2.appearance.shape;
    if (shape2 === "ellipse") return (dx / (width / 2)) ** 2 + (dy / (height / 2)) ** 2 - 1;
    if (shape2 === "diamond") return dx / (width / 2) + dy / (height / 2) - 1;
    if (shape2 === "cylinder") {
      const cap = Math.min(12, height / 4);
      return (dx / (width / 2)) ** 2 + (Math.max(0, dy - (height / 2 - cap)) / cap) ** 2 - 1;
    }
    if (shape2 === "rounded-rectangle") {
      const radius = Math.min(14, width / 2, height / 2);
      const qx = dx - (width / 2 - radius), qy = dy - (height / 2 - radius);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
    }
    return Math.max(dx / (width / 2), dy / (height / 2)) - 1;
  }
  function resolveDiagramSceneElement(entry2, placement4, placements, order, emphasisLevel = null, diagnostics = []) {
    const { collection, value } = entry2;
    const element2 = { id: value.id, collection, semantic: clone(value), kind: value.kind ?? collection, label: value.label ?? value.text ?? "", description: value.description ?? "", bounds: clone(placement4.bounds), savedLabel: clone(placement4.label), zIndex: placement4.zIndex, order, appearance: clone(placement4.appearance), locks: clone(placement4.locks), emphasis: emphasisLevel };
    if (placement4.bounds) Object.assign(element2, clone(placement4.bounds));
    if (collection === "relations") Object.assign(element2, { from: value.from, to: value.to, direction: value.direction, route: clone(placement4.route), points: routePoints(value, placement4, placements) });
    element2.text = resolveText(element2, diagnostics);
    element2.lines = element2.text?.lines ?? [];
    if (element2.points) {
      element2.routePoints = element2.points.map(({ x, y }) => [x, y]);
      element2.x1 = element2.points[0].x;
      element2.y1 = element2.points[0].y;
      element2.x2 = element2.points.at(-1).x;
      element2.y2 = element2.points.at(-1).y;
      element2.labelBounds = element2.text?.bounds ?? null;
      element2.labelLines = element2.lines;
    }
    return element2;
  }

  // lib/artifact/diagram/rendering/svg.mjs
  function escapeXml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  }

  // lib/artifact/diagram/authoring/renderer.mjs
  var AUTHORED_DIAGRAM_RENDERER = Object.freeze({ id: "openplanr-authored-svg", version: "1.0.0" });
  var palettes = {
    paper: { ...DIAGRAM_THEME, id: "paper", version: "1.0.0", accent: "#1d4ed8", success: "#166534", warning: "#854d0e", danger: "#b91c1c", fills: { surface: "#f8fafc", accent: "#dbeafe", success: "#dcfce7", warning: "#fef3c7", danger: "#fee2e2", transparent: "none" } },
    slate: { ...DIAGRAM_THEME, id: "slate", version: "1.0.0", background: "#17212d", surface: "#233141", foreground: "#f1f5f9", border: "#a9bbcf", accent: "#7dd3fc", muted: "#cbd5e1", success: "#86efac", warning: "#fde68a", danger: "#fca5a5", fills: { surface: "#233141", accent: "#123e55", success: "#164434", warning: "#4a3818", danger: "#54252a", transparent: "none" } },
    midnight: { ...DIAGRAM_THEME, id: "midnight", version: "1.0.0", background: "#0b1015", surface: "#151e28", foreground: "#e5edf5", border: "#94a3b8", accent: "#67e8f9", muted: "#b8c7d9", success: "#86efac", warning: "#fcd34d", danger: "#fca5a5", fills: { surface: "#151e28", accent: "#0c3640", success: "#12392d", warning: "#493817", danger: "#4f2529", transparent: "none" } }
  };
  function authoredDiagramPalette(themeId = "paper") {
    const theme = palettes[themeId] ?? palettes.paper;
    return { ...theme, fills: { ...theme.fills } };
  }
  var strokeColor = (appearance2, theme) => ({ default: theme.border, accent: theme.accent, muted: theme.muted, danger: theme.danger, none: "none" })[appearance2.stroke];
  var svgNumber = (value) => String(Number(value.toFixed(6)));
  function attributes(element2, theme, fill = theme.fills[element2.appearance.fill]) {
    const { appearance: appearance2 } = element2;
    const dash = appearance2.strokeStyle === "dashed" ? ' stroke-dasharray="7 5"' : appearance2.strokeStyle === "dotted" ? ' stroke-dasharray="2 4" stroke-linecap="round"' : "";
    return `fill="${fill}" stroke="${strokeColor(appearance2, theme)}" stroke-width="${appearance2.strokeWidth}"${dash}`;
  }
  function shape(element2, theme) {
    const { x, y, width, height } = element2.bounds;
    const common = attributes(element2, theme);
    const n = svgNumber;
    switch (element2.appearance.shape) {
      case "text":
        return "";
      case "ellipse":
        return `<ellipse cx="${n(x + width / 2)}" cy="${n(y + height / 2)}" rx="${n(width / 2)}" ry="${n(height / 2)}" ${common}/>`;
      case "diamond":
        return `<path d="M ${n(x + width / 2)} ${n(y)} L ${n(x + width)} ${n(y + height / 2)} L ${n(x + width / 2)} ${n(y + height)} L ${n(x)} ${n(y + height / 2)} Z" ${common}/>`;
      case "cylinder": {
        const cap = Math.min(12, height / 4), rx = width / 2;
        return `<path d="M ${n(x)} ${n(y + cap)} A ${n(rx)} ${n(cap)} 0 0 1 ${n(x + width)} ${n(y + cap)} L ${n(x + width)} ${n(y + height - cap)} A ${n(rx)} ${n(cap)} 0 0 1 ${n(x)} ${n(y + height - cap)} Z" ${common}/><path d="M ${n(x)} ${n(y + cap)} A ${n(rx)} ${n(cap)} 0 0 0 ${n(x + width)} ${n(y + cap)}" ${attributes(element2, theme, "none")}/>`;
      }
      default:
        return `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${element2.appearance.shape === "rounded-rectangle" ? n(Math.min(14, width / 2, height / 2)) : 0}" ${common}/>`;
    }
  }
  function text(element2, theme) {
    if (!element2.text) return "";
    const { lines, x, baseline, lineHeight, fontSize, align, bounds: bounds2 } = element2.text;
    const anchor = { left: "start", center: "middle", right: "end" }[align];
    const background = element2.collection === "relations" ? `<rect x="${svgNumber(bounds2.x)}" y="${svgNumber(bounds2.y)}" width="${svgNumber(bounds2.width)}" height="${svgNumber(bounds2.height)}" fill="${theme.background}"/>` : "";
    return `${background}<text aria-label="${escapeXml(element2.label)}" text-anchor="${anchor}" font-family="${theme.fontFamily}" font-size="${fontSize}" font-weight="${element2.emphasis === "primary" ? 700 : element2.emphasis === "muted" ? 400 : 500}" fill="${theme.foreground}">${lines.map((line, index2) => `<tspan x="${svgNumber(x)}" y="${svgNumber(baseline + index2 * lineHeight)}">${escapeXml(line)}</tspan>`).join("")}</text>`;
  }
  function renderAuthoredSceneElement(element2, theme, diagramId) {
    const attributes2 = `data-element-id="${escapeXml(element2.id)}" data-collection="${element2.collection}" data-semantic-kind="${escapeXml(element2.kind)}" data-shape="${element2.appearance.shape}" data-z-index="${element2.zIndex}"${element2.emphasis ? ` data-emphasis="${element2.emphasis}"` : ""}`;
    if (element2.collection !== "relations") return `<g ${attributes2}>${shape(element2, theme)}${text(element2, theme)}</g>`;
    const color = strokeColor(element2.appearance, theme);
    const marker = `${diagramId}-${element2.id}-arrow`;
    const markerDefinition = element2.direction === "none" ? "" : `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${color}"/></marker></defs>`;
    const start = element2.direction === "both" ? ` marker-start="url(#${marker})"` : "";
    const end = element2.direction !== "none" ? ` marker-end="url(#${marker})"` : "";
    const dash = element2.appearance.strokeStyle === "dashed" ? ' stroke-dasharray="7 5"' : element2.appearance.strokeStyle === "dotted" ? ' stroke-dasharray="2 4" stroke-linecap="round"' : "";
    const path = element2.points.map((point2, index2) => `${index2 === 0 ? "M" : "L"} ${svgNumber(point2.x)} ${svgNumber(point2.y)}`).join(" ");
    return `<g ${attributes2} data-direction="${element2.direction}">${markerDefinition}<path d="${path}" fill="none" stroke="${color}" stroke-width="${element2.appearance.strokeWidth}"${dash}${start}${end}/>${text(element2, theme)}</g>`;
  }

  // lib/artifact/diagram/authoring/layout.mjs
  var inside = (bounds2, frame) => !frame || bounds2.x >= frame.x && bounds2.y >= frame.y && bounds2.x + bounds2.width <= frame.x + frame.width && bounds2.y + bounds2.height <= frame.y + frame.height;
  var overlaps = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  function check(bundle, options, keys) {
    const checked = validateAuthoringBundle(bundle);
    if (!checked.ok) return checked;
    const diagnostics = inspectPlainData(options);
    if (diagnostics.length) return { ok: false, diagnostics };
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => !keys.includes(key)) || typeof options.transactionId !== "string" || !Array.isArray(options.targetIds) || !options.targetIds.length || new Set(options.targetIds).size !== options.targetIds.length) return failure("$.options", "layout-options", "Supply distinct targetIds and one transactionId.");
    const byId = elementIndex(bundle.document);
    if (options.targetIds.some((id2) => typeof id2 !== "string" || !byId.has(id2))) return failure("$.options.targetIds", "reference", "Every layout target must exist in this diagram.");
    return { ok: true };
  }
  function preview(bundle, changes, transactionId) {
    if (!changes.length) return failure("$.options.targetIds", "no-change", "The selected objects already have the requested geometry.");
    return previewDiagramTransaction(bundle, { kind: "diagram-edit-transaction", schemaVersion: "1.0.0", protocolVersion: "1.13.0", diagramId: bundle.diagramId, transactionId, base: snapshot2(bundle), undoOf: null, operations: [{ type: "set-geometry", changes }] });
  }
  function translate2(geometry, dx, dy) {
    const after = clone(geometry);
    if (after.bounds) {
      after.bounds.x += dx;
      after.bounds.y += dy;
    }
    if (after.route?.mode === "manual") after.route.points = after.route.points.map((point2) => ({ x: point2.x + dx, y: point2.y + dy }));
    if (after.label) {
      after.label.x += dx;
      after.label.y += dy;
    }
    return after;
  }
  function previewAutomaticLayout(bundle, options) {
    const checked = check(bundle, options, ["targetIds", "transactionId", "gap", "columns"]);
    if (!checked.ok) return checked;
    const gap = options.gap === void 0 ? 32 : options.gap;
    if (options.targetIds.length > 256) return failure("$.options.targetIds", "focused-region-required", "Select at most 256 direct targets for one layout preview, or select their containing regions.");
    if (!Number.isFinite(gap) || gap < 8 || gap > 512 || options.columns !== void 0 && (!Number.isInteger(options.columns) || options.columns < 1 || options.columns > 32)) return failure("$.options", "layout-options", "Gap must be 8–512 canvas units; columns must be an integer from 1 to 32.");
    const byId = elementIndex(bundle.document), parents = parentIndex(bundle.document);
    const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
    if (options.targetIds.some((id2) => byId.get(id2).collection === "relations")) return failure("$.options.targetIds", "layout-target", "Select shapes or containers for layout; resetting a connector route is a separate explicit operation.");
    const selected2 = new Set(options.targetIds);
    const roots2 = options.targetIds.filter((id2) => {
      let parent = parents.get(id2);
      while (parent) {
        if (selected2.has(parent)) return false;
        parent = parents.get(parent);
      }
      return true;
    });
    const lockedIds = [];
    const movable = [];
    const closureById = /* @__PURE__ */ new Map();
    for (const id2 of roots2) {
      const closure2 = descendants(bundle.document, [id2]);
      closureById.set(id2, closure2);
      const locked = closure2.filter((member) => placements.get(member).locks.position);
      if (locked.length) lockedIds.push(...locked);
      else movable.push(id2);
    }
    if (!movable.length) return { ...failure("$.options.targetIds", "geometry-lock", "All selected regions contain a position-locked object."), layout: { targetIds: [...options.targetIds], movedIds: [], lockedIds: [...new Set(lockedIds)].sort() } };
    const groups = /* @__PURE__ */ new Map();
    for (const id2 of movable) {
      const parent = parents.get(id2) ?? null;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(id2);
    }
    const deltas = /* @__PURE__ */ new Map();
    const occupied = [];
    let collisionChecks = 0;
    for (const [parentId, ids2] of groups) {
      const frame = parentId ? placements.get(parentId).bounds : null;
      const selectedClosure = new Set(ids2.flatMap((id2) => closureById.get(id2)));
      const ancestors = /* @__PURE__ */ new Set();
      for (const id2 of ids2) {
        let parent = parents.get(id2);
        while (parent) {
          ancestors.add(parent);
          parent = parents.get(parent);
        }
      }
      const obstacles = bundle.presentation.elements.filter((value) => value.bounds && !selectedClosure.has(value.elementId) && !ancestors.has(value.elementId)).map((value) => value.bounds);
      const width = Math.max(...ids2.map((id2) => placements.get(id2).bounds.width));
      const height = Math.max(...ids2.map((id2) => placements.get(id2).bounds.height));
      const availableColumns = frame ? Math.max(1, Math.floor((frame.width + gap) / (width + gap))) : 32;
      const columns = Math.min(options.columns ?? Math.max(1, Math.ceil(Math.sqrt(ids2.length))), availableColumns);
      const origin = { x: Math.min(...ids2.map((id2) => placements.get(id2).bounds.x)), y: Math.min(...ids2.map((id2) => placements.get(id2).bounds.y)) };
      if (frame) {
        origin.x = Math.max(frame.x, Math.min(origin.x, frame.x + frame.width - width));
        origin.y = Math.max(frame.y, Math.min(origin.y, frame.y + frame.height - height));
      }
      const ordered = ["right-left", "bottom-up"].includes(bundle.presentation.layout.direction) ? [...ids2].reverse() : ids2;
      let slot = 0;
      const maximumSlots = Math.min(1e5, Math.max(256, ids2.length * 64));
      for (const id2 of ordered) {
        const old = placements.get(id2).bounds;
        let proposed;
        while (slot < maximumSlots) {
          const column = slot % columns, row = Math.floor(slot / columns);
          slot++;
          const candidate = { ...old, x: origin.x + column * (width + gap), y: origin.y + row * (height + gap) };
          if (frame && candidate.y + candidate.height > frame.y + frame.height) break;
          collisionChecks += obstacles.length + occupied.length;
          if (collisionChecks > 25e4) return failure("$.options.targetIds", "focused-region-required", "This layout exceeds the bounded obstacle-search budget; select a smaller region.");
          if (!inside(candidate, frame) || [...obstacles, ...occupied].some((bounds2) => overlaps(candidate, bounds2, gap / 2))) continue;
          proposed = candidate;
          break;
        }
        if (!proposed) return failure(`$.presentation.${id2}`, "layout-space", `The selected region has insufficient space around fixed objects for ${id2}; expand its container or select a smaller region.`);
        occupied.push(proposed);
        for (const member of closureById.get(id2)) deltas.set(member, { dx: proposed.x - old.x, dy: proposed.y - old.y });
      }
    }
    const changes = [];
    for (const [id2, delta] of deltas) {
      const before = geometryFields(placements.get(id2)), after = translate2(before, delta.dx, delta.dy);
      if (!same2(before, after)) changes.push({ elementId: id2, before, after });
    }
    for (const relation2 of bundle.document.relations) {
      const from = deltas.get(relation2.from), to = deltas.get(relation2.to);
      if (!from || !to || !same2(from, to)) continue;
      const before = geometryFields(placements.get(relation2.id)), after = translate2(before, from.dx, from.dy);
      if (!same2(before, after)) changes.push({ elementId: relation2.id, before, after });
    }
    const result = preview(bundle, changes, options.transactionId);
    return { ...result, layout: { targetIds: [...options.targetIds], movedIds: changes.map((change) => change.elementId).sort(), lockedIds: [...new Set(lockedIds)].sort() } };
  }

  // lib/artifact/diagram/source-map.mjs
  var ENCODER = new TextEncoder();

  // lib/artifact/diagram/editor/geometry-index.mjs
  var CELL_SIZE = 256;
  var MAX_PRIMITIVE_CELLS = 16;
  var MAX_QUERY_CELLS = 4096;
  var MAX_QUERY_PRIMITIVES = 2e4;
  var fail2 = (rule, detail, path = "$.geometry") => ({ ok: false, diagnostics: [{ path, rule, detail }] });
  var cellRange = (bounds2) => ({ left: Math.floor(bounds2.x / CELL_SIZE), right: Math.floor((bounds2.x + bounds2.width) / CELL_SIZE), top: Math.floor(bounds2.y / CELL_SIZE), bottom: Math.floor((bounds2.y + bounds2.height) / CELL_SIZE) });
  var cellCount = (range2) => (range2.right - range2.left + 1) * (range2.bottom - range2.top + 1);
  var cellKey = (x, y) => `${x},${y}`;
  var rectDistance = (point2, bounds2) => Math.hypot(Math.max(bounds2.x - point2.x, 0, point2.x - bounds2.x - bounds2.width), Math.max(bounds2.y - point2.y, 0, point2.y - bounds2.y - bounds2.height));
  function segmentDistance(point2, start, end) {
    const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy;
    const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point2.x - start.x) * dx + (point2.y - start.y) * dy) / squared));
    return Math.hypot(point2.x - start.x - t * dx, point2.y - start.y - t * dy);
  }
  function metadata(bundle) {
    const byId = elementIndex(bundle.document);
    const placements = /* @__PURE__ */ new Map(), signatures = /* @__PURE__ */ new Map(), order = /* @__PURE__ */ new Map(), children = /* @__PURE__ */ new Map(), incident = /* @__PURE__ */ new Map();
    const emphasis2 = new Map(bundle.document.emphasis.map((value) => [value.targetId, value.level]));
    bundle.presentation.elements.forEach((value, index2) => {
      placements.set(value.elementId, value);
      order.set(value.elementId, index2);
    });
    for (const [id2, entry2] of byId) {
      signatures.set(id2, JSON.stringify([entry2, placements.get(id2), emphasis2.get(id2) ?? null]));
      if (entry2.value.members) children.set(id2, [...entry2.value.members]);
      if (entry2.collection === "relations") for (const endpoint of [entry2.value.from, entry2.value.to]) {
        if (!incident.has(endpoint)) incident.set(endpoint, /* @__PURE__ */ new Set());
        incident.get(endpoint).add(id2);
      }
    }
    return { byId, placements, order, emphasis: emphasis2, signatures, children, incident };
  }
  function resolveGeometry(data, id2) {
    const element2 = resolveDiagramSceneElement(data.byId.get(id2), data.placements.get(id2), data.placements, data.order.get(id2), data.emphasis.get(id2) ?? null);
    return { id: id2, collection: element2.collection, bounds: element2.bounds, points: element2.points ?? [], labelBounds: element2.text?.bounds ?? null, zIndex: element2.zIndex, order: element2.order };
  }
  function primitives(record2) {
    const result = [];
    if (record2.bounds) result.push({ id: record2.id, kind: "bounds", bounds: record2.bounds });
    if (record2.labelBounds) result.push({ id: record2.id, kind: "label", bounds: record2.labelBounds });
    for (let index2 = 1; index2 < record2.points.length; index2++) {
      const start = record2.points[index2 - 1], end = record2.points[index2];
      result.push({ id: record2.id, kind: "segment", bounds: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }, start, end });
    }
    return result;
  }
  function affectedClosure(ids2, oldData, nextData) {
    const result = new Set(ids2), pending = [...result];
    while (pending.length) {
      const id2 = pending.pop();
      for (const data of [oldData, nextData]) for (const child of data.children.get(id2) ?? []) if (!result.has(child)) {
        result.add(child);
        pending.push(child);
      }
    }
    for (const id2 of [...result]) for (const data of [oldData, nextData]) for (const edge of data.incident.get(id2) ?? []) result.add(edge);
    return result;
  }
  function readQuery(input) {
    const diagnostics = inspectPlainData(input);
    if (diagnostics.length) return { ok: false, diagnostics };
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["x", "y", "tolerance", "camera"].includes(key))) return fail2("query-options", "Supply a screen point, pixel tolerance and one camera.");
    const { camera } = input;
    const tolerance = input.tolerance === void 0 ? 6 : input.tolerance;
    if (!camera || typeof camera !== "object" || Array.isArray(camera) || Object.keys(camera).some((key) => !["x", "y", "scale"].includes(key)) || ![input.x, input.y, camera.x, camera.y, camera.scale, tolerance].every(Number.isFinite) || camera.scale <= 0 || tolerance < 0 || tolerance > 128) return fail2("query-options", "Camera values and screen coordinates must be finite; scale must be positive and tolerance must be 0–128 pixels.");
    const world = { x: (input.x - camera.x) / camera.scale, y: (input.y - camera.y) / camera.scale }, radius = tolerance / camera.scale;
    if (![world.x, world.y, radius].every(Number.isFinite)) return fail2("query-range", "The camera cannot resolve this query into finite canvas coordinates.");
    const range2 = cellRange({ x: world.x - radius, y: world.y - radius, width: radius * 2, height: radius * 2 });
    if (!Number.isSafeInteger(range2.left) || !Number.isSafeInteger(range2.right) || !Number.isSafeInteger(range2.top) || !Number.isSafeInteger(range2.bottom) || cellCount(range2) > MAX_QUERY_CELLS) return fail2("query-range", "The screen tolerance covers too much of the canvas; zoom in before precise selection.");
    return { ok: true, world, radius, range: range2, scale: camera.scale };
  }
  function createDiagramGeometryIndex(bundle) {
    const checked = validateAuthoringBundle(bundle);
    if (!checked.ok) return checked;
    const diagramId = bundle.diagramId;
    let digest2 = bundle.bundleDigest, data = metadata(bundle);
    const records2 = /* @__PURE__ */ new Map(), buckets = /* @__PURE__ */ new Map(), overflow = /* @__PURE__ */ new Set(), members = /* @__PURE__ */ new Map();
    const work = { fullBuilds: 1, updates: 0, validations: 1, validatedElements: bundle.presentation.elements.length, metadataEntriesScanned: data.byId.size, geometryResolved: 0, lastUpdateResolved: 0, lastUpdateRemoved: 0, lastMetadataEntriesScanned: data.byId.size, queries: 0, lastQueryCandidates: 0, lastQueryChecks: 0, lastQueryCells: 0, lastQueryOverflow: 0 };
    let primitiveCount = 0;
    function remove(id2) {
      for (const primitive of members.get(id2) ?? []) {
        if (primitive.cells === null) overflow.delete(primitive);
        else for (const key of primitive.cells) {
          const bucket = buckets.get(key);
          bucket.delete(primitive);
          if (!bucket.size) buckets.delete(key);
        }
        primitiveCount--;
      }
      records2.delete(id2);
      members.delete(id2);
    }
    function insert(record2) {
      const values = primitives(record2);
      for (const primitive of values) {
        const range2 = cellRange(primitive.bounds);
        if (cellCount(range2) > MAX_PRIMITIVE_CELLS) {
          primitive.cells = null;
          overflow.add(primitive);
        } else {
          primitive.cells = [];
          for (let x = range2.left; x <= range2.right; x++) for (let y = range2.top; y <= range2.bottom; y++) {
            const key = cellKey(x, y);
            primitive.cells.push(key);
            if (!buckets.has(key)) buckets.set(key, /* @__PURE__ */ new Set());
            buckets.get(key).add(primitive);
          }
        }
        primitiveCount++;
      }
      records2.set(record2.id, record2);
      members.set(record2.id, values);
    }
    for (const id2 of data.byId.keys()) insert(resolveGeometry(data, id2));
    work.geometryResolved = records2.size;
    work.lastUpdateResolved = records2.size;
    data = { signatures: data.signatures, children: data.children, incident: data.incident };
    function update(nextBundle, affectedIds) {
      const checked2 = validateAuthoringBundle(nextBundle);
      work.validations++;
      if (!checked2.ok) return checked2;
      work.validatedElements += nextBundle.presentation.elements.length;
      const diagnostics = inspectPlainData(affectedIds);
      if (diagnostics.length) return { ok: false, diagnostics };
      if (nextBundle.diagramId !== diagramId) return fail2("diagram-identity", "An index cannot replace its diagram identity.");
      if (!Array.isArray(affectedIds) || affectedIds.some((id2) => typeof id2 !== "string") || new Set(affectedIds).size !== affectedIds.length) return fail2("affected-ids", "Supply distinct stable IDs affected by the edit.");
      if (nextBundle.bundleDigest === digest2 && affectedIds.some((id2) => !data.signatures.has(id2))) return fail2("affected-ids", "Affected IDs must exist in the current or next diagram.");
      if (nextBundle.bundleDigest === digest2) {
        work.lastUpdateResolved = 0;
        work.lastUpdateRemoved = 0;
        work.lastMetadataEntriesScanned = 0;
        return { ok: true, updatedIds: [], removedIds: [], diagnostics: [] };
      }
      const nextData = metadata(nextBundle), changed = new Set(affectedIds);
      for (const [id2, signature] of nextData.signatures) if (signature !== data.signatures.get(id2)) changed.add(id2);
      for (const id2 of data.signatures.keys()) if (!nextData.signatures.has(id2)) changed.add(id2);
      if (affectedIds.some((id2) => !nextData.signatures.has(id2) && !data.signatures.has(id2))) return fail2("affected-ids", "Affected IDs must exist in the current or next diagram.");
      const closure2 = affectedClosure(changed, data, nextData);
      const nextRecords = [], removedIds = [];
      for (const id2 of closure2) {
        if (nextData.byId.has(id2)) nextRecords.push(resolveGeometry(nextData, id2));
        else if (records2.has(id2)) removedIds.push(id2);
      }
      for (const id2 of closure2) remove(id2);
      for (const record2 of nextRecords) insert(record2);
      for (const [id2, order] of nextData.order) records2.get(id2).order = order;
      data = { signatures: nextData.signatures, children: nextData.children, incident: nextData.incident };
      digest2 = nextBundle.bundleDigest;
      work.updates++;
      work.metadataEntriesScanned += nextData.byId.size;
      work.lastMetadataEntriesScanned = nextData.byId.size;
      work.geometryResolved += nextRecords.length;
      work.lastUpdateResolved = nextRecords.length;
      work.lastUpdateRemoved = removedIds.length;
      return { ok: true, updatedIds: nextRecords.map((record2) => record2.id).sort(), removedIds: removedIds.sort(), diagnostics: [] };
    }
    function query(input) {
      work.queries++;
      work.lastQueryCandidates = 0;
      work.lastQueryChecks = 0;
      work.lastQueryCells = 0;
      work.lastQueryOverflow = 0;
      const query2 = readQuery(input);
      if (!query2.ok) return query2;
      const candidates = /* @__PURE__ */ new Set();
      for (let x = query2.range.left; x <= query2.range.right; x++) for (let y = query2.range.top; y <= query2.range.bottom; y++) {
        work.lastQueryCells++;
        for (const primitive of buckets.get(cellKey(x, y)) ?? []) {
          candidates.add(primitive);
          if (candidates.size > MAX_QUERY_PRIMITIVES) return fail2("query-density", "Too many overlapping segments occupy this selection region; narrow the view before precise selection.");
        }
      }
      for (const primitive of overflow) {
        work.lastQueryOverflow++;
        if (rectDistance(query2.world, primitive.bounds) <= query2.radius) candidates.add(primitive);
        if (work.lastQueryOverflow > MAX_QUERY_PRIMITIVES || candidates.size > MAX_QUERY_PRIMITIVES) return fail2("query-density", "Too many long primitives occupy this selection region; narrow the view before precise selection.");
      }
      const hitById = /* @__PURE__ */ new Map(), visited = /* @__PURE__ */ new Set();
      const priority = { bounds: 0, segment: 1, label: 2 };
      for (const primitive of candidates) {
        visited.add(primitive.id);
        work.lastQueryChecks++;
        const distance = primitive.kind === "segment" ? segmentDistance(query2.world, primitive.start, primitive.end) : rectDistance(query2.world, primitive.bounds);
        if (distance > query2.radius) continue;
        const record2 = records2.get(primitive.id);
        const hit = { id: primitive.id, collection: record2.collection, kind: primitive.kind, distance: distance * query2.scale, zIndex: record2.zIndex };
        const existing = hitById.get(hit.id);
        if (!existing || hit.distance < existing.distance || hit.distance === existing.distance && priority[hit.kind] > priority[existing.kind]) hitById.set(hit.id, hit);
      }
      work.lastQueryCandidates = visited.size;
      const hits = [...hitById.values()].sort((a, b) => b.zIndex - a.zIndex || a.distance - b.distance || records2.get(b.id).order - records2.get(a.id).order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { ok: true, hits, world: query2.world, tolerance: query2.radius, diagnostics: [] };
    }
    return { ok: true, index: { update, query, get: (id2) => records2.has(id2) ? clone(records2.get(id2)) : null, stats: () => ({ ...work, entries: records2.size, primitives: primitiveCount, cells: buckets.size, overflowPrimitives: overflow.size }) }, diagnostics: [] };
  }

  // lib/artifact/diagram/editor/session.mjs
  var fail3 = (rule, detail) => ({ ok: false, diagnostics: [{ path: "$session", rule, detail }] });
  var defaultId = () => `edit-${globalThis.crypto.randomUUID()}`;
  var validId = (value) => typeof value === "string" && value.length <= 128 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
  var MAX_PENDING = 100;
  var MAX_HISTORY = 100;
  var idOf = (bundle) => bundle.bundleDigest;
  var validBundle = (value) => {
    const result = validateAuthoringBundle(value);
    if (!result.ok) throw new TypeError(result.diagnostics[0].detail);
    return clone(value);
  };
  function createDiagramEditorSession({ bundle, acknowledged = false, transport = null, recovery = null, nextTransactionId = defaultId, capabilities = { read: true, write: true } }) {
    let current = validBundle(bundle);
    let base = clone(current);
    let saved = acknowledged ? clone(current) : null;
    let initialization = acknowledged ? null : nextTransactionId();
    if (initialization !== null && !validId(initialization)) throw new TypeError("Initialization needs a valid transaction identity.");
    let pending = [];
    let undo = [];
    let redo = [];
    let gesture = null;
    let comparison = null;
    let diagnostics = [];
    let saveState = acknowledged ? "saved" : "unsaved";
    let capability = { read: capabilities.read === true, write: capabilities.write === true };
    let disposed = false;
    let epoch = 0;
    let saving = null;
    const listeners = /* @__PURE__ */ new Set();
    const usedIds = new Set(initialization ? [initialization] : []);
    let view = { camera: { x: 0, y: 0, scale: 1, fit: "all" }, selection: [], collapsedGroups: [], trace: [], snap: true };
    let recoveryWarning = null;
    const indexResult = createDiagramGeometryIndex(current);
    if (!indexResult.ok) throw new TypeError(indexResult.diagnostics[0].detail);
    const geometry = indexResult.index;
    function emit(type, affectedIds = []) {
      if (disposed) return;
      const event = { type, affectedIds: [...affectedIds], revision: idOf(current), saveState };
      for (const listener of [...listeners]) {
        try {
          listener(clone(event));
        } catch {
        }
      }
    }
    function persist() {
      if (!recovery || disposed || !capability.read || recoveryWarning) return;
      if (!initialization && !pending.length) recovery.clear();
      else recovery.save({ base, initialization, transactions: pending.map((item) => item.transaction) });
    }
    function guard() {
      if (disposed) return fail3("disposed", "This editor session is closed.");
      if (!capability.read || !capability.write) return fail3("access-changed", "This session no longer has owner editing access.");
      return null;
    }
    function pruneView() {
      const ids2 = new Set(current.presentation.elements.map((item) => item.elementId));
      const containers = new Set([...current.document.groups, ...current.document.lanes].map((item) => item.id));
      view.selection = view.selection.filter((id2) => ids2.has(id2));
      view.trace = view.trace.filter((id2) => ids2.has(id2));
      view.collapsedGroups = view.collapsedGroups.filter((id2) => containers.has(id2));
    }
    function updateGeometry(next, ids2) {
      const result = geometry.update(next, ids2);
      if (!result.ok) throw new Error(result.diagnostics[0].detail);
    }
    function accept(preview2, history = "edit") {
      if (!preview2.ok || !preview2.transaction) return preview2;
      if (idOf(preview2.bundle) === idOf(current)) return { ok: true, changed: false, transaction: null };
      if (pending.length >= MAX_PENDING) return fail3("pending-limit", "Save the pending edits before adding more.");
      if (usedIds.has(preview2.transaction.transactionId)) return fail3("transaction-id", "Each new edit needs a fresh transaction identity.");
      usedIds.add(preview2.transaction.transactionId);
      updateGeometry(preview2.bundle, preview2.impact.affectedIds);
      pending.push({ transaction: clone(preview2.transaction), bundle: clone(preview2.bundle), inverse: clone(preview2.inverse) });
      current = clone(preview2.bundle);
      if (history === "edit") {
        undo.push(clone(preview2.inverse));
        undo = undo.slice(-MAX_HISTORY);
        redo = [];
      }
      diagnostics = [];
      saveState = comparison ? "conflict" : saving ? "saving" : "unsaved";
      pruneView();
      persist();
      emit("content", preview2.impact.affectedIds);
      return clone(preview2);
    }
    function checkIdentity(transactionId) {
      return validId(transactionId) && !usedIds.has(transactionId) ? null : fail3("transaction-id", "Each new edit needs a fresh transaction identity.");
    }
    function submit(command, options = {}) {
      const blocked = guard();
      if (blocked) return blocked;
      if (gesture) return fail3("gesture-active", "Finish or cancel the gesture before another edit.");
      const transactionId = options.transactionId ?? nextTransactionId();
      const invalid = checkIdentity(transactionId);
      if (invalid) return invalid;
      return accept(compileDiagramCommand(current, command, { transactionId }));
    }
    function submitTransaction(transaction2) {
      const blocked = guard();
      if (blocked) return blocked;
      if (gesture) return fail3("gesture-active", "Finish or cancel the gesture before another edit.");
      return accept(previewDiagramTransaction(current, transaction2));
    }
    function cancelGesture(reason = "cancel") {
      if (!gesture) return { ok: true, cancelled: false };
      const affected = gesture.preview?.impact.affectedIds ?? [];
      gesture = null;
      updateGeometry(current, affected);
      emit("gesture-cancel", affected);
      return { ok: true, cancelled: true, reason };
    }
    function beginGesture({ transactionId = nextTransactionId() } = {}) {
      const blocked = guard();
      if (blocked) return blocked;
      if (gesture) return fail3("gesture-active", "Finish or cancel the current gesture first.");
      const invalid = checkIdentity(transactionId);
      if (invalid) return invalid;
      gesture = { transactionId, basis: idOf(current), preview: null, diagnostics: [] };
      emit("gesture-start");
      return { ok: true };
    }
    function setPreview(preview2) {
      const previous = gesture.preview?.impact.affectedIds ?? [];
      gesture.preview = preview2.ok && preview2.transaction ? preview2 : null;
      gesture.diagnostics = preview2.ok ? [] : clone(preview2.diagnostics);
      const affected = [.../* @__PURE__ */ new Set([...previous, ...gesture.preview?.impact.affectedIds ?? []])];
      updateGeometry(gesture.preview?.bundle ?? current, affected);
      emit("gesture-preview", affected);
      return clone(preview2);
    }
    function previewGesture(command) {
      const blocked = guard();
      if (blocked) return blocked;
      if (!gesture) return fail3("no-gesture", "Start a gesture before previewing it.");
      return setPreview(compileDiagramCommand(current, command, { transactionId: gesture.transactionId }));
    }
    function previewLayout(options) {
      const blocked = guard();
      if (blocked) return blocked;
      if (!gesture) return fail3("no-gesture", "Start a gesture before previewing layout.");
      return setPreview(previewAutomaticLayout(current, { ...options, transactionId: gesture.transactionId }));
    }
    function completeGesture() {
      const blocked = guard();
      if (blocked) return blocked;
      if (!gesture) return fail3("no-gesture", "No gesture is pending.");
      if (gesture.diagnostics.length) return { ok: false, diagnostics: clone(gesture.diagnostics) };
      if (comparison || gesture.basis !== idOf(current)) return fail3("stale-gesture", "The authoritative revision changed. Retain or cancel this preview and compare before applying it.");
      const preview2 = gesture.preview;
      gesture = null;
      if (!preview2) return { ok: true, changed: false, transaction: null };
      const result = accept(preview2);
      if (!result.ok) updateGeometry(current, preview2.impact.affectedIds);
      return result;
    }
    function compensate(source, target, transactionId) {
      const blocked = guard();
      if (blocked) return blocked;
      if (gesture) return fail3("gesture-active", "Finish or cancel the gesture before undo or redo.");
      if (comparison) return fail3("conflict", "Compare the authoritative revision before undo or redo.");
      if (!source.length) return { ok: true, changed: false, transaction: null };
      const inverse = createConditionalInverse(current, source.at(-1), { transactionId });
      if (!inverse.ok) {
        diagnostics = clone(inverse.diagnostics);
        emit("undo-conflict");
        return inverse;
      }
      const preview2 = previewDiagramTransaction(current, inverse.transaction);
      const result = accept(preview2, "compensation");
      if (result.ok && result.transaction) {
        source.pop();
        target.push(clone(result.inverse));
        if (target.length > MAX_HISTORY) target.shift();
        emit("history");
      }
      return result;
    }
    function refresh(authoritative) {
      const blocked = disposed || !capability.read;
      if (blocked) return fail3("access-changed", "This session cannot read a revision.");
      const validation = validateAuthoringBundle(authoritative);
      if (!validation.ok) return validation;
      if (authoritative.diagramId !== current.diagramId) return fail3("diagram-scope", "A refresh cannot switch the session to another diagram.");
      if (saved && idOf(authoritative) === idOf(saved)) return { ok: true, changed: false };
      if (pending.length || initialization || gesture || saving) {
        comparison = clone(authoritative);
        saveState = "conflict";
        emit("conflict");
        return { ok: false, diagnostics: [{ path: "$session", rule: "conflict", detail: "The authoritative revision changed; your pending work is retained." }], comparison: diffDiagramBundles(authoritative, current) };
      }
      const diff = diffDiagramBundles(current, authoritative);
      updateGeometry(authoritative, diff.impact.affectedIds);
      current = clone(authoritative);
      base = clone(authoritative);
      saved = clone(authoritative);
      saveState = "saved";
      comparison = null;
      diagnostics = [];
      pruneView();
      emit("refresh", diff.impact.affectedIds);
      return { ok: true, changed: true };
    }
    function acknowledge(result, expected, transactionId) {
      if (!result?.ok || result.status !== "saved" || !validateAuthoringBundle(result.bundle).ok || !same2(result.bundle, expected) || result.receipt?.transactionId !== transactionId || !same2(result.receipt.result, snapshot2(expected))) return false;
      saved = clone(expected);
      base = clone(expected);
      if (comparison && idOf(comparison) === idOf(expected)) comparison = null;
      return true;
    }
    async function failureState(result) {
      diagnostics = clone(result?.diagnostics ?? [{ path: "$save", rule: result?.status === "unknown" ? "save-unknown" : "save-failed", detail: "Save was not acknowledged. Pending work is retained for an exact retry." }]);
      if (result?.httpStatus === 401 || result?.httpStatus === 403) {
        capability = { read: false, write: false };
        saveState = "access-changed";
        recovery?.clear();
        epoch++;
      } else if (result?.httpStatus === 409 || result?.diagnostics?.some((item) => ["stale-base", "precondition"].includes(item.rule))) saveState = "conflict";
      else saveState = "offline";
      return { ok: false, status: saveState, diagnostics: clone(diagnostics) };
    }
    async function performSave(runEpoch, count) {
      const live = () => !disposed && epoch === runEpoch && capability.read && capability.write;
      if (!live()) return fail3("disposed", "This session is closed.");
      try {
        if (initialization) {
          const requestId = initialization;
          const expected = clone(base);
          const result = await transport.initialize(clone(expected), { transactionId: requestId });
          if (!live()) return fail3("disposed", "The save completed after this session lost access or closed. Reopen to read its authoritative outcome.");
          if (!acknowledge(result, expected, requestId)) return await failureState(result);
          initialization = null;
          persist();
          emit("acknowledged");
        }
        for (let index2 = 0; index2 < count; index2++) {
          const item = pending[0];
          if (!item) break;
          const result = await transport.commit(clone(item.transaction));
          if (!live()) return fail3("disposed", "The save completed after this session lost access or closed. Reopen to read its authoritative outcome.");
          if (pending[0] !== item || !acknowledge(result, item.bundle, item.transaction.transactionId)) return await failureState(result);
          pending.shift();
          persist();
          emit("acknowledged", item.inverse.changes.semantic.map((change) => change.elementId).filter(Boolean));
        }
        if (!live()) return fail3("disposed", "This session is closed.");
        saveState = comparison ? "conflict" : pending.length ? "unsaved" : "saved";
        diagnostics = [];
        return { ok: true, status: saveState, bundle: clone(saved) };
      } catch (error2) {
        if (!live()) return fail3("disposed", "This session is closed.");
        return await failureState({ ok: false, httpStatus: error2?.httpStatus, diagnostics: error2?.details?.diagnostics ?? [{ path: "$save", rule: "save-unavailable", detail: "The owner did not acknowledge this save. Retry without discarding pending work." }] });
      } finally {
        if (live()) {
          persist();
          emit("save");
        }
      }
    }
    function save() {
      const blocked = guard();
      if (blocked) return Promise.resolve(blocked);
      if (saving) return saving;
      if (!transport) {
        saveState = "offline";
        emit("save");
        return Promise.resolve(fail3("no-transport", "No owner store is connected. Pending changes remain unsaved."));
      }
      if (!initialization && !pending.length) return Promise.resolve({ ok: true, status: saveState });
      saveState = "saving";
      const runEpoch = epoch;
      const count = pending.length;
      const settled = Promise.resolve().then(() => performSave(runEpoch, count)).finally(() => {
        if (saving === settled) saving = null;
      });
      saving = settled;
      emit("save");
      return settled;
    }
    function setView(patch) {
      if (disposed || !capability.read) return fail3("access-changed", "This session cannot update view state.");
      if (inspectPlainData(patch).length || !patch || Array.isArray(patch) || Object.keys(patch).some((key) => !Object.hasOwn(view, key))) return fail3("view", "Unknown or non-JSON view preference.");
      const next = { ...view, ...clone(patch) };
      const camera = next.camera;
      if (!camera || Object.keys(camera).some((key) => !["x", "y", "scale", "fit"].includes(key)) || !Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(camera.scale) || camera.scale <= 0 || ![null, "all", "width"].includes(camera.fit) || typeof next.snap !== "boolean" || ["selection", "collapsedGroups", "trace"].some((key) => !Array.isArray(next[key]) || next[key].length > 1e4 || next[key].some((id2) => typeof id2 !== "string"))) return fail3("view", "Invalid camera or selection preference.");
      view = next;
      pruneView();
      emit("view");
      return { ok: true };
    }
    function restore() {
      if (!recovery || !capability.read) return;
      const record2 = recovery.load();
      if (!record2) return;
      try {
        if (inspectPlainData(record2).length || Object.keys(record2).some((key) => !["base", "initialization", "transactions"].includes(key)) || !validateAuthoringBundle(record2.base).ok || record2.base.diagramId !== current.diagramId || !(record2.initialization === null || validId(record2.initialization)) || !Array.isArray(record2.transactions) || record2.transactions.length > MAX_PENDING) throw new Error("Invalid recovery.");
        let draft = clone(record2.base);
        const entries2 = [];
        const ids2 = new Set(record2.initialization ? [record2.initialization] : []);
        for (const transaction2 of record2.transactions) {
          const preview2 = previewDiagramTransaction(draft, transaction2);
          if (!preview2.ok || ids2.has(transaction2.transactionId)) throw new Error("Invalid recovery transaction.");
          ids2.add(transaction2.transactionId);
          draft = preview2.bundle;
          entries2.push({ transaction: preview2.transaction, bundle: preview2.bundle, inverse: preview2.inverse });
        }
        if (!record2.initialization && !entries2.length) return;
        const authoritative = saved;
        base = clone(record2.base);
        initialization = record2.initialization;
        pending = entries2;
        undo = entries2.map((item) => clone(item.inverse)).slice(-MAX_HISTORY);
        usedIds.clear();
        ids2.forEach((id2) => usedIds.add(id2));
        const diff = diffDiagramBundles(current, draft);
        updateGeometry(draft, diff.impact.affectedIds);
        current = draft;
        if (authoritative && idOf(authoritative) !== idOf(base)) {
          comparison = authoritative;
          saveState = "conflict";
        } else saveState = "unsaved";
      } catch {
        recoveryWarning = "Stored edits failed validation and were not applied. The authoritative diagram remains unchanged.";
      }
    }
    restore();
    persist();
    return {
      getState() {
        return {
          bundle: capability.read ? clone(current) : null,
          acknowledged: capability.read && saved ? snapshot2(saved) : null,
          pendingCount: pending.length,
          needsInitialization: initialization !== null,
          saveState,
          capabilities: { ...capability },
          view: clone(view),
          gesture: gesture ? { transactionId: gesture.transactionId, basis: gesture.basis, diagnostics: clone(gesture.diagnostics), bundle: capability.read && gesture.preview ? clone(gesture.preview.bundle) : null } : null,
          canUndo: undo.length > 0 && capability.write,
          canRedo: redo.length > 0 && capability.write,
          comparison: capability.read && comparison ? { base: clone(base), bundle: clone(comparison), diff: diffDiagramBundles(comparison, current) } : null,
          diagnostics: clone(diagnostics),
          recovery: { ...recovery?.status() ?? { mode: "memory-only", warning: "Refresh recovery is unavailable in this session." }, ...recoveryWarning ? { mode: "memory-only", warning: recoveryWarning } : {} },
          disposed
        };
      },
      submit,
      submitTransaction,
      beginGesture,
      previewGesture,
      previewLayout,
      completeGesture,
      cancelGesture,
      undo: (options = {}) => compensate(undo, redo, options.transactionId ?? nextTransactionId()),
      redo: (options = {}) => compensate(redo, undo, options.transactionId ?? nextTransactionId()),
      refresh,
      save,
      setView,
      query: (options) => disposed || !capability.read ? fail3("access-changed", "This session cannot inspect geometry.") : geometry.query({ ...options, camera: { x: view.camera.x, y: view.camera.y, scale: view.camera.scale } }),
      geometry: (id2) => disposed || !capability.read ? null : geometry.get(id2),
      geometryStats: () => geometry.stats(),
      subscribe(listener) {
        if (disposed) return () => {
        };
        if (typeof listener !== "function") throw new TypeError("Listener must be a function.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setCapabilities(next) {
        if (disposed) return;
        capability = { read: next.read === true, write: next.write === true };
        epoch++;
        if (!capability.read || !capability.write) {
          cancelGesture("access-changed");
          saveState = "access-changed";
          if (!capability.read) recovery?.clear();
        } else saveState = comparison ? "conflict" : initialization || pending.length ? "unsaved" : "saved";
        emit("capabilities");
      },
      /** Deliberate conflict resolution; callers must offer draft export before discarding it. */
      useAuthoritative() {
        const blocked = guard();
        if (blocked) return blocked;
        if (saving) return fail3("save-in-flight", "Wait for the save result before discarding a draft.");
        if (!comparison) return fail3("no-conflict", "There is no authoritative comparison to adopt.");
        cancelGesture("use-authoritative");
        const target = clone(comparison);
        const diff = diffDiagramBundles(current, target);
        updateGeometry(target, diff.impact.affectedIds);
        current = target;
        base = clone(target);
        saved = clone(target);
        initialization = null;
        pending = [];
        undo = [];
        redo = [];
        comparison = null;
        diagnostics = [];
        saveState = "saved";
        pruneView();
        persist();
        emit("refresh", diff.impact.affectedIds);
        return { ok: true };
      },
      dispose() {
        if (disposed) return;
        persist();
        cancelGesture("dispose");
        disposed = true;
        epoch++;
        listeners.clear();
      }
    };
  }

  // lib/artifact/diagram/editor/draft.mjs
  var meta = (kind) => ({ kind, schemaVersion: "1.0.0", protocolVersion: "1.13.0" });
  function createDiagramEditorDraft({ diagramId, title, grammar = "flowchart", template = null }) {
    if (template) {
      const check3 = validateAuthoringBundle(template);
      if (!check3.ok) return check3;
      const copy = clone(template);
      copy.diagramId = diagramId;
      copy.document.diagramId = diagramId;
      copy.presentation.diagramId = diagramId;
      copy.document.title = title;
      copy.document.accessibility.title = title;
      copy.originalSource = null;
      copy.sourceMap = null;
      const bundle2 = sealBundle(copy);
      const checked = validateAuthoringBundle(bundle2);
      return checked.ok ? { ok: true, bundle: bundle2 } : checked;
    }
    const document2 = {
      ...meta("planr-diagram"),
      diagramId,
      title,
      summary: "",
      audience: "engineer",
      grammar: { id: grammar, version: "1.0.0" },
      nodes: [],
      relations: [],
      groups: [],
      lanes: [],
      events: [],
      series: [],
      axes: [],
      sets: [],
      annotations: [],
      emphasis: [],
      laneOrder: [],
      accessibility: { title, description: "", readingOrder: [] },
      documentDigest: ""
    };
    const presentation = {
      ...meta("diagram-presentation"),
      diagramId,
      semanticDigest: "",
      coordinateSystem: "global-canvas",
      layout: { direction: "left-right", detailTier: "balanced" },
      theme: { themeId: "paper", mode: "light" },
      elements: [],
      presentationDigest: ""
    };
    const bundle = sealBundle({ ...meta("diagram-authoring-bundle"), diagramId, document: document2, presentation, originalSource: null, sourceMap: null, bundleDigest: "" });
    const check2 = validateAuthoringBundle(bundle);
    return check2.ok ? { ok: true, bundle } : check2;
  }

  // lib/artifact/diagram/editor/recovery.mjs
  var MAX_RECOVERY_BYTES = 2 * 1024 * 1024;
  var scopePart = /^[a-zA-Z0-9_-]{1,160}$/u;
  function createDiagramEditorRecovery({ storage, scope, maxBytes = MAX_RECOVERY_BYTES }) {
    if (!scope || !scopePart.test(scope.sessionId) || !scopePart.test(scope.diagramId)) throw new TypeError("Recovery requires a verified owner session and diagram scope.");
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RECOVERY_BYTES) throw new TypeError("Invalid recovery byte limit.");
    const boundScope = { sessionId: scope.sessionId, diagramId: scope.diagramId };
    const key = `openplanr:diagram-editor:1:${boundScope.sessionId}:${boundScope.diagramId}`;
    let quarantined = false;
    let mode = storage ? "available" : "memory-only";
    let warning = storage ? null : "Pending edits survive only in this open session; recovery storage is unavailable.";
    const unavailable = (message) => {
      mode = "memory-only";
      warning = message;
      return { ok: false, mode, warning };
    };
    return {
      status: () => ({ mode, warning }),
      load() {
        if (!storage) return null;
        try {
          const raw = storage.getItem(key);
          if (raw === null) return null;
          if (typeof raw !== "string" || raw.length > maxBytes || new TextEncoder().encode(raw).length > maxBytes) throw new Error("Recovery exceeds its size limit.");
          const value = JSON.parse(raw);
          if (inspectPlainData(value).length || value?.version !== 1 || value.scope?.sessionId !== boundScope.sessionId || value.scope?.diagramId !== boundScope.diagramId || !value.draft || typeof value.draft !== "object" || Array.isArray(value.draft) || Object.keys(value).some((name) => !["version", "scope", "draft"].includes(name))) throw new Error("Recovery does not match this owner session and diagram.");
          return value.draft;
        } catch {
          quarantined = true;
          unavailable("Stored recovery could not be read safely. Pending edits remain in memory only.");
          return null;
        }
      },
      save(draft) {
        if (quarantined) return unavailable("Existing recovery could not be safely loaded and has not been replaced. Keep this session open; new edits remain in memory only.");
        if (!storage) return unavailable("Pending edits survive only in this open session; recovery storage is unavailable.");
        try {
          if (inspectPlainData(draft).length) throw new Error("Invalid recovery data.");
          const bytes = JSON.stringify({ version: 1, scope: boundScope, draft });
          if (bytes.length > maxBytes || new TextEncoder().encode(bytes).length > maxBytes) throw new Error("Recovery exceeds its size limit.");
          storage.setItem(key, bytes);
          mode = "available";
          warning = null;
          return { ok: true, mode, warning };
        } catch {
          try {
            storage.removeItem(key);
          } catch {
          }
          return unavailable("Pending edits could not be stored for refresh recovery. Keep this session open or save to the owner.");
        }
      },
      clear() {
        if (quarantined) return { ok: false, mode, warning };
        if (!storage) return { ok: true, mode, warning };
        try {
          storage.removeItem(key);
          return { ok: true, mode, warning };
        } catch {
          return unavailable("Recovery storage could not be cleared. Close this browser session before changing access.");
        }
      }
    };
  }

  // lib/artifact/diagram/editor/transport.mjs
  function createDiagramLocalOwnerTransport({ apiBase, fetch: request = globalThis.fetch, origin = globalThis.location?.origin, maxResponseBytes = 64 * 1024 * 1024 }) {
    const base = new URL(apiBase);
    if (base.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(base.hostname) || base.username || base.password || base.search || base.hash || !/^\/o\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/api\/$/u.test(base.pathname) || origin && origin !== base.origin) throw new TypeError("Owner transport requires this page’s exact loopback owner capability URL.");
    if (typeof request !== "function") throw new TypeError("Owner transport requires fetch.");
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 64 * 1024 * 1024) throw new TypeError("Invalid owner response byte limit.");
    async function call(action, body) {
      const response = await request(new URL(action, base).href, {
        method: body === void 0 ? "GET" : "POST",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: { "X-OpenPlanr-Owner": "1", ...body === void 0 ? {} : { "Content-Type": "application/json" } },
        ...body === void 0 ? {} : { body: JSON.stringify(body) }
      });
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("Owner returned an unexpected response type.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Owner returned no response body.");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let text2 = "";
      let count = 0;
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          count += value.byteLength;
          if (count > maxResponseBytes) throw new Error("Owner response exceeds the byte limit.");
          text2 += decoder.decode(value, { stream: true });
        }
        text2 += decoder.decode();
      } catch (error2) {
        await reader.cancel().catch(() => {
        });
        throw error2;
      } finally {
        reader.releaseLock();
      }
      const result = JSON.parse(text2);
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Owner returned an invalid response.");
      return { ...result, ...!response.ok ? { ok: false, httpStatus: response.status } : {} };
    }
    return {
      read: () => call("read"),
      initialize: (bundle, { transactionId }) => call("initialize", { bundle, transactionId }),
      commit: (transaction2) => call("commit", { transaction: transaction2 }),
      recover: (identity = {}) => call("recover", identity)
    };
  }

  // lib/artifact/ui/diagram-editor-dom.mjs
  function element(document2, tag, attributes2 = {}, text2) {
    const node2 = document2.createElement(tag);
    for (const [name, value] of Object.entries(attributes2)) {
      if (value === void 0 || value === null || value === false) continue;
      if (name === "className") node2.className = value;
      else node2.setAttribute(name, value === true ? "" : String(value));
    }
    if (text2 !== void 0) node2.textContent = text2;
    return node2;
  }
  function button(document2, text2, action, options = {}) {
    return element(document2, "button", { type: "button", "data-action": action, ...options }, text2);
  }
  function field(document2, name, value, { type = "text", choices, multiline = false, ...attributes2 } = {}) {
    const label = element(document2, "label", { className: "de-field" });
    label.append(element(document2, "span", {}, name));
    const input = element(document2, choices ? "select" : multiline ? "textarea" : "input", { "aria-label": name, ...!choices && !multiline ? { type } : {}, ...attributes2 });
    if (choices) for (const choice of choices) {
      const [id2, title] = Array.isArray(choice) ? choice : [choice, choice];
      input.append(element(document2, "option", { value: id2 }, title));
    }
    if (type === "checkbox") input.checked = value === true;
    else input.value = value ?? "";
    label.append(input);
    return { label, input };
  }
  function downloadJson(document2, value, filename) {
    const window = document2.defaultView;
    const url = window.URL.createObjectURL(new window.Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = element(document2, "a", { href: url, download: filename });
    document2.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1e3);
  }

  // lib/artifact/diagram/editor/clipboard.mjs
  var MAX_BYTES = 1024 * 1024;
  var MAX_ELEMENTS = 1e3;
  var fail4 = (detail) => ({ ok: false, diagnostics: [{ path: "$clipboard", rule: "clipboard", detail }] });
  var size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  function copyDiagramSelection(bundle, ids2) {
    const check2 = validateAuthoringBundle(bundle);
    if (!check2.ok) return check2;
    if (!Array.isArray(ids2) || !ids2.length || ids2.length > MAX_ELEMENTS || new Set(ids2).size !== ids2.length) return fail4("Select distinct objects within the clipboard limit.");
    const known = new Set(bundle.presentation.elements.map((item) => item.elementId));
    if (ids2.some((id2) => typeof id2 !== "string" || !known.has(id2))) return fail4("A selected object is missing.");
    const selected2 = new Set(descendants(bundle.document, ids2));
    for (const relation2 of bundle.document.relations) {
      if (selected2.has(relation2.from) && selected2.has(relation2.to)) selected2.add(relation2.id);
      else selected2.delete(relation2.id);
    }
    let added = true;
    while (added) {
      added = false;
      for (const note of bundle.document.annotations) if (selected2.has(note.targetId) && !selected2.has(note.id)) {
        selected2.add(note.id);
        added = true;
      }
    }
    if (!selected2.size || selected2.size > MAX_ELEMENTS) return fail4("The copied fragment must contain between 1 and 1,000 objects.");
    const fragment = clone(bundle);
    fragment.originalSource = null;
    fragment.sourceMap = null;
    for (const collection of COLLECTIONS) fragment.document[collection] = fragment.document[collection].filter((item) => selected2.has(item.id));
    for (const parent of [...fragment.document.groups, ...fragment.document.lanes]) parent.members = parent.members.filter((id2) => selected2.has(id2));
    for (const note of fragment.document.annotations) if (!selected2.has(note.targetId)) note.targetId = null;
    fragment.document.laneOrder = fragment.document.laneOrder.filter((id2) => selected2.has(id2));
    fragment.document.emphasis = fragment.document.emphasis.filter((item) => selected2.has(item.targetId));
    fragment.document.accessibility.readingOrder = fragment.document.accessibility.readingOrder.filter((id2) => selected2.has(id2));
    fragment.presentation.elements = fragment.presentation.elements.filter((item) => selected2.has(item.elementId));
    const sourceBundle = sealBundle(fragment);
    const checked = validateAuthoringBundle(sourceBundle);
    if (!checked.ok) return checked;
    const value = { kind: "openplanr-diagram-selection", version: 1, sourceBundle, ids: [...selected2] };
    if (size(value) > MAX_BYTES) return fail4("The copied fragment exceeds 1 MiB. Copy fewer objects.");
    return { ok: true, value };
  }
  function pasteDiagramSelection(bundle, input, { idMap, transactionId, dx = 24, dy = 24 }) {
    if (typeof input === "string") {
      if (input.length > MAX_BYTES || new TextEncoder().encode(input).length > MAX_BYTES) return fail4("The clipboard exceeds 1 MiB.");
      try {
        input = JSON.parse(input);
      } catch {
        return fail4("The clipboard does not contain an OpenPlanr selection.");
      }
    }
    if (inspectPlainData(input).length || !input || input.kind !== "openplanr-diagram-selection" || input.version !== 1 || Object.keys(input).some((key) => !["kind", "version", "sourceBundle", "ids"].includes(key)) || !Array.isArray(input.ids) || input.ids.length > MAX_ELEMENTS || size(input) > MAX_BYTES) return fail4("Invalid or oversized clipboard fragment.");
    return compileDiagramCommand(bundle, { type: "paste", sourceBundle: input.sourceBundle, ids: input.ids, idMap, dx, dy }, { transactionId });
  }

  // lib/artifact/ui/diagram-editor-actions.mjs
  var freshId = (prefix = "edit") => `${prefix}-${globalThis.crypto.randomUUID()}`;
  var labelOf = (value) => value.label ?? value.text ?? value.id;
  var transaction = (bundle, operations) => ({ kind: "diagram-edit-transaction", schemaVersion: "1.0.0", protocolVersion: "1.13.0", transactionId: freshId(), diagramId: bundle.diagramId, base: snapshot2(bundle), operations, undoOf: null });
  function placement3(id2, shape2, bounds2) {
    return {
      elementId: id2,
      bounds: bounds2,
      route: null,
      label: null,
      zIndex: shape2 === "container" ? 0 : 1,
      appearance: { shape: shape2, fill: shape2 === "text" || shape2 === "container" ? "transparent" : "surface", stroke: shape2 === "text" ? "none" : "default", strokeWidth: 1.5, strokeStyle: "solid", fontSize: 14, textAlign: shape2 === "container" || shape2 === "text" ? "left" : "center" },
      locks: { position: false, size: false, route: false }
    };
  }
  function createObject(kind, position) {
    const id2 = freshId(kind === "horizontal-lane" || kind === "vertical-lane" ? "lane" : kind);
    const { x, y } = position;
    const bounds2 = { x, y, width: 160, height: 72 };
    let collection = "nodes", value, shape2 = "rectangle";
    if (kind === "annotation") {
      collection = "annotations";
      value = { id: id2, text: "Add a note", targetId: null };
      shape2 = "text";
    } else if (kind === "container" || kind.endsWith("-lane")) {
      collection = kind === "container" ? "groups" : "lanes";
      value = { id: id2, label: kind === "container" ? "Container" : "Lane", members: [] };
      shape2 = "container";
      Object.assign(bounds2, kind === "vertical-lane" ? { width: 240, height: 480 } : { width: 540, height: 240 });
    } else {
      const names = { process: "Process", start: "Start", end: "End", decision: "Decision", "data-store": "Data store", component: "Component" };
      value = { id: id2, label: names[kind], kind, description: null };
      shape2 = { start: "ellipse", end: "ellipse", decision: "diamond", "data-store": "cylinder", component: "rounded-rectangle" }[kind] ?? "rectangle";
      if (kind === "decision") bounds2.height = 100;
    }
    return { type: "create", elements: [{ collection, value }], presentation: [placement3(id2, shape2, bounds2)] };
  }
  function connector(from, to, label = "") {
    const id2 = freshId("connector");
    const entry2 = placement3(id2, "connector", null);
    entry2.route = { mode: "automatic", strategy: "orthogonal", from: { side: "right", offset: 0.5 }, to: { side: "left", offset: 0.5 }, points: [] };
    return { type: "create", elements: [{ collection: "relations", value: { id: id2, from, to, label: label || null, kind: "flow", direction: "forward", weight: null } }], presentation: [entry2] };
  }
  function processTemplate(position) {
    const start = createObject("start", position), process = createObject("process", { x: position.x + 240, y: position.y }), end = createObject("end", { x: position.x + 480, y: position.y });
    const first = connector(start.elements[0].value.id, process.elements[0].value.id), second = connector(process.elements[0].value.id, end.elements[0].value.id);
    const parts = [start, process, end, first, second];
    return { type: "create", elements: parts.flatMap((part) => part.elements), presentation: parts.flatMap((part) => part.presentation) };
  }
  function duplicateSelection(bundle, ids2, copied = null) {
    const result = copied ? { ok: true, value: copied } : copyDiagramSelection(bundle, ids2);
    if (!result.ok) return result;
    const idMap = Object.fromEntries(result.value.ids.map((id2) => [id2, freshId("copy")]));
    const preview2 = pasteDiagramSelection(bundle, result.value, { idMap, transactionId: freshId(), dx: 24, dy: 24 });
    return { ...preview2, selectedIds: ids2.filter((id2) => idMap[id2]).map((id2) => idMap[id2]) };
  }
  function propertyTransaction(bundle, id2, { semantic, geometry, appearance: appearance2 }) {
    const entry2 = elementIndex(bundle.document).get(id2);
    const current = bundle.presentation.elements.find((item) => item.elementId === id2);
    const operations = [];
    if (semantic) operations.push({ type: "update-semantics", collection: entry2.collection, elementId: id2, before: semanticFields(entry2.collection, entry2.value), after: semantic });
    if (geometry) {
      const before = geometryFields(current);
      let changes = [{ elementId: id2, before, after: geometry }];
      if (before.bounds && geometry.bounds && (before.bounds.x !== geometry.bounds.x || before.bounds.y !== geometry.bounds.y)) {
        const moved = compileDiagramCommand(bundle, {
          type: "move",
          ids: [id2],
          dx: geometry.bounds.x - before.bounds.x,
          dy: geometry.bounds.y - before.bounds.y
        }, { transactionId: freshId() });
        if (moved.ok && moved.transaction) {
          changes = moved.transaction.operations.flatMap((operation2) => operation2.changes ?? []);
          const target = changes.find((change) => change.elementId === id2);
          if (target) target.after = {
            ...target.after,
            bounds: geometry.bounds,
            route: same2(geometry.route, before.route) ? target.after.route : geometry.route,
            label: same2(geometry.label, before.label) ? target.after.label : geometry.label,
            zIndex: geometry.zIndex
          };
        }
      }
      operations.push({ type: "set-geometry", changes });
    }
    if (appearance2) operations.push({ type: "set-appearance-locks", changes: [{ elementId: id2, before: appearanceFields(current), after: appearance2 }] });
    return transaction(bundle, operations);
  }
  function arrangementCommand(bundle, ids2, mode) {
    const parents = parentIndex(bundle.document), selected2 = new Set(ids2);
    const roots2 = ids2.filter((id2) => {
      let parent = parents.get(id2);
      while (parent) {
        if (selected2.has(parent)) return false;
        parent = parents.get(parent);
      }
      return true;
    });
    const placements = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
    const boxes = roots2.map((id2) => placements.get(id2)).filter((item) => item?.bounds);
    if (boxes.length < 2) throw new Error("Select at least two shapes or containers.");
    const horizontal = mode.endsWith("horizontal");
    if (mode.startsWith("distribute") && boxes.length < 3) throw new Error("Select at least three shapes to distribute.");
    const ordered = [...boxes].sort((a, b) => a.bounds[horizontal ? "x" : "y"] - b.bounds[horizontal ? "x" : "y"]);
    const first = ordered[0].bounds, last = ordered.at(-1).bounds;
    const totalSize = ordered.reduce((sum, item) => sum + item.bounds[horizontal ? "width" : "height"], 0);
    const gap = ((horizontal ? last.x + last.width - first.x : last.y + last.height - first.y) - totalSize) / (boxes.length - 1);
    let offset = horizontal ? first.x : first.y;
    const changes = /* @__PURE__ */ new Map();
    for (const item of mode.startsWith("distribute") ? ordered : boxes) {
      const bounds2 = item.bounds;
      let dx = 0, dy = 0;
      if (mode === "align-left") dx = Math.min(...boxes.map((p) => p.bounds.x)) - bounds2.x;
      if (mode === "align-top") dy = Math.min(...boxes.map((p) => p.bounds.y)) - bounds2.y;
      if (mode === "align-center") dx = boxes[0].bounds.x + boxes[0].bounds.width / 2 - bounds2.x - bounds2.width / 2;
      if (mode.startsWith("distribute")) {
        if (horizontal) dx = offset - bounds2.x;
        else dy = offset - bounds2.y;
        offset += bounds2[horizontal ? "width" : "height"] + gap;
      }
      const preview2 = compileDiagramCommand(bundle, { type: "move", ids: [item.elementId], dx, dy }, { transactionId: freshId() });
      if (!preview2.ok) throw new Error(preview2.diagnostics[0].detail);
      for (const op of preview2.transaction?.operations ?? []) for (const change of op.changes ?? []) changes.set(change.elementId, change);
    }
    return { type: "geometry", changes: [...changes.values()] };
  }
  function laneArrangementCommand(bundle, laneId, direction) {
    const lane = [...bundle.document.lanes, ...bundle.document.groups].find((item) => item.id === laneId);
    if (!lane) throw new Error("Select a lane or container.");
    const byId = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
    const container2 = byId.get(laneId), before = geometryFields(container2), horizontal = direction === "horizontal";
    let x = container2.bounds.x + 24, y = container2.bounds.y + 48, cross = 0;
    const changes = /* @__PURE__ */ new Map();
    for (const member of lane.members) {
      const bounds2 = byId.get(member).bounds;
      if (!bounds2) continue;
      const preview2 = compileDiagramCommand(bundle, { type: "move", ids: [member], dx: x - bounds2.x, dy: y - bounds2.y }, { transactionId: freshId() });
      if (preview2.ok) for (const op of preview2.transaction?.operations ?? []) for (const change of op.changes ?? []) changes.set(change.elementId, change);
      else {
        const moved = new Set(descendants(bundle.document, [member]));
        for (const edge of bundle.document.relations) if (moved.has(edge.from) && moved.has(edge.to)) moved.add(edge.id);
        for (const id2 of moved) {
          const old = geometryFields(byId.get(id2)), next = clone(old), dx = x - bounds2.x, dy = y - bounds2.y;
          if (next.bounds) {
            next.bounds.x += dx;
            next.bounds.y += dy;
          }
          if (next.label) {
            next.label.x += dx;
            next.label.y += dy;
          }
          if (next.route?.mode === "manual") next.route.points = next.route.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          changes.set(id2, { elementId: id2, before: old, after: next });
        }
      }
      if (horizontal) x += bounds2.width + 40;
      else y += bounds2.height + 40;
      cross = Math.max(cross, bounds2[horizontal ? "height" : "width"]);
    }
    const after = clone(before);
    after.bounds.width = Math.max(240, horizontal ? x - before.bounds.x - 16 : cross + 48);
    after.bounds.height = Math.max(160, horizontal ? cross + 72 : y - before.bounds.y - 16);
    changes.set(laneId, { elementId: laneId, before, after });
    return { type: "geometry", changes: [...changes.values()] };
  }
  function addOrthogonalDetour(points) {
    if (points.length < 2) throw new Error("The connector needs two attached endpoints.");
    const lengths = points.slice(1).map((point2, index3) => Math.hypot(point2.x - points[index3].x, point2.y - points[index3].y));
    const index2 = lengths.indexOf(Math.max(...lengths));
    const start = points[index2], end = points[index2 + 1];
    if (lengths[index2] < 24) throw new Error("The connector segment is too short for a bend.");
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const detour = horizontal ? [{ x: Math.round((start.x + end.x) / 2), y: start.y }, { x: Math.round((start.x + end.x) / 2), y: start.y + 40 }, { x: end.x, y: start.y + 40 }] : [{ x: start.x, y: Math.round((start.y + end.y) / 2) }, { x: start.x + 40, y: Math.round((start.y + end.y) / 2) }, { x: start.x + 40, y: end.y }];
    return [...points.slice(0, index2 + 1), ...detour, ...points.slice(index2 + 1)];
  }
  function moveOrthogonalBend(points, index2, dx, dy) {
    if (index2 <= 0 || index2 >= points.length - 1) throw new Error("Only an interior bend can move.");
    const next = points.map((point2) => ({ ...point2 }));
    const before = points[index2 - 1], corner = points[index2], after = points[index2 + 1];
    const x = Math.round(corner.x + dx), y = Math.round(corner.y + dy);
    if (before.x === corner.x) {
      next[index2].x = index2 === 1 ? before.x : x;
      if (index2 > 1) next[index2 - 1].x = x;
    } else {
      next[index2].y = index2 === 1 ? before.y : y;
      if (index2 > 1) next[index2 - 1].y = y;
    }
    if (after.x === corner.x) {
      next[index2].x = index2 === points.length - 2 ? after.x : x;
      if (index2 < points.length - 2) next[index2 + 1].x = x;
    } else {
      next[index2].y = index2 === points.length - 2 ? after.y : y;
      if (index2 < points.length - 2) next[index2 + 1].y = y;
    }
    return next;
  }

  // lib/artifact/ui/diagram-editor-properties.mjs
  function renderDiagramProperties({ root, state, editable, act, submitTransaction }) {
    const document2 = root.ownerDocument, bundle = state.bundle, ids2 = state.view.selection;
    root.replaceChildren();
    if (!bundle) {
      root.append(element(document2, "p", {}, "Access changed. Reopen this diagram with a current owner session."));
      return;
    }
    const byId = elementIndex(bundle.document), placements = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
    const heading = element(document2, "h2", {}, ids2.length === 0 ? "Diagram details" : ids2.length > 1 ? `${ids2.length} objects selected` : labelOf(byId.get(ids2[0]).value));
    root.append(heading);
    if (!ids2.length) {
      root.append(element(document2, "p", { className: "de-muted" }, bundle.document.title), element(document2, "p", {}, editable ? "Select an object on the canvas or in the outline to edit its properties." : "Select an object to inspect its properties."), element(document2, "p", { className: "de-muted" }, `Profile: ${bundle.document.grammar.id}. Layout and meaning are saved together.`));
      const title = field(document2, "Diagram title", bundle.document.title, { maxlength: 240, disabled: !editable });
      root.append(title.label);
      const changeTitle = button(document2, "Update title", "update-title", { disabled: !editable });
      changeTitle.onclick = () => act("update-title", title.input.value);
      root.append(changeTitle);
      return;
    }
    const actionRow = (...items) => {
      const row = element(document2, "div", { className: "de-actions" });
      for (const [name, action] of items) row.append(button(document2, name, action, { disabled: !editable }));
      root.append(row);
    };
    if (ids2.length > 1) {
      root.append(element(document2, "p", { className: "de-muted" }, ids2.slice(0, 8).map((id3) => labelOf(byId.get(id3).value)).join(", ")));
      actionRow(["Align left", "align-left"], ["Align top", "align-top"], ["Align centers", "align-center"]);
      actionRow(["Distribute horizontally", "distribute-horizontal"], ["Distribute vertically", "distribute-vertical"]);
      actionRow(["Group selection", "group"], ["Ungroup selection", "ungroup"], ["Connect selection", "connect"]);
      actionRow(["Copy", "copy"], ["Paste", "paste"], ["Duplicate", "duplicate"]);
      actionRow(["Lock selection", "lock"], ["Unlock selection", "unlock"], ["Delete selection…", "delete"]);
      parentControl(ids2);
      return;
    }
    const id2 = ids2[0], entry2 = byId.get(id2), place = placements.get(id2), sem = semanticFields(entry2.collection, entry2.value), geom = geometryFields(place), look = appearanceFields(place);
    const form = element(document2, "form", { className: "de-properties-form", "aria-label": "Object properties" });
    const inputs = /* @__PURE__ */ new Map();
    const add = (name, value, options = {}) => {
      const item = field(document2, name, value, { disabled: !editable, ...options });
      inputs.set(name, item.input);
      form.append(item.label);
      return item.input;
    };
    add("Label", labelOf(entry2.value), { maxlength: 500 });
    if (entry2.collection === "nodes") {
      add("Description", sem.description, { multiline: true, maxlength: 4e3 });
      add("Semantic role", sem.kind, { choices: ["process", "start", "end", "decision", "data-store", "component"] });
    }
    if (geom.bounds) {
      const grid = element(document2, "div", { className: "de-field-grid" });
      for (const [name, key] of [["X", "x"], ["Y", "y"], ["Width", "width"], ["Height", "height"]]) {
        const lock = ["x", "y"].includes(key) ? place.locks.position : place.locks.size;
        const item = field(document2, name, geom.bounds[key], { type: "number", step: "1", min: ["width", "height"].includes(key) ? 1 : -1e6, max: 1e6, disabled: !editable || lock });
        inputs.set(name, item.input);
        grid.append(item.label);
      }
      form.append(grid);
      if (place.locks.position || place.locks.size) form.append(element(document2, "p", { className: "de-muted" }, "Geometry is locked. Use Unlock selection to change it."));
    }
    if (entry2.collection === "relations") {
      const choices = bundle.document.nodes.map((node2) => [node2.id, node2.label]);
      add("From", sem.from, { choices });
      add("To", sem.to, { choices });
      add("Direction", sem.direction, { choices: [["forward", "Forward"], ["both", "Both directions"], ["none", "No arrow"]] });
      add("Relationship", sem.kind, { choices: ["association", "dependency", "flow", "message", "transition"] });
      add("Routing", geom.route.strategy, { choices: ["straight", "orthogonal"], disabled: !editable || place.locks.route });
      add("Start side", geom.route.from.side, { choices: ["top", "right", "bottom", "left"], disabled: !editable || place.locks.route });
      add("End side", geom.route.to.side, { choices: ["top", "right", "bottom", "left"], disabled: !editable || place.locks.route });
      const bends = element(document2, "fieldset");
      bends.append(element(document2, "legend", {}, "Bend points"));
      const points = geom.route.mode === "manual" ? geom.route.points.slice(1, -1) : [];
      points.forEach((point2, index2) => {
        const row = element(document2, "div", { className: "de-field-grid" });
        for (const key of ["x", "y"]) {
          const item = field(document2, `Bend ${index2 + 1} ${key.toUpperCase()}`, point2[key], { type: "number", disabled: !editable || place.locks.route });
          inputs.set(`bend-${index2}-${key}`, item.input);
          row.append(item.label);
        }
        const remove = button(document2, `Remove bend ${index2 + 1}`, "remove-bend", { disabled: !editable || place.locks.route });
        remove.onclick = () => act("remove-bend", index2);
        row.append(remove);
        bends.append(row);
      });
      const addBend = button(document2, "Add bend", "add-bend", { disabled: !editable || place.locks.route });
      bends.append(addBend);
      form.append(bends);
      const reset = button(document2, "Reset route", "reset-route", { disabled: !editable || place.locks.route });
      form.append(reset);
      if (geom.label) {
        add("Label X", geom.label.x, { type: "number" });
        add("Label Y", geom.label.y, { type: "number" });
        add("Label width", geom.label.width, { type: "number", min: 1 });
      } else form.append(button(document2, "Position label", "position-label", { disabled: !editable }));
    }
    add("Fill", look.appearance.fill, { choices: ["surface", "accent", "success", "warning", "danger", "transparent"] });
    add("Stroke", look.appearance.stroke, { choices: ["default", "accent", "muted", "danger", "none"] });
    add("Line style", look.appearance.strokeStyle, { choices: ["solid", "dashed", "dotted"] });
    add("Font size", look.appearance.fontSize, { type: "number", min: 12, max: 48 });
    for (const [name, key] of [["Lock position", "position"], ["Lock size", "size"], ["Lock route", "route"]]) {
      if (key === "route" && entry2.collection !== "relations") continue;
      if (key !== "route" && !geom.bounds) continue;
      add(name, look.locks[key], { type: "checkbox" });
    }
    const apply = element(document2, "button", { type: "submit", className: "de-primary", disabled: !editable }, "Apply properties");
    form.append(apply);
    root.append(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!editable) return;
      const nextSem = clone(sem), nextGeom = clone(geom), nextLook = clone(look);
      const value = (name) => inputs.get(name)?.value;
      const number = (name) => Number(value(name));
      if (entry2.collection === "annotations") nextSem.text = value("Label");
      else nextSem.label = value("Label") || (entry2.collection === "relations" ? null : "");
      if (entry2.collection === "nodes") {
        nextSem.description = value("Description") || null;
        nextSem.kind = value("Semantic role");
        nextLook.appearance.shape = { process: "rectangle", start: "ellipse", end: "ellipse", decision: "diamond", "data-store": "cylinder", component: "rounded-rectangle" }[nextSem.kind];
      }
      if (nextGeom.bounds) for (const [name, key] of [["X", "x"], ["Y", "y"], ["Width", "width"], ["Height", "height"]]) nextGeom.bounds[key] = number(name);
      if (entry2.collection === "relations") {
        nextSem.from = value("From");
        nextSem.to = value("To");
        nextSem.direction = value("Direction");
        nextSem.kind = value("Relationship");
        nextGeom.route.strategy = value("Routing");
        nextGeom.route.from.side = value("Start side");
        nextGeom.route.to.side = value("End side");
        if (nextGeom.route.mode === "manual") nextGeom.route.points.slice(1, -1).forEach((_, index2) => {
          const original = geom.route.points[index2 + 1], x = number(`bend-${index2}-x`), y = number(`bend-${index2}-y`);
          if (x === original.x && y === original.y) return;
          if (nextGeom.route.strategy === "orthogonal") nextGeom.route.points = moveOrthogonalBend(nextGeom.route.points, index2 + 1, x - nextGeom.route.points[index2 + 1].x, y - nextGeom.route.points[index2 + 1].y);
          else nextGeom.route.points[index2 + 1] = { x, y };
        });
        if (nextGeom.label) nextGeom.label = { x: number("Label X"), y: number("Label Y"), width: number("Label width") };
      }
      nextLook.appearance.fill = value("Fill");
      nextLook.appearance.stroke = value("Stroke");
      nextLook.appearance.strokeStyle = value("Line style");
      nextLook.appearance.fontSize = number("Font size");
      for (const [name, key] of [["Lock position", "position"], ["Lock size", "size"], ["Lock route", "route"]]) if (inputs.has(name)) nextLook.locks[key] = inputs.get(name).checked;
      submitTransaction(propertyTransaction(bundle, id2, { semantic: nextSem, geometry: nextGeom, appearance: nextLook }));
    });
    if (entry2.collection !== "relations") parentControl(ids2);
    if (["groups", "lanes"].includes(entry2.collection)) {
      const heading2 = element(document2, "h3", {}, "Members");
      root.append(heading2);
      for (const member of entry2.value.members) root.append(button(document2, labelOf(byId.get(member).value), "select-member", { "data-member": member }));
      if (!entry2.value.members.length) root.append(element(document2, "p", { className: "de-muted" }, "No members. Select objects and choose this parent to add them."));
      actionRow(["Arrange horizontally…", "lane-horizontal"], ["Arrange vertically…", "lane-vertical"], ["Ungroup", "ungroup"]);
      if (entry2.collection === "lanes") actionRow(["Move lane up", "lane-up"], ["Move lane down", "lane-down"]);
      root.append(button(document2, state.view.collapsedGroups.includes(id2) ? "Expand contents" : "Collapse contents", "collapse"));
    }
    actionRow(["Copy", "copy"], ["Duplicate", "duplicate"], ["Unlock selection", "unlock"], ["Delete selection…", "delete"]);
    root.append(element(document2, "p", { className: "de-reference" }, `Reference: ${id2}`));
    function parentControl(selectedIds) {
      const parents = parentIndex(bundle.document), current = parents.get(selectedIds[0]) ?? "";
      const choices = [["", "Diagram root"], ...[...bundle.document.groups, ...bundle.document.lanes].filter((item) => !selectedIds.includes(item.id)).map((item) => [item.id, item.label])];
      const parent = field(document2, "Parent", current, { choices, disabled: !editable });
      root.append(parent.label);
      const apply2 = button(document2, "Move to parent", "reparent", { disabled: !editable });
      apply2.onclick = () => act("reparent", parent.input.value || null);
      root.append(apply2);
    }
  }

  // lib/artifact/ui/diagram-conflicts.mjs
  function mountDiagramConflicts({ root, session, onClose = () => {
  }, onError = () => {
  } }) {
    const document2 = root.ownerDocument;
    const state = session.getState(), comparison = state.comparison;
    if (!comparison || !state.bundle) return { dispose() {
    } };
    const { base, bundle: current } = comparison;
    const pending = state.bundle;
    const panel = element(document2, "section", { className: "de-conflict", "aria-label": "Compare conflicting changes" });
    panel.append(element(document2, "h2", {}, "Review conflicting changes"), element(document2, "p", {}, "The saved diagram changed. Your draft is retained. Compare changes before choosing what to keep."));
    const rows = /* @__PURE__ */ new Map();
    for (const [side, value] of [["current", current], ["draft", pending]]) {
      const diff = diffDiagramBundles(base, value);
      if (!diff.ok) {
        onError(diff);
        return { dispose() {
        } };
      }
      for (const dimension of ["semantic", "presentation"]) for (const change of diff[dimension]) {
        const key = JSON.stringify([dimension, change.collection, change.elementId, change.path]);
        if (!rows.has(key)) rows.set(key, { dimension, change, base: change.before, current: change.before, draft: change.before });
        rows.get(key)[side] = change.after;
      }
    }
    const table = element(document2, "table");
    const header = element(document2, "tr");
    for (const title of ["Change", "Base", "Current", "Your draft"]) header.append(element(document2, "th", { scope: "col" }, title));
    const thead = element(document2, "thead");
    thead.append(header);
    table.append(thead);
    const tbody = element(document2, "tbody");
    const readable = (value) => value === null ? "Removed / absent" : typeof value === "object" ? JSON.stringify(value) : String(value);
    for (const row of [...rows.values()].slice(0, 200)) {
      const tr = element(document2, "tr");
      tr.append(element(document2, "th", { scope: "row" }, `${row.dimension === "semantic" ? "Meaning" : "Layout"} · ${row.change.elementId ?? "Diagram"} · ${row.change.path.join(".") || row.change.collection}`));
      for (const side of ["base", "current", "draft"]) tr.append(element(document2, "td", {}, readable(row[side])));
      tbody.append(tr);
    }
    table.append(tbody);
    const scroll = element(document2, "div", { className: "de-comparison-scroll", tabindex: "0", "aria-label": "Change comparison" });
    scroll.append(table);
    panel.append(scroll);
    if (!rows.size) panel.append(element(document2, "p", {}, "The content matches the saved revision. Retry Save to confirm the pending transaction."));
    if (rows.size > 200) panel.append(element(document2, "p", {}, `Showing 200 of ${rows.size} changes. Download your complete draft before resolving.`));
    const controls = element(document2, "div", { className: "de-actions" });
    const keep = button(document2, "Keep my draft", "keep-draft"), download = button(document2, "Download my draft", "download-draft"), adopt = button(document2, "Use current revision…", "use-current");
    controls.append(keep, download, adopt);
    panel.append(controls);
    const confirmation = element(document2, "div", { className: "de-confirm", hidden: true });
    confirmation.append(element(document2, "p", {}, "Replace this local draft with the current saved revision? Pending edits and undo history will be removed. Download your draft first if you want to keep a copy."));
    const confirm = button(document2, "Replace local draft", "confirm-current"), cancel = button(document2, "Keep editing my draft", "cancel-current");
    confirmation.append(confirm, cancel);
    panel.append(confirmation);
    root.replaceChildren(panel);
    keep.onclick = () => onClose();
    download.onclick = () => downloadJson(document2, pending, `${pending.diagramId}.draft.planr-diagram-bundle.json`);
    adopt.onclick = () => {
      confirmation.hidden = false;
      cancel.focus();
    };
    cancel.onclick = () => {
      confirmation.hidden = true;
      adopt.focus();
    };
    confirm.onclick = () => {
      const result = session.useAuthoritative();
      if (result.ok) onClose();
      else onError(result);
    };
    return { dispose() {
      panel.remove();
    } };
  }

  // lib/artifact/ui/diagram-editor.mjs
  var SVG = "http://www.w3.org/2000/svg";
  var MODELS = ["process", "start", "end", "decision", "data-store", "component", "annotation", "container", "horizontal-lane", "vertical-lane"];
  var ACTION_LABELS = { process: "process", start: "start", end: "end", decision: "decision", "data-store": "data store", component: "component", annotation: "annotation", container: "container", "horizontal-lane": "horizontal lane", "vertical-lane": "vertical lane" };
  var errText = (result) => result?.diagnostics?.map((item) => item.detail).filter(Boolean).join(" ") || result?.message || "The change could not be applied.";
  var boundsOf = (bundle) => {
    const rects = bundle.presentation.elements.map((item) => item.bounds).filter(Boolean);
    if (!rects.length) return { x: -200, y: -120, width: 400, height: 240 };
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const rect of rects) {
      x = Math.min(x, rect.x);
      y = Math.min(y, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  };
  var safeAction = (fn, report) => {
    try {
      return fn();
    } catch (error2) {
      report(error2 instanceof Error ? error2.message : "The edit is invalid.");
      return null;
    }
  };
  var intersect = (a, b) => a && b && a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
  var focusable = (element2) => element2?.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"]');
  function mountDiagramEditor({ root, session, host = {} }) {
    if (!root || !session || typeof session.getState !== "function") throw new TypeError("Mount needs one root and one editor session.");
    const doc = root.ownerDocument, win = doc.defaultView;
    let disposed = false, raf = 0, drag = null, tempPan = false, tool = "select", tab = "outline", rightTab = "properties";
    let leftOpen = true, rightOpen = true, clipboard = null, dialog = null, conflictMount = null, reviewCleanup = null;
    let elementNodes = /* @__PURE__ */ new Map(), renderSignatures = /* @__PURE__ */ new Map(), renderedDigest = "", lastCanvas = null, lastBreakpoint = null, mode = "edit", lastAnnouncement = "";
    const shell = element(doc, "div", { className: "planr-diagram-editor" });
    shell.innerHTML = '<header class="de-bar"><div class="de-brand"><span class="de-mark" aria-hidden="true">◈</span><div class="de-identity"><strong class="de-title"></strong><small>Local diagram studio</small></div></div><span class="de-save-state" role="status" aria-live="polite"></span><div class="de-bar-actions"></div></header><div class="de-work"><aside class="de-left" aria-label="Diagram outline and shapes"><div class="de-rail-tabs" role="tablist" aria-label="Left panel"></div><div class="de-left-content"></div></aside><section class="de-stage"><div class="de-canvas" aria-label="Diagram canvas" role="application" tabindex="0"><svg data-editor-svg aria-label="Diagram drawing" role="img"><g data-world></g><g data-overlays></g></svg><div class="de-empty"></div><div class="de-canvas-tools"></div><div class="de-mobile-message">Review on mobile. Open on desktop to edit.</div></div><div class="de-stage-footer"></div></section><aside class="de-right" aria-label="Diagram properties and review"><div class="de-right-tabs" role="tablist" aria-label="Right panel"></div><div class="de-right-content"></div></aside></div><div class="de-alert" role="alert" hidden></div><div class="de-announcer" aria-live="polite" aria-atomic="true"></div><div class="de-dialog-layer"></div>';
    root.replaceChildren(shell);
    const $ = (selector) => shell.querySelector(selector);
    const bar = $(".de-bar-actions"), saveState = $(".de-save-state"), leftTabs = $(".de-rail-tabs"), leftBody = $(".de-left-content");
    const rightTabs = $(".de-right-tabs"), rightBody = $(".de-right-content"), stage = $(".de-canvas"), svg = $("[data-editor-svg]");
    const world = $("[data-world]"), overlays = $("[data-overlays]"), empty = $(".de-empty"), footer = $(".de-stage-footer");
    const alert = $(".de-alert"), announcer = $(".de-announcer"), dialogLayer = $(".de-dialog-layer");
    const createBar = (label, action, title = label) => {
      const node2 = button(doc, label, action, { title });
      bar.append(node2);
      return node2;
    };
    createBar("Outline", "outline", "Show or hide outline");
    createBar("Undo", "undo", "Undo · Ctrl or Command Z");
    createBar("Redo", "redo", "Redo · Ctrl or Command Shift Z");
    createBar("Layout", "layout");
    createBar("Save diagram", "save", "Save diagram · Ctrl or Command S").classList.add("de-primary");
    createBar("Properties", "properties", "Show or hide properties");
    createBar("More", "more");
    const canvasButton = (label, action) => {
      const node2 = button(doc, label, action);
      $(".de-canvas-tools").append(node2);
      return node2;
    };
    canvasButton("Select", "select-tool");
    canvasButton("Pan", "pan-tool");
    canvasButton("Snap", "snap");
    canvasButton("−", "zoom-out").setAttribute("aria-label", "Zoom out");
    canvasButton("+", "zoom-in").setAttribute("aria-label", "Zoom in");
    canvasButton("Fit", "fit");
    const notice = (message) => {
      if (message === lastAnnouncement) return;
      lastAnnouncement = message;
      announcer.textContent = message;
    };
    const report = (message) => {
      alert.hidden = !message;
      alert.textContent = message || "";
      if (message) notice(message);
    };
    const editable = (state) => mode === "edit" && win.innerWidth >= 700 && state.capabilities.read && state.capabilities.write && state.saveState !== "access-changed" && !!getDiagramAuthoringCapability(state.bundle?.document.grammar.id);
    const current = () => session.getState();
    const displayed = (state) => state.gesture?.bundle ?? state.bundle;
    const select = (ids2) => {
      const result = session.setView({ selection: [...new Set(ids2)] });
      if (!result.ok) report(errText(result));
      else notice(ids2.length ? ids2.length + " object" + (ids2.length === 1 ? "" : "s") + " selected." : "Selection cleared.");
      return result;
    };
    const submit = (command, selectIds) => {
      const result = session.submit(command);
      if (!result.ok) {
        report(errText(result));
        return result;
      }
      report("");
      if (selectIds?.length) select(selectIds);
      return result;
    };
    const submitTransaction = (value) => {
      const result = session.submitTransaction(value);
      if (!result.ok) report(errText(result));
      else report("");
      return result;
    };
    const fromClient = (event) => {
      const rect = svg.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const worldPoint = (point2, camera = current().view.camera) => ({ x: (point2.x - camera.x) / camera.scale, y: (point2.y - camera.y) / camera.scale });
    const cameraPatch = (camera) => session.setView({ camera });
    function fit() {
      const state = current();
      if (!state.bundle) return;
      const rect = stage.getBoundingClientRect(), bounds2 = boundsOf(state.bundle), pad = 72;
      const scale = Math.min(1.6, Math.max(0.04, Math.min((rect.width - pad * 2) / bounds2.width, (rect.height - pad * 2) / bounds2.height)));
      cameraPatch({ x: (rect.width - bounds2.width * scale) / 2 - bounds2.x * scale, y: (rect.height - bounds2.height * scale) / 2 - bounds2.y * scale, scale, fit: "all" });
    }
    function zoom(factor, around) {
      const camera = current().view.camera, point2 = around ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
      const scale = Math.min(4, Math.max(0.04, camera.scale * factor)), anchor = worldPoint(point2, camera);
      cameraPatch({ x: point2.x - anchor.x * scale, y: point2.y - anchor.y * scale, scale, fit: null });
    }
    function draw(event = { type: "initial", affectedIds: [] }) {
      if (disposed) return;
      const state = current(), bundle = displayed(state);
      if (!bundle) {
        world.replaceChildren();
        elementNodes.clear();
        renderChrome(state);
        return;
      }
      const camera = state.view.camera;
      world.setAttribute("transform", "translate(" + camera.x + " " + camera.y + ") scale(" + camera.scale + ")");
      overlays.setAttribute("transform", world.getAttribute("transform"));
      const byId = elementIndex(bundle.document), placements = new Map(bundle.presentation.elements.map((entry2) => [entry2.elementId, entry2]));
      const palette = authoredDiagramPalette(bundle.presentation.theme.themeId), emphasis2 = new Map(bundle.document.emphasis.map((entry2) => [entry2.targetId, entry2.level]));
      const selection = new Set(state.view.selection);
      const forceAll = event.type === "initial" || !elementNodes.size || renderedDigest === "" || event.type === "refresh";
      const affected = forceAll ? new Set(placements.keys()) : new Set(event.affectedIds ?? []);
      if (event.type === "content" && !affected.size) for (const id2 of placements.keys()) affected.add(id2);
      const parser = new win.DOMParser();
      for (const [id2, node2] of elementNodes) if (!placements.has(id2)) {
        node2.remove();
        elementNodes.delete(id2);
        renderSignatures.delete(id2);
      }
      for (let order = 0; order < bundle.presentation.elements.length; order++) {
        const entry2 = bundle.presentation.elements[order], id2 = entry2.elementId;
        const source = byId.get(id2);
        const signature = JSON.stringify([
          source,
          entry2,
          emphasis2.get(id2) ?? null,
          bundle.presentation.theme.themeId,
          source?.collection === "relations" ? [placements.get(source.value.from), placements.get(source.value.to)] : null
        ]);
        if (!elementNodes.has(id2) || (affected.has(id2) || forceAll) && renderSignatures.get(id2) !== signature) {
          const scene = resolveDiagramSceneElement(byId.get(id2), entry2, placements, order, emphasis2.get(id2) ?? null);
          const xml = parser.parseFromString('<svg xmlns="' + SVG + '">' + renderAuthoredSceneElement(scene, palette, bundle.diagramId) + "</svg>", "image/svg+xml");
          const replacement = doc.importNode(xml.documentElement.firstElementChild, true);
          replacement.setAttribute("tabindex", "-1");
          replacement.setAttribute("role", "img");
          replacement.setAttribute("aria-label", scene.label || scene.kind);
          const old = elementNodes.get(id2);
          if (old) old.replaceWith(replacement);
          else world.append(replacement);
          elementNodes.set(id2, replacement);
          renderSignatures.set(id2, signature);
        }
        const node2 = elementNodes.get(id2);
        node2.dataset.selected = String(selection.has(id2));
        node2.classList.toggle("de-selected", selection.has(id2));
      }
      if (event.type === "content" || event.type === "refresh" || forceAll) {
        const ordered = [...bundle.presentation.elements].sort((a, b) => a.zIndex - b.zIndex || bundle.presentation.elements.indexOf(a) - bundle.presentation.elements.indexOf(b));
        for (const entry2 of ordered) world.append(elementNodes.get(entry2.elementId));
      }
      renderedDigest = bundle.bundleDigest;
      shell.dataset.diagramTheme = bundle.presentation.theme.themeId;
      renderOverlays(state, bundle, selection);
      renderChrome(state);
    }
    function renderOverlays(state, bundle, selection) {
      overlays.replaceChildren();
      const scale = state.view.camera.scale, byPlacement = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
      for (const id2 of selection) {
        const geometry = session.geometry(id2), rect = geometry?.bounds ?? geometry?.labelBounds;
        if (rect) {
          const box = doc.createElementNS(SVG, "rect");
          for (const [key, value] of Object.entries({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) box.setAttribute(key, String(value));
          box.setAttribute("class", "de-selection-box");
          box.setAttribute("stroke-width", String(1.5 / scale));
          box.setAttribute("pointer-events", "none");
          overlays.append(box);
          if (selection.size === 1 && editable(state) && byPlacement.get(id2)?.bounds && !byPlacement.get(id2).locks.size) {
            const handle = doc.createElementNS(SVG, "rect");
            const size2 = 10 / scale;
            handle.setAttribute("x", String(rect.x + rect.width - size2 / 2));
            handle.setAttribute("y", String(rect.y + rect.height - size2 / 2));
            handle.setAttribute("width", String(size2));
            handle.setAttribute("height", String(size2));
            handle.setAttribute("rx", String(2 / scale));
            handle.setAttribute("class", "de-resize-handle");
            handle.setAttribute("data-handle", "resize");
            handle.setAttribute("data-handle-id", id2);
            overlays.append(handle);
          }
        }
        if (geometry?.points?.length && editable(state)) for (let index2 = 1; index2 < geometry.points.length - 1; index2++) {
          const point2 = geometry.points[index2], handle = doc.createElementNS(SVG, "circle");
          handle.setAttribute("cx", String(point2.x));
          handle.setAttribute("cy", String(point2.y));
          handle.setAttribute("r", String(5 / scale));
          handle.setAttribute("class", "de-bend-handle");
          handle.setAttribute("data-handle", "bend");
          handle.setAttribute("data-index", String(index2));
          handle.setAttribute("data-handle-id", id2);
          overlays.append(handle);
        }
      }
      if (drag?.type === "marquee") {
        const a = worldPoint(drag.start), b = worldPoint(drag.last), rect = doc.createElementNS(SVG, "rect");
        rect.setAttribute("x", String(Math.min(a.x, b.x)));
        rect.setAttribute("y", String(Math.min(a.y, b.y)));
        rect.setAttribute("width", String(Math.abs(a.x - b.x)));
        rect.setAttribute("height", String(Math.abs(a.y - b.y)));
        rect.setAttribute("class", "de-marquee");
        rect.setAttribute("stroke-width", String(1 / scale));
        overlays.append(rect);
      }
    }
    let controlsStamp = "";
    function renderChrome(state) {
      const bundle = state.bundle;
      $(".de-title").textContent = bundle?.document.title ?? "Diagram unavailable";
      const status = state.saveState;
      saveState.textContent = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved", offline: "Offline · Unsaved", conflict: "Conflict · Unsaved", "access-changed": "Access changed" }[status] ?? "Unsaved";
      saveState.dataset.state = status;
      shell.dataset.editable = String(editable(state));
      shell.dataset.mode = mode;
      shell.dataset.leftOpen = String(leftOpen);
      shell.dataset.rightOpen = String(rightOpen);
      for (const [action, disabled] of Object.entries({
        undo: !state.canUndo || !editable(state),
        redo: !state.canRedo || !editable(state),
        save: !editable(state) || status === "saving" || status === "saved" && state.pendingCount === 0 && !state.needsInitialization,
        layout: !editable(state),
        properties: !state.capabilities.read,
        outline: !state.capabilities.read
      })) {
        const control = bar.querySelector('[data-action="' + action + '"]');
        if (control) control.disabled = disabled;
      }
      const stamp = [
        bundle?.bundleDigest,
        state.view.selection.join("|"),
        state.view.collapsedGroups.join("|"),
        state.pendingCount,
        state.saveState,
        state.recovery.mode,
        tab,
        rightTab,
        mode,
        leftOpen,
        rightOpen,
        win.innerWidth < 700
      ].join(":");
      if (stamp === controlsStamp) return;
      controlsStamp = stamp;
      renderLeft(state);
      renderRight(state);
      renderFooter(state);
      const hasContent = bundle && bundle.presentation.elements.length > 0;
      empty.hidden = hasContent || !editable(state);
      if (!empty.hidden) {
        empty.replaceChildren(element(doc, "h2", {}, "Create your diagram"), element(doc, "p", {}, "Add a shape or start with a small process flow. Everything stays local until you save."));
        empty.append(button(doc, "Start blank", "blank", { className: "de-primary" }), button(doc, "Use process template", "template"));
        const guide = element(doc, "ol");
        for (const step of ["Add shapes and connectors", "Edit labels and layout", "Save the diagram"]) guide.append(element(doc, "li", {}, step));
        empty.append(guide);
      }
    }
    function renderLeft(state) {
      leftTabs.replaceChildren();
      if (win.innerWidth <= 1100) leftTabs.append(button(doc, "Close outline", "close-outline", { className: "de-close-rail" }));
      for (const [name, action] of [["Outline", "outline-tab"], ["Shapes", "shapes-tab"]]) {
        const item = button(doc, name, action, { role: "tab", "aria-selected": String(tab === name.toLowerCase()) });
        leftTabs.append(item);
      }
      leftBody.replaceChildren();
      if (!state.bundle) return;
      if (tab === "shapes") {
        leftBody.append(element(doc, "h2", {}, "Shape library"), element(doc, "p", { className: "de-muted" }, "Choose a shape, then edit its meaning and position."));
        const capability = getDiagramAuthoringCapability(state.bundle.document.grammar.id);
        for (const kind of MODELS) {
          const primitive = kind === "annotation" ? "annotation" : kind === "container" ? "group" : kind.endsWith("-lane") ? "lane" : "node";
          if (capability && !capability.primitives.includes(primitive)) continue;
          if (capability && primitive === "node" && !capability.nodeKinds.includes(kind)) continue;
          leftBody.append(button(doc, "Create " + ACTION_LABELS[kind], "create", { "data-kind": kind, className: "de-shape-button", disabled: !editable(state) }));
        }
        return;
      }
      const search = field(doc, "Find in diagram", "", { type: "search", placeholder: "Search objects" });
      leftBody.append(search.label);
      const list = element(doc, "div", { className: "de-outline-list", role: "tree", "aria-label": "Diagram objects" });
      leftBody.append(list);
      const indexed = elementIndex(state.bundle.document), parents = new Set([...state.bundle.document.groups, ...state.bundle.document.lanes].flatMap((value) => value.members));
      const expanded = new Set(state.view.collapsedGroups);
      function itemFor(id2, depth = 0) {
        const entry2 = indexed.get(id2);
        if (!entry2) return;
        const wrapper = element(doc, "div", { className: "de-outline-item", "data-search-text": labelOf(entry2.value).toLowerCase() });
        const choose = button(doc, labelOf(entry2.value), "select-id", { role: "treeitem", "data-id": id2, "aria-selected": String(state.view.selection.includes(id2)), style: "padding-inline-start:" + String(12 + depth * 14) + "px" });
        wrapper.append(choose);
        list.append(wrapper);
        if (entry2.value.members?.length && !expanded.has(id2)) for (const child of entry2.value.members) itemFor(child, depth + 1);
      }
      for (const id2 of state.bundle.document.accessibility.readingOrder) if (indexed.has(id2) && !parents.has(id2)) itemFor(id2);
      for (const [id2] of indexed) if (!parents.has(id2) && !list.querySelector('[data-id="' + id2 + '"]')) itemFor(id2);
      search.input.addEventListener("input", () => {
        const query = search.input.value.toLowerCase().trim();
        for (const row of list.querySelectorAll(".de-outline-item")) row.hidden = !!query && !row.dataset.searchText.includes(query);
      });
      if (!indexed.size) leftBody.append(element(doc, "p", { className: "de-muted" }, "No objects yet. Use Shapes to create one."));
    }
    function renderRight(state) {
      rightTabs.replaceChildren();
      if (win.innerWidth <= 1100) rightTabs.append(button(doc, "Close properties", "close-properties", { className: "de-close-rail" }));
      for (const [name, action] of [["Properties", "properties-tab"], ["Review", "review-tab"]]) rightTabs.append(button(doc, name, action, { role: "tab", "aria-selected": String(rightTab === name.toLowerCase()) }));
      rightBody.replaceChildren();
      if (!state.bundle) {
        rightBody.append(element(doc, "p", {}, "Access changed. Reopen this diagram."));
        return;
      }
      if (rightTab === "review") {
        rightBody.append(element(doc, "h2", {}, "Review"));
        if (typeof host.mountReview === "function") {
          const slot = element(doc, "div");
          rightBody.append(slot);
          reviewCleanup?.();
          reviewCleanup = host.mountReview({ root: slot, session, select }) ?? null;
        } else rightBody.append(element(doc, "p", { className: "de-muted" }, "Review comments are available after this diagram is published to a review workspace. Local editing does not publish it."));
        return;
      }
      reviewCleanup?.();
      reviewCleanup = null;
      const focused = doc.activeElement?.getAttribute("aria-label");
      renderDiagramProperties({ root: rightBody, state, editable: editable(state), act, submitTransaction });
      if (focused && rightBody.contains(doc.activeElement) === false && ["Apply properties"].includes(focused)) rightBody.querySelector('[aria-label="' + focused + '"]')?.focus();
    }
    function renderFooter(state) {
      footer.replaceChildren();
      if (state.saveState === "conflict") footer.append(element(doc, "span", {}, "A newer saved revision exists. Your draft remains in this tab."), button(doc, "Compare revisions", "conflict", { className: "de-primary" }));
      else if (state.saveState === "offline") footer.append(element(doc, "span", {}, "Save was not confirmed. Edits remain pending."), button(doc, "Retry save", "save"));
      else if (state.recovery.warning) footer.append(element(doc, "span", {}, state.recovery.warning));
      else if (state.pendingCount > 0 && state.acknowledged) footer.append(element(doc, "span", {}, "Recovered or pending edits are in this session. Review before you save."));
      else if (!getDiagramAuthoringCapability(state.bundle.document.grammar.id)) footer.append(element(doc, "span", {}, "This diagram grammar is available for inspection only. Editing is not certified."));
      else footer.append(element(doc, "span", {}, state.view.selection.length + " selected · " + state.bundle.presentation.elements.length + " objects"));
    }
    function closeDialog() {
      if (!dialog) return;
      dialog.remove();
      dialog = null;
      dialogLayer.replaceChildren();
      stage.focus();
    }
    function openDialog(name, content) {
      closeDialog();
      const panel = element(doc, "section", { role: "dialog", "aria-modal": "true", "aria-label": name, className: "de-dialog" });
      panel.append(element(doc, "h2", {}, name));
      if (content) panel.append(content);
      dialogLayer.append(panel);
      dialog = panel;
      panel.querySelector("button,input,select")?.focus();
      return panel;
    }
    function askDelete() {
      const state = current(), ids2 = state.view.selection;
      if (!ids2.length) return;
      const preview2 = compileDiagramCommand(state.bundle, { type: "delete", ids: ids2 }, { transactionId: freshId() });
      const impact = preview2.deletionImpact;
      if (!impact) {
        report(errText(preview2));
        return;
      }
      const body = element(doc, "div");
      body.append(element(doc, "p", {}, "Delete " + impact.elementIds.length + " object(s), including " + impact.relationIds.length + " connector(s)? This can be undone before another conflicting change."));
      if (impact.relationIds.length) body.append(element(doc, "p", { className: "de-muted" }, "Connectors: " + impact.relationIds.join(", ")));
      body.append(button(doc, "Cancel", "cancel-dialog"), button(doc, "Delete", "confirm-delete", { className: "de-danger" }));
      openDialog("Delete selection", body).dataset.impact = JSON.stringify(impact);
    }
    function connectDialog() {
      const state = current(), nodes = state.bundle.document.nodes;
      if (nodes.length < 2) {
        report("Create at least two nodes to connect.");
        return;
      }
      const body = element(doc, "div"), ids2 = state.view.selection;
      const from = field(doc, "From", ids2.find((id2) => nodes.some((node2) => node2.id === id2)) ?? nodes[0].id, { choices: nodes.map((node2) => [node2.id, node2.label]) });
      const to = field(doc, "To", ids2.find((id2) => nodes.some((node2) => node2.id === id2 && node2.id !== from.input.value)) ?? nodes.at(-1).id, { choices: nodes.map((node2) => [node2.id, node2.label]) });
      const label = field(doc, "Connector label", "");
      body.append(from.label, to.label, label.label, button(doc, "Cancel", "cancel-dialog"), button(doc, "Create connector", "confirm-connect", { className: "de-primary" }));
      openDialog("Connect objects", body);
    }
    function layoutDialog(lane = null) {
      const state = current(), body = element(doc, "div");
      body.append(element(doc, "p", {}, "Preview the arrangement before applying. No changes are saved during preview."));
      if (!lane) {
        const scope = field(doc, "Arrange", "selection", { choices: [["selection", "Selection"], ["all", "Whole diagram"]] });
        body.append(scope.label);
      }
      if (lane) body.append(element(doc, "p", {}, "Arrange direct members within this lane. Container geometry changes only when you apply."));
      body.append(button(doc, "Cancel layout", "cancel-layout"), button(doc, "Preview layout", "preview-layout", { className: "de-primary" }));
      const panel = openDialog("Layout preview", body);
      if (lane) panel.dataset.lane = lane;
    }
    function moreDialog() {
      const state = current(), body = element(doc, "div");
      body.append(element(doc, "p", {}, "Source and revision are read only. Export downloads this local bundle."));
      body.append(button(doc, "Show source", "show-source"), button(doc, "Show revision", "show-revision"), button(doc, "Export JSON", "export-json"), button(doc, "Close", "cancel-dialog"));
      openDialog("Diagram options", body);
    }
    async function save() {
      const state = current();
      if (state.saveState === "conflict") {
        act("conflict");
        return;
      }
      const result = await session.save();
      if (disposed) return;
      if (!result.ok) {
        report(errText(result));
        if (result.status === "conflict" && host.readCurrent) {
          try {
            const authoritative = await host.readCurrent();
            const compared = session.refresh(authoritative);
            if (!compared.ok && current().comparison) act("conflict");
          } catch (error2) {
            report(error2 instanceof Error ? error2.message : "Could not read current revision. Pending edits remain.");
          }
        }
      } else {
        report("");
        notice("Diagram saved.");
      }
    }
    function lockedSelection(bundle, ids2, next) {
      const changes = ids2.map((id2) => bundle.presentation.elements.find((item) => item.elementId === id2)).filter(Boolean).map((item) => {
        const before = appearanceFields(item), after = clone(before);
        if (item.bounds) {
          after.locks.position = next;
          after.locks.size = next;
        }
        if (item.route) after.locks.route = next;
        return { elementId: item.elementId, before, after };
      });
      return { type: "appearance", changes };
    }
    function act(action, value, options = {}) {
      const state = current(), bundle = state.bundle, ids2 = state.view.selection;
      if (!bundle && action !== "cancel-dialog") return;
      if (action === "save") return void save();
      if (action === "undo") {
        const result = session.undo();
        if (!result.ok) report(errText(result));
        return;
      }
      if (action === "redo") {
        const result = session.redo();
        if (!result.ok) report(errText(result));
        return;
      }
      if (action === "outline" || action === "close-outline") {
        leftOpen = action === "outline" ? !leftOpen : false;
        controlsStamp = "";
        renderChrome(current());
        if (leftOpen) leftTabs.querySelector("[data-action=outline-tab]")?.focus();
        else bar.querySelector("[data-action=outline]")?.focus();
        return;
      }
      if (action === "properties" || action === "close-properties") {
        rightOpen = action === "properties" ? !rightOpen : false;
        controlsStamp = "";
        renderChrome(current());
        if (rightOpen) rightTabs.querySelector("[data-action=properties-tab]")?.focus();
        else bar.querySelector("[data-action=properties]")?.focus();
        return;
      }
      if (action === "outline-tab" || action === "shapes-tab") {
        tab = action === "outline-tab" ? "outline" : "shapes";
        controlsStamp = "";
        renderChrome(state);
        return;
      }
      if (action === "properties-tab" || action === "review-tab") {
        rightTab = action === "properties-tab" ? "properties" : "review";
        controlsStamp = "";
        renderChrome(state);
        return;
      }
      if (action === "select-tool" || action === "pan-tool") {
        tool = action === "select-tool" ? "select" : "pan";
        notice(tool === "select" ? "Select mode" : "Pan mode");
        return;
      }
      if (action === "snap") {
        session.setView({ snap: !state.view.snap });
        notice(state.view.snap ? "Snap off" : "Snap on");
        return;
      }
      if (action === "fit") {
        fit();
        return;
      }
      if (action === "zoom-in") {
        zoom(1.2);
        return;
      }
      if (action === "zoom-out") {
        zoom(1 / 1.2);
        return;
      }
      if (action === "more") {
        moreDialog();
        return;
      }
      if (action === "show-source" || action === "show-revision") {
        dialog.replaceChildren(element(doc, "h2", {}, action === "show-source" ? "Source" : "Current revision"));
        const pre = element(doc, "pre", { className: "de-source-view" }, JSON.stringify(action === "show-source" ? { originalSource: bundle.originalSource, sourceMap: bundle.sourceMap } : snapshot2(bundle), null, 2));
        dialog.append(pre, button(doc, "Close", "cancel-dialog"));
        return;
      }
      if (action === "export-json") {
        downloadJson(doc, bundle, bundle.diagramId + ".planr-diagram-bundle.json");
        return;
      }
      if (action === "cancel-dialog") {
        if (state.gesture) session.cancelGesture("cancel-dialog");
        closeDialog();
        return;
      }
      if (action === "conflict") {
        const wrap = element(doc, "div");
        openDialog("Compare revisions", wrap);
        conflictMount?.dispose();
        conflictMount = mountDiagramConflicts({ root: wrap, session, onClose: closeDialog, onError: (result) => report(errText(result)) });
        return;
      }
      if (action === "layout") {
        layoutDialog();
        return;
      }
      if (action === "lane-horizontal" || action === "lane-vertical") {
        layoutDialog(action === "lane-horizontal" ? "horizontal" : "vertical");
        return;
      }
      if (action === "preview-layout") {
        if (state.gesture) session.cancelGesture("new-layout");
        const start = session.beginGesture();
        if (!start.ok) {
          report(errText(start));
          return;
        }
        let preview2;
        if (dialog.dataset.lane) {
          const laneId = ids2[0], direction = dialog.dataset.lane;
          preview2 = safeAction(() => session.previewGesture(laneArrangementCommand(bundle, laneId, direction)), report);
        } else {
          const scope = dialog.querySelector('[aria-label="Arrange"]').value;
          const targets = (scope === "all" ? bundle.presentation.elements.map((item) => item.elementId) : ids2).filter((id2) => !bundle.document.relations.some((relation2) => relation2.id === id2));
          preview2 = session.previewLayout({ targetIds: targets.slice(0, 256) });
        }
        if (!preview2?.ok) {
          if (preview2) report(errText(preview2));
          session.cancelGesture("invalid-layout");
          return;
        }
        dialog.querySelector('[data-action="preview-layout"]').replaceWith(button(doc, "Apply layout", "apply-layout", { className: "de-primary" }));
        dialog.append(element(doc, "p", { className: "de-muted" }, "Preview only · No changes saved. Apply as one undoable edit."));
        return;
      }
      if (action === "apply-layout") {
        const result = session.completeGesture();
        if (!result.ok) report(errText(result));
        else {
          closeDialog();
          notice("Layout applied as one edit. Save to keep it.");
        }
        return;
      }
      if (action === "cancel-layout") {
        session.cancelGesture("cancel-layout");
        closeDialog();
        return;
      }
      if (action === "blank") {
        empty.hidden = true;
        tab = "shapes";
        controlsStamp = "";
        renderChrome(state);
        return;
      }
      if (action === "template") {
        const at = worldPoint({ x: stage.clientWidth / 2 - 200, y: stage.clientHeight / 2 });
        const command = processTemplate({ x: Math.round(at.x), y: Math.round(at.y) });
        submit(command, command.elements.filter((item) => item.collection === "nodes").map((item) => item.value.id));
        fit();
        return;
      }
      if (action === "create") {
        const kind = value, at = worldPoint({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
        const existing = bundle.presentation.elements.map((item) => item.bounds).filter(Boolean);
        const right = existing.length ? Math.max(...existing.map((item) => item.x + item.width)) : null;
        const y = existing.length ? Math.min(...existing.map((item) => item.y)) : Math.round(at.y - 36);
        const command = createObject(kind, { x: right === null ? Math.round(at.x - 80) : Math.round(right + 64), y: Math.round(y) });
        const result = submit(command, [command.elements[0].value.id]);
        if (result.ok && state.view.camera.fit) fit();
        stage.focus();
        return;
      }
      if (action === "select-id" || action === "select-member") {
        const selected2 = options.additive ? ids2.includes(value) ? ids2.filter((id2) => id2 !== value) : [...ids2, value] : [value];
        select(selected2);
        const outlineItem = options.fromOutline ? [...leftBody.querySelectorAll('[data-action="select-id"]')].find((item) => item.dataset.id === value) : null;
        (outlineItem ?? stage).focus();
        return;
      }
      if (action === "connect") {
        connectDialog();
        return;
      }
      if (action === "confirm-connect") {
        const from = dialog.querySelector('[aria-label="From"]').value, to = dialog.querySelector('[aria-label="To"]').value, label = dialog.querySelector('[aria-label="Connector label"]').value;
        const command = connector(from, to, label);
        const result = submit(command, [command.elements[0].value.id]);
        if (result.ok) closeDialog();
        return;
      }
      if (action === "delete") {
        askDelete();
        return;
      }
      if (action === "confirm-delete") {
        const impact = JSON.parse(dialog.dataset.impact);
        const result = submit({ type: "delete", ids: ids2, confirmedImpact: impact });
        if (result.ok) {
          select([]);
          closeDialog();
        }
        return;
      }
      if (action === "update-title") {
        const before = { title: bundle.document.title, summary: bundle.document.summary, audience: bundle.document.audience, accessibility: bundle.document.accessibility };
        const after = clone(before);
        after.title = value;
        after.accessibility.title = value;
        submitTransaction(transaction(bundle, [{ type: "update-semantics", collection: "document", before, after }]));
        return;
      }
      if (action === "copy") {
        const copied = copyDiagramSelection(bundle, ids2);
        if (!copied.ok) report(errText(copied));
        else {
          clipboard = copied.value;
          notice("Selection copied.");
        }
        return;
      }
      if (action === "paste" || action === "duplicate") {
        const result = duplicateSelection(bundle, action === "paste" ? clipboard?.ids ?? [] : ids2, action === "paste" ? clipboard : null);
        if (!result?.ok) {
          report(errText(result));
          return;
        }
        const submitted = submitTransaction(result.transaction);
        if (submitted.ok) select(result.selectedIds);
        return;
      }
      if (action === "lock" || action === "unlock") {
        submit(lockedSelection(bundle, ids2, action === "lock"));
        return;
      }
      if (action.startsWith("align-") || action.startsWith("distribute-")) {
        const command = safeAction(() => arrangementCommand(bundle, ids2, action), report);
        if (command) submit(command);
        return;
      }
      if (action === "group") {
        const selected2 = ids2.map((id3) => bundle.presentation.elements.find((item) => item.elementId === id3)?.bounds).filter(Boolean);
        if (selected2.length < 2) {
          report("Select at least two bounded objects to group.");
          return;
        }
        const x = Math.min(...selected2.map((item) => item.x)) - 20, y = Math.min(...selected2.map((item) => item.y)) - 40;
        const width = Math.max(...selected2.map((item) => item.x + item.width)) - x + 20, height = Math.max(...selected2.map((item) => item.y + item.height)) - y + 20;
        const id2 = freshId("group");
        submit({ type: "group", group: { id: id2, label: "Group" }, ids: ids2, placement: placement3(id2, "container", { x, y, width, height }) }, [id2]);
        return;
      }
      if (action === "ungroup") {
        submit({ type: "ungroup", ids: ids2 });
        return;
      }
      if (action === "reparent") {
        submit({ type: "reparent", ids: ids2, parentId: value });
        return;
      }
      if (action === "lane-up" || action === "lane-down") {
        const order = [...bundle.document.laneOrder], index2 = order.indexOf(ids2[0]), delta = action === "lane-up" ? -1 : 1;
        if (index2 < 0 || index2 + delta < 0 || index2 + delta >= order.length) return;
        [order[index2], order[index2 + delta]] = [order[index2 + delta], order[index2]];
        submit({ type: "reorder-lanes", ids: order });
        return;
      }
      if (action === "collapse") {
        const collapsed = new Set(state.view.collapsedGroups);
        if (collapsed.has(ids2[0])) collapsed.delete(ids2[0]);
        else collapsed.add(ids2[0]);
        session.setView({ collapsedGroups: [...collapsed] });
        return;
      }
      if (["add-bend", "remove-bend", "reset-route", "position-label"].includes(action)) {
        const id2 = ids2[0], place = bundle.presentation.elements.find((item) => item.elementId === id2), before = geometryFields(place), after = clone(before);
        const points = session.geometry(id2)?.points ?? [];
        if (action === "reset-route") {
          after.route.mode = "automatic";
          after.route.points = [];
        }
        if (action === "add-bend") {
          const bent = safeAction(() => addOrthogonalDetour(points), report);
          if (!bent) return;
          after.route.mode = "manual";
          after.route.strategy = "orthogonal";
          after.route.points = bent;
        }
        if (action === "remove-bend") {
          after.route.points.splice(Number(value) + 1, 1);
          if (after.route.points.some((point2, index2, all) => index2 > 0 && point2.x !== all[index2 - 1].x && point2.y !== all[index2 - 1].y)) {
            report("This corner joins perpendicular segments. Move adjacent bends or reset the route.");
            return;
          }
          if (after.route.points.length === 2) {
            after.route.mode = "automatic";
            after.route.points = [];
          }
        }
        if (action === "position-label") {
          const middle = points[Math.floor(points.length / 2)];
          after.label = { x: middle.x, y: middle.y, width: 140 };
        }
        submit({ type: "geometry", changes: [{ elementId: id2, before, after }] });
        return;
      }
    }
    function pointerDown(event) {
      if (event.button !== 0 || !current().bundle || dialog || focusable(event.target)) return;
      const state = current(), start = fromClient(event), target = event.target.closest("[data-element-id]"), handle = event.target.closest("[data-handle]");
      const query = session.query({ x: start.x, y: start.y, tolerance: 8 });
      if (!query.ok) {
        report(errText(query));
        return;
      }
      const id2 = handle?.getAttribute("data-handle-id") ?? query.hits[0]?.id ?? target?.getAttribute("data-element-id") ?? null;
      if ((tool === "pan" || tempPan) && !handle) {
        drag = { type: "pan", start, last: start, camera: clone(state.view.camera) };
        stage.setPointerCapture(event.pointerId);
        return;
      }
      if (!editable(state)) {
        if (id2) select([id2]);
        return;
      }
      if (handle) {
        if (!state.view.selection.includes(id2)) select([id2]);
        drag = { type: handle.dataset.handle, id: id2, index: Number(handle.dataset.index), start, last: start, origin: state.bundle, originPoints: session.geometry(id2)?.points ?? [], active: false };
      } else if (id2) {
        const ids2 = event.shiftKey ? state.view.selection.includes(id2) ? state.view.selection.filter((value) => value !== id2) : [...state.view.selection, id2] : state.view.selection.includes(id2) ? state.view.selection : [id2];
        select(ids2);
        drag = { type: "move", id: id2, ids: ids2, start, last: start, origin: state.bundle, active: false };
      } else {
        if (!event.shiftKey) select([]);
        drag = { type: "marquee", start, last: start, additive: event.shiftKey, base: [...state.view.selection] };
      }
      stage.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    function previewDrag() {
      raf = 0;
      if (!drag || !drag.active || drag.type === "marquee" || drag.type === "pan") return;
      const state = current(), scale = state.view.camera.scale;
      const dx = (drag.last.x - drag.start.x) / scale, dy = (drag.last.y - drag.start.y) / scale;
      let command;
      if (drag.type === "move") {
        const x = state.view.snap ? Math.round(dx / 8) * 8 : Math.round(dx), y = state.view.snap ? Math.round(dy / 8) * 8 : Math.round(dy);
        command = { type: "move", ids: drag.ids, dx: x, dy: y };
      } else {
        const place = drag.origin.presentation.elements.find((item) => item.elementId === drag.id), before = geometryFields(place), after = clone(before);
        if (drag.type === "resize") {
          after.bounds.width = Math.max(24, Math.round(before.bounds.width + dx));
          after.bounds.height = Math.max(24, Math.round(before.bounds.height + dy));
        }
        if (drag.type === "bend") {
          const points = drag.originPoints, target = points[drag.index];
          if (!target) return;
          if (after.route.mode !== "manual") {
            after.route.mode = "manual";
            after.route.points = points;
          }
          if (after.route.strategy === "orthogonal") after.route.points = moveOrthogonalBend(points, drag.index, dx, dy);
          else after.route.points[drag.index] = { x: Math.round(target.x + dx), y: Math.round(target.y + dy) };
        }
        command = { type: "geometry", changes: [{ elementId: drag.id, before, after }] };
      }
      const result = session.previewGesture(command);
      if (!result.ok) report(errText(result));
      else report("");
    }
    function pointerMove(event) {
      if (!drag) return;
      const point2 = fromClient(event);
      drag.last = point2;
      if (drag.type === "pan") {
        const camera = drag.camera;
        cameraPatch({ x: camera.x + point2.x - drag.start.x, y: camera.y + point2.y - drag.start.y, scale: camera.scale, fit: null });
        return;
      }
      if (drag.type === "marquee") {
        renderOverlays(current(), displayed(current()), new Set(current().view.selection));
        return;
      }
      if (!drag.active && Math.hypot(point2.x - drag.start.x, point2.y - drag.start.y) > 3) {
        const result = session.beginGesture();
        if (!result.ok) {
          report(errText(result));
          drag = null;
          return;
        }
        drag.active = true;
      }
      if (drag.active && !raf) raf = win.requestAnimationFrame(previewDrag);
    }
    function finishPointer(event, cancel = false) {
      if (!drag) return;
      if (raf) {
        win.cancelAnimationFrame(raf);
        raf = 0;
        if (drag.active && !cancel) previewDrag();
      }
      const finished = drag;
      drag = null;
      if (finished.active) {
        const result = cancel ? session.cancelGesture("cancelled") : session.completeGesture();
        if (!result.ok) report(errText(result));
        else if (!cancel) notice("One edit applied. Save diagram to keep it.");
      } else if (finished.type === "marquee" && !cancel) {
        const a = worldPoint(finished.start), b = worldPoint(finished.last), rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
        if (rect.width > 3 || rect.height > 3) {
          const picked = current().bundle.presentation.elements.filter((item) => item.bounds && intersect(item.bounds, rect)).map((item) => item.elementId);
          select(finished.additive ? [...finished.base, ...picked] : picked);
        }
      }
      if (event?.pointerId !== void 0 && stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      draw({ type: "view" });
    }
    function handleKey(event) {
      if (dialog && event.key === "Tab") {
        const controls = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
        if (controls.length) {
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && doc.activeElement === first) {
            event.preventDefault();
            last.focus();
            return;
          }
          if (!event.shiftKey && doc.activeElement === last) {
            event.preventDefault();
            first.focus();
            return;
          }
        }
      }
      if (!shell.contains(event.target) && !drag && !dialog) return;
      if (dialog && event.key === "Escape") {
        event.preventDefault();
        act("cancel-dialog");
        return;
      }
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        finishPointer(null, true);
        return;
      }
      if (event.target.matches?.('[data-action="select-id"]') && (event.shiftKey || event.metaKey || event.ctrlKey) && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        act("select-id", event.target.dataset.id, { additive: true, fromOutline: true });
        return;
      }
      if (focusable(event.target) && event.target !== stage) return;
      const state = current(), ids2 = state.view.selection;
      if (event.key === " ") {
        if (event.target === stage) {
          event.preventDefault();
          tempPan = true;
        }
        return;
      }
      if (event.key.toLowerCase() === "v" && !event.metaKey && !event.ctrlKey) {
        tool = "select";
        notice("Select mode");
        return;
      }
      if (event.key.toLowerCase() === "h" && !event.metaKey && !event.ctrlKey) {
        tool = "pan";
        notice("Pan mode");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        act("save");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        act(event.shiftKey ? "redo" : "undo");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && ids2.length) {
        event.preventDefault();
        act("copy");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && clipboard) {
        event.preventDefault();
        act("paste");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && ids2.length && editable(state)) {
        event.preventDefault();
        act("delete");
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && ids2.length && editable(state)) {
        event.preventDefault();
        const delta = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
        const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
        const result = submit({ type: "move", ids: ids2, dx, dy });
        if (result.ok) notice("Selection moved " + delta + " unit" + (delta === 1 ? "" : "s") + ".");
      }
    }
    const onClick = (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || target.onclick) return;
      const action = target.dataset.action;
      if (action === "create") act(action, target.dataset.kind);
      else if (action === "select-id") act(action, target.dataset.id, { additive: event.shiftKey || event.metaKey || event.ctrlKey, fromOutline: true });
      else if (action === "select-member") act(action, target.dataset.member);
      else act(action);
    };
    const onWheel = (event) => {
      if (!event.target.closest(".de-canvas")) return;
      event.preventDefault();
      const point2 = fromClient(event);
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 2e-3), point2);
      else {
        const camera = current().view.camera;
        cameraPatch({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY, fit: null });
      }
    };
    let resizeFrame = 0;
    const onResize = () => {
      const breakpoint = win.innerWidth <= 1100 ? "drawer" : "desktop";
      const rect = stage.getBoundingClientRect();
      if (lastCanvas && lastBreakpoint === breakpoint && lastCanvas.width === rect.width && lastCanvas.height === rect.height) return;
      if (lastBreakpoint && lastBreakpoint !== breakpoint && breakpoint === "drawer") {
        leftOpen = false;
        rightOpen = false;
      }
      if (lastBreakpoint && lastBreakpoint !== breakpoint && breakpoint === "desktop") {
        leftOpen = true;
        rightOpen = true;
      }
      lastBreakpoint = breakpoint;
      if (lastCanvas) {
        const camera = current().view.camera;
        if (camera.fit) fit();
        else cameraPatch({ ...camera, x: camera.x + (rect.width - lastCanvas.width) / 2, y: camera.y + (rect.height - lastCanvas.height) / 2 });
      } else fit();
      lastCanvas = { width: rect.width, height: rect.height };
      controlsStamp = "";
      renderChrome(current());
    };
    const scheduleResize = () => {
      if (disposed || resizeFrame) return;
      resizeFrame = win.requestAnimationFrame(() => {
        resizeFrame = 0;
        if (!disposed) onResize();
      });
    };
    const resize = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(scheduleResize) : null;
    const onSession = (event) => {
      if (disposed) return;
      draw(event);
    };
    const unsubscribe = session.subscribe(onSession);
    const onPointerUp = (event) => finishPointer(event);
    const onPointerCancel = (event) => finishPointer(event, true);
    const onLostCapture = (event) => {
      if (drag) finishPointer(event, true);
    };
    const onKeyUp = (event) => {
      if (event.key === " ") tempPan = false;
    };
    const onBlur = () => {
      tempPan = false;
      if (drag) finishPointer(null, true);
    };
    shell.addEventListener("click", onClick);
    stage.addEventListener("pointerdown", pointerDown);
    stage.addEventListener("pointermove", pointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerCancel);
    stage.addEventListener("lostpointercapture", onLostCapture);
    stage.addEventListener("wheel", onWheel, { passive: false });
    doc.addEventListener("keydown", handleKey);
    doc.addEventListener("keyup", onKeyUp);
    win.addEventListener("blur", onBlur);
    if (resize) resize.observe(stage);
    else win.addEventListener("resize", scheduleResize);
    draw();
    scheduleResize();
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        resize?.disconnect();
        win.cancelAnimationFrame(raf);
        win.cancelAnimationFrame(resizeFrame);
        reviewCleanup?.();
        conflictMount?.dispose();
        shell.removeEventListener("click", onClick);
        stage.removeEventListener("pointerdown", pointerDown);
        stage.removeEventListener("pointermove", pointerMove);
        stage.removeEventListener("pointerup", onPointerUp);
        stage.removeEventListener("pointercancel", onPointerCancel);
        stage.removeEventListener("lostpointercapture", onLostCapture);
        stage.removeEventListener("wheel", onWheel);
        if (!resize) win.removeEventListener("resize", scheduleResize);
        doc.removeEventListener("keydown", handleKey);
        doc.removeEventListener("keyup", onKeyUp);
        win.removeEventListener("blur", onBlur);
        shell.remove();
        elementNodes.clear();
        renderSignatures.clear();
      },
      refresh(bundle) {
        return session.refresh(bundle);
      },
      getState() {
        return session.getState();
      }
    };
  }

  // lib/artifact/ui/diagram-owner-studio.mjs
  async function mountDiagramOwnerStudio(document2 = globalThis.document) {
    const window = document2.defaultView;
    const root = document2.getElementById("diagram-owner-editor");
    if (!root) return null;
    let disposed = false, session, mount;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("pagehide", dispose);
      mount?.dispose();
      session?.dispose();
    };
    window.addEventListener("pagehide", dispose, { once: true });
    try {
      const config = JSON.parse(document2.getElementById("diagram-owner-data").textContent);
      const transport = createDiagramLocalOwnerTransport({ apiBase: new URL("api/", window.location.href).href, origin: window.location.origin, fetch: window.fetch.bind(window) });
      const authoritative = await transport.read();
      if (disposed) return null;
      if (!authoritative.ok || !["ready", "absent"].includes(authoritative.status) || authoritative.diagramId !== config.diagramId || authoritative.capabilities?.read !== true || typeof authoritative.capabilities?.write !== "boolean" || typeof authoritative.recoveryScope !== "string") {
        throw new Error("The local owner could not verify access to this diagram.");
      }
      let storage;
      try {
        storage = window.sessionStorage;
      } catch {
      }
      const recovery = createDiagramEditorRecovery({ storage, scope: { sessionId: authoritative.recoveryScope, diagramId: authoritative.diagramId } });
      let bundle = authoritative.bundle;
      if (authoritative.status === "absent") {
        const draft = createDiagramEditorDraft({ diagramId: authoritative.diagramId, title: config.title, grammar: config.grammar });
        if (!draft.ok) throw new Error("The initial diagram is not supported for editing.");
        bundle = draft.bundle;
      }
      session = createDiagramEditorSession({
        bundle,
        transport,
        recovery,
        capabilities: authoritative.capabilities,
        acknowledged: authoritative.status === "ready"
      });
      mount = mountDiagramEditor({ root, session, host: {
        async readCurrent() {
          const current = await transport.read();
          if (current?.ok && current.status === "ready" && current.diagramId === authoritative.diagramId && current.recoveryScope === authoritative.recoveryScope && current.capabilities?.read === true) return current.bundle;
          throw new Error("The current owner revision could not be read. Your pending changes remain in this session.");
        }
      } });
      root.dataset.ownerReady = "true";
      return { dispose };
    } catch {
      dispose();
      if (!root.isConnected) return null;
      root.replaceChildren();
      const message = document2.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = "The local diagram could not be opened. Access or storage may have changed. Existing files were not replaced; keep any other editing tab open.";
      const retry = document2.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry opening diagram";
      retry.addEventListener("click", () => window.location.reload(), { once: true });
      root.append(message, retry);
      return null;
    }
  }
  if (typeof document !== "undefined" && document.getElementById("diagram-owner-editor")) void mountDiagramOwnerStudio();
})();
