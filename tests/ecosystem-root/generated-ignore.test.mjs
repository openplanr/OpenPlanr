import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CLI_GENERATED_RESOURCES } from '../../scripts/skills/cli-resources.mjs';
import { renderTypeScriptOutputs } from '../../scripts/typescript/compile-sources.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
function ignored(paths) {
  if (!paths.length) return new Set();
  try {
    return new Set(
      git(['check-ignore', '--no-index', '-z', '--stdin'], { input: `${paths.join('\0')}\0` })
        .split('\0')
        .filter(Boolean),
    );
  } catch (error) {
    if (error.status === 1) return new Set();
    throw error;
  }
}
const compilerOutputs = Object.keys(renderTypeScriptOutputs({ root }));
const projectionManifests = [
  'packages/pipeline/lib/generated/protocol-projection.json',
  ...['artifact', 'design', 'operate'].map(
    (domain) => `packages/pipeline/lib/generated/domain-projections/${domain}.json`,
  ),
];
const projectionOutputs = projectionManifests.flatMap((path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8')).entries.map(
    ({ target }) => `packages/pipeline/${target}`,
  ),
);
const generatedOutputs = new Set([
  ...compilerOutputs,
  ...projectionOutputs,
  ...CLI_GENERATED_RESOURCES.map(({ destination }) => destination),
]);
const copiedNamespaces = [
  // Domain copies are output namespaces, including obsolete local remnants.
  ...['artifact', 'design', 'design-engine', 'operate'].map(
    (domain) => `packages/pipeline/lib/${domain}/`,
  ),
  'packages/protocol/projections/',
  'packages/cli/lib/host-packages/',
  ...['planr-design', 'planr-design-loop', 'planr-design-review', 'planr-plan'].flatMap((skill) => [
    `skills/${skill}/scripts/runtime/`,
    `skills/${skill}/schemas/`,
  ]),
];

function currentAuthoredPaths() {
  // Do not use --exclude-standard: newly ignored untracked source must still be examined.
  return [
    ...new Set(
      git([
        'ls-files',
        '--cached',
        '--others',
        '-z',
        '--',
        ':(glob)**/*.mjs',
        ':(glob)**/*.mts',
        ':(glob)**/*.ts',
        ':(glob)**/*.tsx',
        'packages/pipeline/registry/',
        ':(exclude,glob)**/node_modules/**',
        ':(exclude,glob)**/dist/**',
        ':(exclude,glob)**/coverage/**',
        ':(exclude,glob)**/.planr/**',
      ])
        .split('\0')
        .filter(Boolean),
    ),
  ]
    .filter(
      (path) =>
        /^(?:apps|conformance|packages|scripts|skills|tests)\//u.test(path) &&
        !generatedOutputs.has(path) &&
        !copiedNamespaces.some((prefix) => path.startsWith(prefix)) &&
        !/^skills\/planr-(?:design(?:-loop|-review)?|plan)\/scripts\/design[^/]*\.mjs$/u.test(
          path,
        ) &&
        !/(?:^|\/)(?:\.cache|\.ci|\.design|\.artifact-review|\.wrangler|\.local|\.gstack|\.claude)\//u.test(
          path,
        ),
    )
    .sort();
}

test('all compiler siblings and manifest-owned package projections stay ignored', () => {
  const outputs = [...generatedOutputs];
  const hidden = ignored(outputs);
  assert.deepEqual(
    outputs.filter((path) => !hidden.has(path)),
    [],
  );
});

test('every tracked or untracked canonical module and authored registry remains visible', () => {
  const authored = currentAuthoredPaths();
  assert(authored.length > 1000, 'The proof must inspect the complete canonical module inventory.');
  assert.deepEqual([...ignored(authored)], []);
});

test('wildcard consolidation preserves private state and handwritten projection seams', () => {
  const privatePaths = [
    '.env',
    '.env.production',
    '.migration/receipt.json',
    '.planr/runtime/state.json',
    '.planr/operate/state.json',
    '.planr/artifacts/owner.json',
    '.planr/specs/context.md',
    '.cursor/runtime.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.design/current.json',
    '.artifact-review/review.json',
    '.wrangler/state.json',
    '.local/cache.json',
    '.claude/settings.json',
    '.ci/evidence.json',
    '.gstack/cache.json',
    'examples/design/customer-source.mjs',
    'docs/research/branded-review-studio.md',
    'docs/research/future-note.md',
    'docs/verification/report.json',
    'docs/diagrams/verification.md',
    'docs/migration/source-custody-ledger.json',
    'docs/migration/verification-report.json',
    'conformance/migration/tag-map.json',
    'conformance/migration/import-parity-report.json',
    'conformance/migration/integration-change-inventory.json',
    'conformance/migration/lockfile-custody.json',
    'input/tech/stack.md',
    'evaluation/skills/design-workflow-evidence/report.json',
    'evaluation/skills/design-workflow-results.json',
    'evaluation/skills/design-workflow-results.md',
    'packages/cli/lib/host-packages/plugin.mjs',
    'cache.log',
    'candidate.tgz',
  ];
  const visible = [
    '.env.example',
    'examples/skills/fixture.mjs',
    'packages/pipeline/lib/release/index.mjs',
    'packages/pipeline/lib/protocol/loader.mjs',
    'packages/pipeline/lib/protocol/index.d.ts',
    'packages/pipeline/lib/protocol/live-evidence-v2.d.mts',
    'packages/pipeline/lib/protocol/generated/contract-package-inventory-v2.json',
    'packages/pipeline/registry/generated-skill-assets.json',
    'packages/pipeline/registry/v1.6.0/skill-host-profiles.json',
    'packages/pipeline/registry/v1.6.0/skill-modules.json',
    'packages/pipeline/registry/v1.6.0/skill-routing.json',
    'packages/artifact/lib/artifact/internal/credential-writer.mts',
    'packages/artifact/lib/artifact/internal/runtime-asset.mts',
    'packages/artifact/lib/artifact/internal/board-embedded-data.mjs',
    'packages/artifact/lib/artifact/internal/credential-material.mjs',
    'packages/artifact/lib/artifact/diagram/authoring/model.d.mts',
    'packages/artifact/lib/artifact/ui/studio-shell-components.tsx',
    'packages/artifact/lib/artifact/ui/sandbox/host-guard.mts',
    'packages/artifact/lib/artifact/ui/generated/artifact-shell-assets.json',
    'packages/artifact/lib/artifact/ui/generated/sandbox-guards.mjs',
    'packages/protocol/src/large-object-limits.mjs',
    'packages/protocol/src/large-object-limits.d.mts',
  ];
  const privateIgnored = ignored(privatePaths);
  assert.deepEqual(
    privatePaths.filter((path) => !privateIgnored.has(path)),
    [],
  );
  assert.deepEqual([...ignored(visible)], []);
});
