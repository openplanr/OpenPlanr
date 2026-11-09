import { existsSync, readdirSync, readFileSync } from 'node:fs';

export type ProtocolArtifactKind = 'spec' | 'story' | 'task';

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Frontmatter schemas projected from the Protocol for one artifact kind, keyed by their `schemaVersion` const. */
export function supportedProtocolSchemas(kind: ProtocolArtifactKind): Map<string, unknown> {
  const root = new URL('../../lib/schemas/', import.meta.url);
  const schemas = new Map<string, unknown>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = new URL(`${entry.name}/${kind}.schema.json`, root);
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const schema: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const properties = plainRecord(plainRecord(schema)?.properties);
    const version = plainRecord(properties?.schemaVersion)?.const;
    if (typeof version === 'string') schemas.set(version, schema);
  }
  return schemas;
}
