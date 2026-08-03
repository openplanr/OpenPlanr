import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_ROOT = join(here, '../../schemas');
const DEFAULT_SCHEMA_VERSIONS = Object.freeze(['v1.0.0', 'v1.1.0']);
const schemaCache = new Map();

function parseSchemaReference(name, version) {
  if (typeof name !== 'string' || !/^[a-z0-9-]+(?:\.schema\.json)?$/i.test(name)) {
    throw new Error(`invalid schema name: ${String(name)}`);
  }
  const cleanName = name.replace(/\.schema\.json$/i, '');
  if (version !== undefined && !/^v\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid schema version: ${String(version)}`);
  }
  return { cleanName, versions: version ? [version] : DEFAULT_SCHEMA_VERSIONS };
}

export function loadSchema(name, version = undefined) {
  if (typeof name === 'string' && name.includes('/')) {
    const [qualifiedVersion, qualifiedName, ...rest] = name.split('/');
    if (rest.length > 0 || version !== undefined) throw new Error(`invalid schema reference: ${name}`);
    return loadSchema(qualifiedName, qualifiedVersion);
  }
  const { cleanName, versions } = parseSchemaReference(name, version);
  for (const candidateVersion of versions) {
    const key = `${candidateVersion}/${cleanName}`;
    if (schemaCache.has(key)) return schemaCache.get(key);
    const path = join(SCHEMAS_ROOT, candidateVersion, `${cleanName}.schema.json`);
    try {
      const schema = JSON.parse(readFileSync(path, 'utf-8'));
      schemaCache.set(key, schema);
      return schema;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`unknown schema: ${cleanName}${version ? ` (${version})` : ''}`);
}

export function validate(data, schemaName, version = undefined) {
  return validateJson(data, loadSchema(schemaName, version));
}

export function assertValid(data, schemaName, version = undefined) {
  const errs = validate(data, schemaName, version);
  if (errs.length > 0) {
    throw new Error(
      `invalid ${schemaName}: ${errs.map((e) => `${e.path} ${e.rule}`).join('; ')}`,
    );
  }
  return data;
}
