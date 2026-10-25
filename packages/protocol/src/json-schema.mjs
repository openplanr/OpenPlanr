// @ts-check
/**
 * Minimal JSON Schema (draft 2020-12) subset extracted from conformance/runner.mjs.
 * Supports the constructs used by packaged Protocol schemas, including local
 * JSON-pointer and caller-resolved external `$ref` references. Any other keyword or
 * format is reported as an error rather than ignored.
 *
 * Zero third-party deps. Safe to import from node:test suites.
 */

// ── minimal JSON Schema validator (draft 2020-12 subset) ────────────────

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  if (typeof v === 'number') return 'number';
  return typeof v;
};

const matchesType = (v, t) => {
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number';
  if (t === 'string') return typeof v === 'string';
  if (t === 'boolean') return typeof v === 'boolean';
  if (t === 'null') return v === null;
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return false;
};

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORMAT_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SUPPORTED_FORMATS = new Set(['date', 'date-time']);

const ANNOTATION_KEYWORDS = [
  '$schema',
  '$id',
  '$defs',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
];
const VALIDATION_KEYWORDS = [
  '$ref',
  'type',
  'const',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'minItems',
  'maxItems',
  'prefixItems',
  'items',
  'uniqueItems',
  'contains',
  'minContains',
  'maxContains',
  'required',
  'properties',
  'propertyNames',
  'additionalProperties',
  'maxProperties',
  'dependentRequired',
  'unevaluatedProperties',
  'oneOf',
  'anyOf',
  'allOf',
  'if',
  'then',
  'else',
  'not',
];
const KNOWN_KEYWORDS = new Set([...ANNOTATION_KEYWORDS, ...VALIDATION_KEYWORDS]);
const TYPE_NAMES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

const isSchema = (value) =>
  typeof value === 'boolean' ||
  (value !== null && typeof value === 'object' && !Array.isArray(value));
/** @type {(value: unknown) => value is Record<string, unknown>} */
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
/** @type {(value: unknown) => value is string[]} */
const isUniqueStrings = (value) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'string') &&
  new Set(value).size === value.length;
const isSchemaArray = (value) => Array.isArray(value) && value.length > 0 && value.every(isSchema);
const isSchemaMap = (value) => isPlainObject(value) && Object.values(value).every(isSchema);
/** @type {Map<string, RegExp | null>} */
const compiledPatterns = new Map();
const MAX_COMPILED_PATTERNS = 1024;
/** @type {(source: string) => RegExp | null} */
const tryCompilePattern = (source) => {
  try {
    return new RegExp(source);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};
/** Returns the compiled pattern, or null when it is not a valid regular expression. */
const compilePattern = (source) => {
  if (!compiledPatterns.has(source)) {
    if (compiledPatterns.size >= MAX_COMPILED_PATTERNS) compiledPatterns.clear();
    compiledPatterns.set(source, tryCompilePattern(source));
  }
  return compiledPatterns.get(source) ?? null;
};

const describeValue = (value) => {
  const text = String(JSON.stringify(value));
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/**
 * Expected value shape of each supported keyword, per draft 2020-12.
 * @type {Record<string, [string, (value: unknown) => boolean]>}
 */
const KEYWORD_SHAPES = {
  $ref: ['a string', (value) => typeof value === 'string'],
  $defs: ['an object of schemas', isSchemaMap],
  type: [
    'a type name or a non-empty array of unique type names',
    (value) =>
      (typeof value === 'string' && TYPE_NAMES.has(value)) ||
      (isUniqueStrings(value) && value.length > 0 && value.every((name) => TYPE_NAMES.has(name))),
  ],
  enum: ['an array', Array.isArray],
  minLength: ['a non-negative integer', isCount],
  maxLength: ['a non-negative integer', isCount],
  pattern: [
    'a valid regular expression string',
    (value) => typeof value === 'string' && compilePattern(value) !== null,
  ],
  minimum: ['a finite number', Number.isFinite],
  maximum: ['a finite number', Number.isFinite],
  exclusiveMinimum: ['a finite number', Number.isFinite],
  minItems: ['a non-negative integer', isCount],
  maxItems: ['a non-negative integer', isCount],
  prefixItems: ['a non-empty array of schemas', isSchemaArray],
  items: ['a schema', isSchema],
  uniqueItems: ['a boolean', (value) => typeof value === 'boolean'],
  contains: ['a schema', isSchema],
  minContains: ['a non-negative integer', isCount],
  maxContains: ['a non-negative integer', isCount],
  required: ['an array of unique strings', isUniqueStrings],
  properties: ['an object of schemas', isSchemaMap],
  propertyNames: ['a schema', isSchema],
  additionalProperties: ['a schema', isSchema],
  maxProperties: ['a non-negative integer', isCount],
  dependentRequired: [
    'an object of unique string arrays',
    (value) => isPlainObject(value) && Object.values(value).every(isUniqueStrings),
  ],
  unevaluatedProperties: ['a schema', isSchema],
  oneOf: ['a non-empty array of schemas', isSchemaArray],
  anyOf: ['a non-empty array of schemas', isSchemaArray],
  allOf: ['a non-empty array of schemas', isSchemaArray],
  if: ['a schema', isSchema],
  then: ['a schema', isSchema],
  else: ['a schema', isSchema],
  not: ['a schema', isSchema],
};

function resolveJsonPointer(root, reference) {
  if (reference === '#') return root;
  if (!reference.startsWith('#/')) return null;
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

/** Frozen schema nodes that passed every node check; a mutable node is re-checked on each call. */
const wellFormedSchemas = new WeakSet();

/** True when the node and every keyword value its checks read can no longer change. */
const isFrozenNode = (schema) =>
  Object.isFrozen(schema) &&
  Object.values(schema).every(Object.isFrozen) &&
  (!isPlainObject(schema.dependentRequired) ||
    Object.values(schema.dependentRequired).every(Object.isFrozen));

/**
 * Records unsupported keywords and formats and malformed keyword values, once per schema node.
 * They go to a shared sink so `not`, `if` and combinator branches cannot swallow them.
 */
const checkSchemaNode = (schema, path, context) => {
  if (wellFormedSchemas.has(schema) || context.checkedSchemas.has(schema)) return;
  context.checkedSchemas.add(schema);
  const errorCount = context.schemaErrors.length;
  for (const keyword of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(keyword) && !keyword.startsWith('x-')) {
      context.schemaErrors.push({
        path,
        rule: 'unsupported-keyword',
        detail: `schema keyword '${keyword}' is not supported by this validator`,
      });
    }
  }
  if (Object.hasOwn(schema, 'format') && !SUPPORTED_FORMATS.has(schema.format)) {
    context.schemaErrors.push({
      path,
      rule: 'unsupported-format',
      detail: `schema format ${JSON.stringify(schema.format)} is not supported by this validator`,
    });
  }
  for (const [keyword, [expected, isValid]] of Object.entries(KEYWORD_SHAPES)) {
    if (Object.hasOwn(schema, keyword) && !isValid(schema[keyword])) {
      context.schemaErrors.push({
        path,
        rule: 'schema',
        detail: `schema keyword '${keyword}' must be ${expected}, got ${describeValue(schema[keyword])}`,
      });
    }
  }
  if (context.schemaErrors.length === errorCount && isFrozenNode(schema)) {
    wellFormedSchemas.add(schema);
  }
};

/** Records an unresolvable or circular `$ref` once per schema node. */
const reportReference = (schema, path, detail, context) => {
  if (context.reportedReferences.has(schema)) return;
  context.reportedReferences.add(schema);
  context.schemaErrors.push({ path, rule: '$ref', detail });
};

/** Validates one node and returns the object property names it evaluated. */
const validateNode = (value, schema, path, errs, context) => {
  /** @type {Set<string>} */
  const evaluated = new Set();
  if (schema === true) return evaluated;
  if (schema === false) {
    errs.push({ path, rule: 'schema:false', detail: 'value not allowed' });
    return evaluated;
  }
  // A non-schema child is reported by its parent's keyword-shape check.
  if (!isSchema(schema)) return evaluated;
  checkSchemaNode(schema, path, context);

  if (typeof schema?.$ref === 'string') {
    const reference = schema.$ref;
    let resolved;
    let nextRoot = context.rootSchema;
    let resolvedBase = context.base;
    if (reference.startsWith('#')) {
      resolved = resolveJsonPointer(context.rootSchema, reference);
    } else if (typeof context.resolveRef === 'function') {
      const result = context.resolveRef(reference, { base: context.base });
      resolved = result?.schema ?? result;
      nextRoot = result?.rootSchema ?? resolved;
      resolvedBase = result?.base ?? resolved?.$id ?? context.base;
    }
    if (!isSchema(resolved)) {
      const detail =
        resolved === undefined || resolved === null
          ? `could not resolve schema reference ${reference}`
          : `schema reference ${reference} resolved to ${typeOf(resolved)}, not a schema`;
      reportReference(schema, path, detail, context);
      return evaluated;
    }
    // Recursion that descends into the instance changes `path`; only a repeat at the same location loops.
    const referenceKey = `${path} ${context.base ?? '<root>'}:${reference}`;
    if (context.referenceStack.includes(referenceKey)) {
      reportReference(schema, path, `circular schema reference ${reference}`, context);
      return evaluated;
    }
    const referenced = validateNode(value, resolved, path, errs, {
      ...context,
      rootSchema: nextRoot,
      base: resolvedBase,
      referenceStack: [...context.referenceStack, referenceKey],
    });
    for (const key of referenced) evaluated.add(key);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errs.push({
        path,
        rule: 'type',
        detail: `expected ${types.join('|')}, got ${typeOf(value)}`,
      });
      return evaluated;
    }
  }

  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errs.push({
        path,
        rule: 'const',
        detail: `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`,
      });
    }
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errs.push({
        path,
        rule: 'enum',
        detail: `value ${JSON.stringify(value)} not in enum [${schema.enum.map((x) => JSON.stringify(x)).join(', ')}]`,
      });
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errs.push({
        path,
        rule: 'minLength',
        detail: `length ${value.length} < ${schema.minLength}`,
      });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errs.push({
        path,
        rule: 'maxLength',
        detail: `length ${value.length} > ${schema.maxLength}`,
      });
    }
    const pattern = typeof schema.pattern === 'string' ? compilePattern(schema.pattern) : null;
    if (pattern && !pattern.test(value)) {
      errs.push({
        path,
        rule: 'pattern',
        detail: `value ${JSON.stringify(value)} does not match /${schema.pattern}/`,
      });
    }
    if (typeof schema.format === 'string') {
      if (schema.format === 'date' && !FORMAT_DATE.test(value)) {
        errs.push({
          path,
          rule: 'format:date',
          detail: `value ${JSON.stringify(value)} is not YYYY-MM-DD`,
        });
      } else if (schema.format === 'date-time' && !FORMAT_DATETIME.test(value)) {
        errs.push({
          path,
          rule: 'format:date-time',
          detail: `value ${JSON.stringify(value)} is not ISO 8601 date-time`,
        });
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errs.push({ path, rule: 'minimum', detail: `value ${value} < ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errs.push({ path, rule: 'maximum', detail: `value ${value} > ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errs.push({
        path,
        rule: 'exclusiveMinimum',
        detail: `value ${value} <= ${schema.exclusiveMinimum}`,
      });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errs.push({ path, rule: 'minItems', detail: `length ${value.length} < ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errs.push({ path, rule: 'maxItems', detail: `length ${value.length} > ${schema.maxItems}` });
    }
    const prefixLength = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    if (prefixLength > 0) {
      for (let i = 0; i < Math.min(value.length, prefixLength); i++) {
        validateNode(value[i], schema.prefixItems[i], `${path}[${i}]`, errs, context);
      }
    }
    if (schema.items !== undefined) {
      for (let i = prefixLength; i < value.length; i++) {
        validateNode(value[i], schema.items, `${path}[${i}]`, errs, context);
      }
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errs.push({ path, rule: 'uniqueItems', detail: `duplicate item ${key}` });
          break;
        }
        seen.add(key);
      }
    }
    if (schema.contains !== undefined) {
      let matches = 0;
      for (let index = 0; index < value.length; index += 1) {
        const containedErrors = [];
        validateNode(value[index], schema.contains, `${path}[${index}]`, containedErrors, context);
        if (containedErrors.length === 0) matches += 1;
      }
      const minimum = Number.isSafeInteger(schema.minContains) ? schema.minContains : 1;
      const maximum = Number.isSafeInteger(schema.maxContains) ? schema.maxContains : null;
      if (matches < minimum) {
        errs.push({
          path,
          rule: 'contains',
          detail: `matched ${matches} contained items; expected at least ${minimum}`,
        });
      }
      if (maximum !== null && matches > maximum) {
        errs.push({
          path,
          rule: 'contains',
          detail: `matched ${matches} contained items; expected at most ${maximum}`,
        });
      }
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!Object.hasOwn(value, req)) {
          errs.push({ path, rule: 'required', detail: `missing required property '${req}'` });
        }
      }
    }
    if (
      typeof schema.maxProperties === 'number' &&
      Object.keys(value).length > schema.maxProperties
    ) {
      errs.push({
        path,
        rule: 'maxProperties',
        detail: `property count ${Object.keys(value).length} > ${schema.maxProperties}`,
      });
    }
    if (schema.dependentRequired !== null && typeof schema.dependentRequired === 'object') {
      for (const [trigger, dependencies] of Object.entries(schema.dependentRequired)) {
        if (!Object.hasOwn(value, trigger) || !Array.isArray(dependencies)) continue;
        for (const dependency of dependencies) {
          if (!Object.hasOwn(value, dependency)) {
            errs.push({
              path,
              rule: 'dependentRequired',
              detail: `property '${trigger}' requires property '${dependency}'`,
            });
          }
        }
      }
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames !== undefined)
        validateNode(k, schema.propertyNames, `${path}.${k}`, errs, context);
      if (Object.hasOwn(props, k)) evaluated.add(k);
      else if (schema.additionalProperties !== undefined) evaluated.add(k);
      if (!Object.hasOwn(props, k)) {
        if (schema.additionalProperties === false) {
          errs.push({ path, rule: 'additionalProperties', detail: `unknown property '${k}'` });
        } else if (
          schema.additionalProperties === true ||
          (schema.additionalProperties !== null && typeof schema.additionalProperties === 'object')
        ) {
          validateNode(v, schema.additionalProperties, `${path}.${k}`, errs, context);
        }
      }
    }
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) validateNode(v, props[k], `${path}.${k}`, errs, context);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    let matched = 0;
    for (const sub of schema.oneOf) {
      const e = [];
      const branch = validateNode(value, sub, path, e, context);
      if (e.length === 0) {
        matched++;
        for (const key of branch) evaluated.add(key);
      }
    }
    if (matched !== 1) {
      const titles = schema.oneOf.map((s) => s.title || '(unnamed)').join(' | ');
      errs.push({
        path,
        rule: 'oneOf',
        detail: `matched ${matched}/${schema.oneOf.length} branches (expected exactly 1). Branches: ${titles}`,
      });
    }
  }

  if (Array.isArray(schema.anyOf)) {
    let matched = 0;
    for (const sub of schema.anyOf) {
      const candidateErrors = [];
      const branch = validateNode(value, sub, path, candidateErrors, context);
      if (candidateErrors.length === 0) {
        matched += 1;
        for (const key of branch) evaluated.add(key);
      }
    }
    if (matched === 0) {
      const titles = schema.anyOf.map((sub) => sub.title || '(unnamed)').join(' | ');
      errs.push({
        path,
        rule: 'anyOf',
        detail: `matched 0/${schema.anyOf.length} branches (expected at least 1). Branches: ${titles}`,
      });
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      for (const key of validateNode(value, sub, path, errs, context)) evaluated.add(key);
    }
  }

  if (schema.if !== undefined) {
    const conditionErrors = [];
    const condition = validateNode(value, schema.if, path, conditionErrors, context);
    const passed = conditionErrors.length === 0;
    if (passed) for (const key of condition) evaluated.add(key);
    const branch = passed ? schema.then : schema.else;
    if (branch !== undefined) {
      const branchErrors = [];
      const branchEvaluated = validateNode(value, branch, path, branchErrors, context);
      errs.push(...branchErrors);
      if (branchErrors.length === 0) for (const key of branchEvaluated) evaluated.add(key);
    }
  }

  if (schema.not !== undefined) {
    const e = [];
    validateNode(value, schema.not, path, e, context);
    if (e.length === 0) {
      errs.push({ path, rule: 'not', detail: 'value matched a forbidden subschema' });
    }
  }

  if (
    schema.unevaluatedProperties !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    for (const [k, v] of Object.entries(value)) {
      if (evaluated.has(k)) continue;
      if (schema.unevaluatedProperties === false) {
        errs.push({ path, rule: 'unevaluatedProperties', detail: `unevaluated property '${k}'` });
      } else {
        validateNode(v, schema.unevaluatedProperties, `${path}.${k}`, errs, context);
      }
      evaluated.add(k);
    }
  }
  return evaluated;
};

/** @type {typeof import('./json-schema.d.mts').validateJson} */
export const validateJson = (
  value,
  schema,
  {
    resolveRef,
    base = /** @type {{ $id?: string } | null | undefined} */ (schema)?.$id ?? null,
  } = {},
) => {
  const errs = [];
  /** @type {{ path: string, rule: string, detail: string }[]} */
  const schemaErrors = [];
  if (!isSchema(schema)) {
    return [
      {
        path: '$',
        rule: 'schema',
        detail: `expected a schema object or boolean, got ${typeOf(schema)}`,
      },
    ];
  }
  validateNode(value, schema, '$', errs, {
    rootSchema: schema,
    resolveRef,
    base,
    referenceStack: [],
    schemaErrors,
    checkedSchemas: new WeakSet(),
    reportedReferences: new WeakSet(),
  });
  return [...schemaErrors, ...errs];
};

/**
 * Alias matching legacy runner export name.
 * @type {typeof import('./json-schema.d.mts').validate}
 */
export const validate = validateJson;
