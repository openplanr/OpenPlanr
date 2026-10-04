// These runtime helpers are projected into the CLI from their canonical owners.
export const CLI_GENERATED_RESOURCES = Object.freeze(
  ['mjs', 'd.mts'].flatMap((extension) => [
    {
      source: `packages/protocol/src/large-object-limits.${extension}`,
      destination: `packages/cli/lib/resource-limits.${extension}`,
      executable: false,
    },
    {
      source: `packages/artifact/lib/artifact/internal/credential-writer.${extension}`,
      destination: `packages/cli/lib/credential-writer.${extension}`,
      executable: false,
    },
  ]),
);
