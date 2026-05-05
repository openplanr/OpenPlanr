/**
 * Minimal JSON Schema (draft 2020-12) subset extracted from conformance/runner.mjs.
 * Supports only constructs used by schemas/v1.0.0/*.json — see runner header comment.
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

const validateNode = (value, schema, path, errs) => {
  if (schema === true) return;
  if (schema === false) {
    errs.push({ path, rule: 'schema:false', detail: 'value not allowed' });
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errs.push({ path, rule: 'type', detail: `expected ${types.join('|')}, got ${typeOf(value)}` });
      return;
    }
  }

  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errs.push({ path, rule: 'const', detail: `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` });
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
      errs.push({ path, rule: 'minLength', detail: `length ${value.length} < ${schema.minLength}` });
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errs.push({ path, rule: 'pattern', detail: `value ${JSON.stringify(value)} does not match /${schema.pattern}/` });
        }
      } catch (e) {
        errs.push({ path, rule: 'pattern', detail: `invalid regex /${schema.pattern}/: ${e.message}` });
      }
    }
    if (typeof schema.format === 'string') {
      if (schema.format === 'date' && !FORMAT_DATE.test(value)) {
        errs.push({ path, rule: 'format:date', detail: `value ${JSON.stringify(value)} is not YYYY-MM-DD` });
      } else if (schema.format === 'date-time' && !FORMAT_DATETIME.test(value)) {
        errs.push({ path, rule: 'format:date-time', detail: `value ${JSON.stringify(value)} is not ISO 8601 date-time` });
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errs.push({ path, rule: 'minimum', detail: `value ${value} < ${schema.minimum}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], schema.items, `${path}[${i}]`, errs);
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
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in value)) {
          errs.push({ path, rule: 'required', detail: `missing required property '${req}'` });
        }
      }
    }
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in props)) {
          errs.push({ path, rule: 'additionalProperties', detail: `unknown property '${k}'` });
        }
      }
    }
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validateNode(v, props[k], `${path}.${k}`, errs);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    let matched = 0;
    for (const sub of schema.oneOf) {
      const e = [];
      validateNode(value, sub, path, e);
      if (e.length === 0) matched++;
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

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      validateNode(value, sub, path, errs);
    }
  }

  if (schema.not !== undefined) {
    const e = [];
    validateNode(value, schema.not, path, e);
    if (e.length === 0) {
      errs.push({ path, rule: 'not', detail: 'value matched a forbidden subschema' });
    }
  }
};

/** @returns {{ path: string, rule: string, detail: string }[]} */
export const validateJson = (value, schema) => {
  const errs = [];
  validateNode(value, schema, '$', errs);
  return errs;
};

/** Alias matching legacy runner export name. */
export const validate = validateJson;
