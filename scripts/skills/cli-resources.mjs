// These runtime helpers are projected into the CLI from their canonical owners.
export const CLI_GENERATED_RESOURCES = Object.freeze([
  ...['mjs', 'd.mts'].flatMap((extension) => [
    {
      source: `packages/protocol/src/large-object-limits.${extension}`,
      destination: `packages/cli/lib/resource-limits.${extension}`,
      executable: false,
    },
    {
      source: `packages/protocol/src/json-schema.${extension}`,
      destination: `packages/cli/lib/json-schema.${extension}`,
      executable: false,
    },
    {
      source: `packages/artifact/lib/artifact/internal/credential-writer.${extension}`,
      destination: `packages/cli/lib/credential-writer.${extension}`,
      executable: false,
    },
  ]),
  {
    source: 'packages/protocol/schemas/v1.18.0/runtime-lock.schema.json',
    destination: 'packages/cli/lib/runtime-lock.schema.json',
    executable: false,
  },
  ...['errors', 'operate-review-note', 'operate-review-contract'].map((name) => ({
    source: `packages/skill-runtime/src/${name}.mjs`,
    destination: `packages/cli/lib/skill-runtime/${name}.mjs`,
    executable: false,
  })),
]);
