import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf-8'));

const schemas = {
  spec: readJson('schemas/v1.0.0/spec.schema.json'),
  story: readJson('schemas/v1.0.0/story.schema.json'),
  task: readJson('schemas/v1.0.0/task.schema.json'),
};

const withSync = {
  spec: readJson('tests/fixtures/valid-spec-board-sync.json'),
  story: readJson('tests/fixtures/valid-story-board-sync.json'),
  task: readJson('tests/fixtures/valid-task-board-sync.json'),
};

const withoutSync = {
  spec: readJson('tests/fixtures/valid-spec.json'),
  story: readJson('tests/fixtures/valid-story.json'),
  task: readJson('tests/fixtures/valid-task.json'),
};

for (const kind of ['spec', 'story', 'task']) {
  test(`${kind} frontmatter WITH board-sync identity fields validates (ADR-012)`, () => {
    assert.deepEqual(validate(withSync[kind], schemas[kind]), []);
  });

  test(`${kind} frontmatter WITHOUT board-sync identity fields still validates (backward compat)`, () => {
    assert.deepEqual(validate(withoutSync[kind], schemas[kind]), []);
  });

  test(`${kind} contentHash MUST match the sha256:<64-hex> precedent pattern`, () => {
    const bad = [
      'sha256:xyz', // not hex
      'sha256:9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08', // uppercase hex
      'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0', // 63 chars
      'md5:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', // wrong algorithm prefix
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', // missing prefix
      '', // empty
    ];
    for (const contentHash of bad) {
      const errs = validate({ ...withSync[kind], contentHash }, schemas[kind]);
      assert.ok(errs.length > 0, `${kind} contentHash ${JSON.stringify(contentHash)} should fail validation`);
    }
  });

  test(`${kind} kanbanosId MUST be an opaque url-safe token of at least 8 chars`, () => {
    for (const kanbanosId of ['', 'short', 'has space in id', 'bad/slash/id', 'a'.repeat(129)]) {
      const errs = validate({ ...withSync[kind], kanbanosId }, schemas[kind]);
      assert.ok(errs.length > 0, `${kind} kanbanosId ${JSON.stringify(kanbanosId)} should fail validation`);
    }
  });

  test(`${kind} rejects unknown sync fields — rank never enters files (ADR-012 governance rule)`, () => {
    for (const [field, value] of [
      ['rank', 1024],
      ['kanbanosRank', 'a0h'],
      ['boardRank', 'a0h'],
      ['kanbanosUrl', 'https://example.invalid/board/1'],
      ['syncState', 'pushed'],
    ]) {
      const errs = validate({ ...withSync[kind], [field]: value }, schemas[kind]);
      assert.ok(errs.length > 0, `${kind} unknown sync field "${field}" should fail validation`);
      assert.ok(
        errs.some((e) => e.rule === 'additionalProperties'),
        `${kind} unknown sync field "${field}" should trip additionalProperties`,
      );
    }
  });
}
