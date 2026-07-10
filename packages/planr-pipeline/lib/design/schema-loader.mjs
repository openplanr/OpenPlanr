import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(here, '../../schemas/v1.0.0');
const schemaCache = new Map();

export function loadSchema(name) {
  if (!schemaCache.has(name)) {
    const path = join(SCHEMAS_DIR, `${name}.schema.json`);
    schemaCache.set(name, JSON.parse(readFileSync(path, 'utf-8')));
  }
  return schemaCache.get(name);
}

export function validate(data, schemaName) {
  return validateJson(data, loadSchema(schemaName));
}

export function assertValid(data, schemaName) {
  const errs = validate(data, schemaName);
  if (errs.length > 0) {
    throw new Error(
      `invalid ${schemaName}: ${errs.map((e) => `${e.path} ${e.rule}`).join('; ')}`,
    );
  }
  return data;
}
