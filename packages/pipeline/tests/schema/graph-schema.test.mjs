import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/graph.schema.json'), 'utf-8'));

/** A known-valid Graph: two nodes (a story + a task) and one `contains` edge. */
const validGraph = {
  nodes: [
    {
      id: 'US-001',
      type: 'story',
      title: 'Place an order',
      status: 'in-progress',
      frontmatter: { id: 'US-001', specId: 'SPEC-001' },
    },
    {
      id: 'T-001',
      type: 'task',
      title: 'Payment service',
      status: 'done',
      frontmatter: { id: 'T-001', storyId: 'US-001' },
    },
  ],
  edges: [{ from: 'US-001', to: 'T-001', kind: 'contains' }],
};

test('graph.schema.json accepts a valid two-node, one-edge Graph', () => {
  assert.equal(validate(validGraph, schema).length, 0);
});

test('graph.schema.json rejects a Graph missing the required `nodes` array', () => {
  const { edges } = validGraph;
  const errs = validate({ edges }, schema);
  assert.ok(errs.length > 0, 'expected at least one validation error');
  assert.ok(
    errs.some((e) => e.rule === 'required' && /nodes/.test(e.detail)),
    `expected a "required: nodes" error, got: ${JSON.stringify(errs)}`,
  );
});

test('graph.schema.json rejects a node with an out-of-enum `status`', () => {
  const bad = {
    nodes: [
      {
        id: 'T-001',
        type: 'task',
        title: 'Payment service',
        status: 'wip', // not in {done,in-progress,blocked,outstanding,addressed}
        frontmatter: {},
      },
    ],
    edges: [],
  };
  const errs = validate(bad, schema);
  assert.ok(errs.length > 0, 'expected a validation error for the bad status enum');
  const enumErr = errs.find((e) => e.rule === 'enum' && /status/.test(e.path));
  assert.ok(enumErr, `expected a status enum error, got: ${JSON.stringify(errs)}`);
  assert.ok(enumErr.detail.length > 0, 'enum error must carry a descriptive message');
});

test('graph.schema.json rejects a node with an out-of-enum `type`', () => {
  const bad = {
    nodes: [
      {
        id: 'X-001',
        type: 'milestone', // not a recognized artifact type
        title: 'Bogus',
        status: 'outstanding',
        frontmatter: {},
      },
    ],
    edges: [],
  };
  const errs = validate(bad, schema);
  assert.ok(errs.length > 0, 'expected a validation error for the bad type enum');
  const enumErr = errs.find((e) => e.rule === 'enum' && /type/.test(e.path));
  assert.ok(enumErr, `expected a type enum error, got: ${JSON.stringify(errs)}`);
});

test('graph.schema.json rejects an edge with an out-of-enum `kind`', () => {
  const bad = {
    nodes: validGraph.nodes,
    edges: [{ from: 'US-001', to: 'T-001', kind: 'relates_to' }],
  };
  const errs = validate(bad, schema);
  assert.ok(errs.length > 0, 'expected a validation error for the bad edge kind');
  assert.ok(
    errs.some((e) => e.rule === 'enum' && /kind/.test(e.path)),
    `expected an edge kind enum error, got: ${JSON.stringify(errs)}`,
  );
});
