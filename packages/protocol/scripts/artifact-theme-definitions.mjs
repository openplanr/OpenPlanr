import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(packageRoot, path), 'utf8'));

const PROTOCOL_VERSION = '1.14.0';
const KIND = 'artifact-theme';
const SCHEMA_VERSION = '1.1.0';

// Teal and teal-on-light from docs/assets/brand/README.md, with the text colour for each primary.
const BRAND_COLORS = Object.freeze({
  dark: Object.freeze({ onPrimary: '#07110f' }),
  light: Object.freeze({ primary: '#237a72', primaryStrong: '#1b5f59', onPrimary: '#ffffff' }),
});

/** Copy `object` with `additions` placed right after `key`, keeping the original key order. */
function insertAfter(object, key, additions) {
  return Object.fromEntries(
    Object.entries(object).flatMap((entry) =>
      entry[0] === key ? [entry, ...Object.entries(additions)] : [entry],
    ),
  );
}

// The byte-preserved v1.1.0 theme stays the base, so only the declared changes differ.
function buildSchema() {
  const preserved = readJson('schemas/v1.1.0/artifact-theme.schema.json');
  const palette = (theme) => {
    const original = preserved.properties.themes.properties[theme];
    return {
      ...original,
      required: original.required.flatMap((key) =>
        key === 'primaryStrong' ? [key, 'onPrimary'] : [key],
      ),
      properties: insertAfter(original.properties, 'primaryStrong', {
        onPrimary: original.properties.primary,
      }),
    };
  };
  return {
    $schema: preserved.$schema,
    $id: `https://openplanr.dev/schemas/v${PROTOCOL_VERSION}/artifact-theme.schema.json`,
    'x-openplanr-contract': { id: KIND, version: PROTOCOL_VERSION },
    title: preserved.title,
    type: preserved.type,
    additionalProperties: preserved.additionalProperties,
    required: [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'name',
      'typography',
      'layout',
      'themes',
    ],
    properties: {
      kind: { const: KIND },
      schemaVersion: { const: SCHEMA_VERSION },
      protocolVersion: { const: PROTOCOL_VERSION },
      name: preserved.properties.name,
      typography: preserved.properties.typography,
      layout: preserved.properties.layout,
      themes: {
        ...preserved.properties.themes,
        properties: { dark: palette('dark'), light: palette('light') },
      },
    },
  };
}

function buildRegistry() {
  const preserved = readJson('registry/artifact-theme.json');
  const palette = (theme) => {
    const { onPrimary, ...overrides } = BRAND_COLORS[theme];
    return insertAfter({ ...preserved.themes[theme], ...overrides }, 'primaryStrong', {
      onPrimary,
    });
  };
  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    name: preserved.name,
    typography: preserved.typography,
    layout: preserved.layout,
    themes: { dark: palette('dark'), light: palette('light') },
  };
}

export function buildArtifactThemeSchemas() {
  return new Map([['artifact-theme.schema.json', buildSchema()]]);
}

export function buildArtifactThemeRegistries() {
  return new Map([['artifact-theme.json', buildRegistry()]]);
}
