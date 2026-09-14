#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProtocolArtifact } from 'planr-pipeline/protocol';

const VERSION = '1.2.0';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

/** Applies one declared RFC-6902-style mutation from the invalid fixture set. */
function mutate(base, { operation, path, value }) {
  const clone = structuredClone(base);
  const segments = path.split('/').filter(Boolean);
  const key = segments.pop();
  let target = clone;
  for (const segment of segments) target = target?.[Array.isArray(target) ? Number(segment) : segment];
  if (target === undefined || target === null) return clone;
  if (operation === 'remove') delete target[key];
  else target[Array.isArray(target) ? Number(key) : key] = value;
  return clone;
}

const valid = fixture('landing-contracts-valid.json');
const invalid = fixture('landing-contracts-invalid.json');


let refusedShapes = 0;
const deferred = [];

for (const [kind, record] of Object.entries(valid)) {
  pass(
    validateProtocolArtifact(kind, record, { protocolVersion: VERSION }).length === 0,
    `the reference ${kind} satisfies its published contract`,
  );

  const mutations = invalid[kind] ?? [];
  pass(mutations.length > 0, `${kind} declares at least one refused shape`);

  for (const mutation of mutations) {
    const candidate = mutate(record, mutation);
    const schemaRefused =
      validateProtocolArtifact(kind, candidate, { protocolVersion: VERSION }).length > 0;

    // Each fixture declares the layer that owns its refusal. A schema-layer shape must
    // be refused by the published schema here. A binding or custody conflict is a
    // semantic substitution the schema cannot see; refusing it needs registry and
    // base-record custody that a fixture cannot carry, so it is counted and deferred to
    // the contract suite rather than asserted with an asserter that throws on any input.
    if (mutation.expectedLayer === 'schema') {
      pass(schemaRefused, `${kind} refuses at the schema: ${mutation.name}`);
      refusedShapes += 1;
    } else {
      pass(
        typeof mutation.expectedLayer === 'string' && mutation.expectedLayer.length > 0,
        `${kind} declares the layer that owns: ${mutation.name}`,
      );
      deferred.push(`${kind}:${mutation.expectedLayer}`);
    }
  }
}

// Landing exists to gate real external effects, so no fixture may carry a live secret.
const serialized = JSON.stringify(valid);
for (const forbidden of ['BEGIN RSA', 'BEGIN PRIVATE KEY', 'AKIA', 'ghp_', 'xoxb-']) {
  pass(!serialized.includes(forbidden), `landing fixtures carry no ${forbidden} credential material`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocolVersion: VERSION,
  suite: 'governed-landing',
  contracts: Object.keys(valid).length,
  refusedShapes,
  deferredToContractSuite: deferred.length,
  checks,
})}\n`);
