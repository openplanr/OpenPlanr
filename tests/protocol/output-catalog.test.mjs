import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRegistries,
  buildSchemas,
} from '../../packages/protocol/scripts/protocol-definitions.mjs';
import { ProtocolError } from '../../packages/protocol/src/errors.mjs';
import {
  getOutputPathTemplate,
  resolveOutputPath,
  validateCanonicalRegistries,
} from '../../packages/protocol/src/registries.mjs';
import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';

const registries = Object.fromEntries(buildRegistries());
const outputs = registries['outputs.json'].outputs;
const outputPaths = registries['output-paths.json'].outputs;
const planningOutputIds = ['gherkin-feature', 'professional-specification', 'task', 'user-story'];

test('planning output catalog declares complete default and spec-driven paths', () => {
  assert.equal(validateCanonicalRegistries(registries), true);
  for (const outputId of planningOutputIds) {
    const output = outputs.find((candidate) => candidate.outputId === outputId);
    const outputPath = outputPaths.find((candidate) => candidate.outputId === outputId);
    assert.ok(output, outputId);
    assert.ok(outputPath, outputId);
    assert.equal(outputPath.pathTemplates.default, output.pathTemplate, outputId);
    assert.match(outputPath.pathTemplates['spec-driven'], /^\.planr\/specs\//u, outputId);
  }

  assert.equal(
    getOutputPathTemplate('professional-specification', 'default', registries),
    'input/specs/spec-{feature}.md',
  );
  assert.equal(
    getOutputPathTemplate('professional-specification', 'spec-driven', registries),
    '.planr/specs/{specId}-{specSlug}/{specId}-{specSlug}.md',
  );
});

test('mode-aware resolver produces canonical planning paths', () => {
  assert.equal(
    resolveOutputPath(
      'professional-specification',
      {
        projectMode: 'default',
        pathArguments: { feature: 'checkout' },
      },
      registries,
    ),
    'input/specs/spec-checkout.md',
  );
  assert.equal(
    resolveOutputPath(
      'professional-specification',
      {
        projectMode: 'spec-driven',
        pathArguments: { specId: 'SPEC-001', specSlug: 'checkout' },
      },
      registries,
    ),
    '.planr/specs/SPEC-001-checkout/SPEC-001-checkout.md',
  );
  assert.equal(
    resolveOutputPath(
      'user-story',
      {
        projectMode: 'spec-driven',
        pathArguments: {
          specId: 'SPEC-001',
          specSlug: 'checkout',
          storyId: 'US-001',
          storySlug: 'pay',
        },
      },
      registries,
    ),
    '.planr/specs/SPEC-001-checkout/stories/US-001-pay.md',
  );
  assert.equal(
    resolveOutputPath(
      'task',
      {
        projectMode: 'spec-driven',
        pathArguments: {
          specId: 'SPEC-001',
          specSlug: 'checkout',
          taskId: 'T-001',
          taskSlug: 'implement',
        },
      },
      registries,
    ),
    '.planr/specs/SPEC-001-checkout/tasks/T-001-implement.md',
  );
  assert.equal(
    resolveOutputPath(
      'gherkin-feature',
      {
        projectMode: 'spec-driven',
        pathArguments: { specId: 'SPEC-001', specSlug: 'checkout', storyId: 'US-001' },
      },
      registries,
    ),
    '.planr/specs/SPEC-001-checkout/stories/US-001-gherkin.feature',
  );
});

test('resolver rejects incomplete, unknown, and unsafe paths', () => {
  assert.throws(
    () =>
      resolveOutputPath(
        'task',
        {
          projectMode: 'spec-driven',
          pathArguments: { specId: 'SPEC-001', specSlug: 'checkout' },
        },
        registries,
      ),
    (error) =>
      error instanceof ProtocolError &&
      error.code === 'E_PROTOCOL_REFERENCE_INVALID' &&
      error.details.missing.includes('taskId'),
  );
  assert.throws(
    () => getOutputPathTemplate('task', 'hybrid', registries),
    (error) => error instanceof ProtocolError && error.code === 'E_PROTOCOL_REFERENCE_INVALID',
  );
  assert.throws(
    () =>
      resolveOutputPath(
        'task',
        {
          projectMode: 'spec-driven',
          pathArguments: {
            specId: 'SPEC-001',
            specSlug: 'checkout',
            taskId: 'T-001',
            taskSlug: 'safe/../../escape',
          },
        },
        registries,
      ),
    (error) => error instanceof ProtocolError && error.code === 'E_PROTOCOL_REFERENCE_INVALID',
  );
  assert.throws(
    () =>
      resolveOutputPath(
        'professional-specification',
        {
          pathArguments: { feature: 'x'.repeat(1025) },
        },
        registries,
      ),
    (error) => error instanceof ProtocolError && error.code === 'E_PROTOCOL_REFERENCE_INVALID',
  );
});

test('legacy catalogs remain readable through the default pathTemplate fallback', () => {
  const legacyRegistries = structuredClone(registries);
  delete legacyRegistries['output-paths.json'];
  assert.equal(
    getOutputPathTemplate('professional-specification', 'spec-driven', legacyRegistries),
    'input/specs/spec-{feature}.md',
  );
});

test('closed output catalog remains unchanged while mode paths use an additive contract', () => {
  const outputCatalogSchema = buildSchemas().get('output-catalog.schema.json');
  const outputProperties = outputCatalogSchema.properties.outputs.items.properties;
  assert.equal(outputProperties.projectModePathTemplates, undefined);
  assert.ok(outputs.every((output) => !('projectModePathTemplates' in output)));
  assert.deepEqual(
    validateProtocolArtifact('output-catalog', registries['outputs.json'], {
      protocolVersion: '1.5.0',
    }),
    [],
  );

  const pathCatalogSchema = buildSchemas().get('output-path-catalog.schema.json');
  assert.deepEqual(pathCatalogSchema.properties.outputs.items.properties.pathTemplates.required, [
    'default',
    'spec-driven',
  ]);
  assert.equal(
    pathCatalogSchema.properties.outputs.items.properties.pathTemplates.additionalProperties,
    false,
  );
});
