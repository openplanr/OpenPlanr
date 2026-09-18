const START = '<!-- plugin-table:start -->';
const END = '<!-- plugin-table:end -->';

/** The public marketplace manifest: one `planr` plugin served from the marketplace checkout. */
export function renderMarketplaceManifest({ version, description }) {
  return {
    $schema: 'https://json.schemastore.org/claude-code-marketplace.json',
    name: 'openplanr',
    owner: { name: 'OpenPlanr', url: 'https://github.com/openplanr' },
    metadata: {
      version,
      description:
        'Official OpenPlanr Claude Code plugin marketplace. The planr plugin is generated from the openplanr npm package of the same version.',
    },
    plugins: [
      {
        name: 'planr',
        source: './plugins/planr',
        version,
        description,
        strict: true,
      },
    ],
  };
}

export function renderPluginTable({ version, description }) {
  return [
    START,
    '| Plugin | Version | Description |',
    '|---|---|---|',
    `| [\`planr\`](https://github.com/openplanr/OpenPlanr/tree/openplanr@${version}/packages/cli) | ${version} | ${description} Generated from [\`openplanr@${version}\`](https://www.npmjs.com/package/openplanr/v/${version}). |`,
    END,
  ].join('\n');
}

/** Replace the marker-delimited plugin table, or append one when the markers are absent. */
export function replacePluginTable(readme, table) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start)
    return `${readme.trimEnd()}\n\n## Plugins\n\n${table}\n`;
  return `${readme.slice(0, start)}${table}${readme.slice(end + END.length)}`;
}
